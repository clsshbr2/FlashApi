/**
 * Chamadas de voz (plugin @zapo-js/voip): ligar para um contato e tocar um áudio.
 *
 * Só é carregado com ENABLE_CALLS=true (o plugin usa módulos nativos/WASM que não
 * precisam pesar para quem não usa chamadas).
 *
 * Com o plugin ligado, as ligações RECEBIDAS passam por ele e a zapo deixa de emitir
 * o evento "call". Por isso este módulo recria o evento "call" no formato de sempre
 * (rejeição automática e webhook continuam funcionando) e publica "call.update"
 * com o andamento de cada chamada.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import config from "../config/env.js";
import logger from "../utils/logger.js";

let moduloVoip = null;

/**
 * Carrega o plugin (uma vez). O plugin chama o binário "ffmpeg" pelo PATH para decodificar o
 * áudio; a imagem Docker não tem ffmpeg instalado, então colocamos o do @ffmpeg-installer no PATH.
 */
export async function carregarVoip() {
  if (moduloVoip) return moduloVoip;
  const pastaFfmpeg = path.dirname(ffmpegInstaller.path);
  const partes = (process.env.PATH || "").split(path.delimiter);
  if (!partes.includes(pastaFfmpeg)) process.env.PATH = [pastaFfmpeg, ...partes].join(path.delimiter);
  moduloVoip = await import("@zapo-js/voip");
  return moduloVoip;
}

export async function criarPluginVoip() {
  const { voipPlugin } = await carregarVoip();
  return voipPlugin({ maxConcurrentCalls: 1, logLevel: "warn" });
}

/**
 * Converte o áudio recebido (mp3, ogg, wav, m4a...) para WAV 16 kHz mono num arquivo temporário.
 * Serve também para validar o áudio ANTES de ligar (não toca o telefone de ninguém à toa).
 */
export function prepararAudioChamada(buffer) {
  const destino = path.join(os.tmpdir(), `flashapi-chamada-${randomUUID()}.wav`);
  return new Promise((resolve, reject) => {
    const processo = spawn(ffmpegInstaller.path, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", "pipe:0",
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      destino,
    ]);
    let erro = "";
    processo.stderr.on("data", (parte) => (erro += parte));
    processo.on("error", reject);
    processo.on("close", (codigo) => {
      if (codigo === 0 && fs.existsSync(destino) && fs.statSync(destino).size > 44) return resolve(destino);
      fs.unlink(destino, () => {});
      const falha = new Error(`Áudio inválido ou formato não suportado: ${erro.trim() || `ffmpeg saiu com código ${codigo}`}`);
      falha.audioInvalido = true;
      reject(falha);
    });
    processo.stdin.on("error", () => {});
    processo.stdin.end(buffer);
  });
}

/** Resumo de uma chamada no formato publicado pela API. */
export function resumoChamada(chamada) {
  if (!chamada) return null;
  const estado = chamada.stateData || {};
  return {
    callId: chamada.callId,
    peerJid: chamada.peerJid,
    direction: chamada.direction,
    isVideo: chamada.mediaType === "video",
    isGroup: Boolean(chamada.isGroupCall),
    groupJid: chamada.groupJid,
    state: estado.state,
    endReason: estado.endReason,
    durationSecs: estado.durationSecs,
    createdAt: chamada.createdAt,
    connectedAt: estado.connectedAt,
    endedAt: estado.endedAt,
  };
}

/**
 * Controla as chamadas da sessão:
 *  - com áudio gravado (rota /api/call/start): tempo para atender, desligar ao fim do áudio,
 *    duração máxima e limpeza do arquivo temporário;
 *  - ao vivo (painel /manager/call): liga ou atende e troca áudio com um "ouvinte"
 *    (a conexão WebSocket do atendente), que recebe estados e a voz do contato.
 * Também publica os eventos "call" e "call.update".
 */
export class GerenciadorChamadas {
  /** @param socket SessaoWhatsApp */
  constructor(socket) {
    this.socket = socket;
    // callId -> { arquivo?, timers[], encerrarAoTerminar?, aoVivo?, ouvinte?, limiteAgendado? }
    this.controles = new Map();
    // Painéis abertos nesta sessão, avisados quando chega uma ligação
    this.paineis = new Set();
  }

  get voip() {
    return this.socket.client.voip;
  }

  /** Liga os eventos do plugin aos eventos da API. Chamar logo após criar o WaClient. */
  ligarEventos() {
    const { client } = this.socket;
    const emitir = (nome, dados) => this.socket.emitir(nome, dados);

    client.on("voip_call_incoming", (chamada) => {
      // Mesmo formato do evento "call" que a API sempre publicou (rejeição automática depende dele)
      emitir("call", [{
        id: chamada.callId,
        chatId: chamada.groupJid || chamada.peerJid,
        from: chamada.callCreator || chamada.peerJid,
        date: chamada.createdAt || new Date(),
        offline: false,
        status: "offer",
        isVideo: chamada.mediaType === "video",
        isGroup: Boolean(chamada.isGroupCall),
        groupJid: chamada.groupJid,
      }]);
      const resumo = resumoChamada(chamada);
      emitir("call.update", resumo);
      for (const painel of this.paineis) painel.chamadaRecebida?.(resumo);
    });

    client.on("voip_call_state", (chamada) => {
      const resumo = resumoChamada(chamada);
      emitir("call.update", resumo);
      this.controles.get(chamada.callId)?.ouvinte?.estado?.(resumo);
      if (chamada.stateData?.state === "active") this.#aoConectar(chamada.callId);
    });

    client.on("voip_call_ended", (chamada) => {
      const resumo = resumoChamada(chamada);
      emitir("call.update", resumo);
      this.controles.get(chamada.callId)?.ouvinte?.estado?.(resumo);
      // Uma ligação recebida que acabou sem ser atendida também some dos painéis
      for (const painel of this.paineis) painel.chamadaEncerrada?.(resumo);
      this.#limpar(chamada.callId);
    });

    // Voz do contato: 960 amostras Float32 (60 ms a 16 kHz) para o atendente
    client.on("voip_call_inbound_audio", ({ call, pcm }) => {
      const controle = this.controles.get(call?.callId);
      if (controle?.aoVivo) controle.ouvinte?.audio?.(pcm);
    });

    client.on("voip_call_outbound_audio_finished", (chamada) => {
      const controle = this.controles.get(chamada.callId);
      emitir("call.update", { ...resumoChamada(chamada), audioFinished: true });
      if (controle?.encerrarAoTerminar) {
        // pequena folga para o fim do áudio chegar ao celular antes de desligar
        controle.timers.push(setTimeout(() => this.encerrar(chamada.callId, "UserEnded"), 1500));
      }
    });

    client.on("voip_call_error", (erro) => {
      logger.warn(`Sessão ${this.socket.sessionId}: erro no plugin de chamadas: ${erro?.message || erro}`);
    });
  }

  #garantirLivre(exceto) {
    const ativas = this.voip.getCalls().filter((c) => c.stateData?.state !== "ended" && c.callId !== exceto);
    if (ativas.length > 0) {
      const ocupado = new Error("Já existe uma chamada em andamento nesta sessão");
      ocupado.chamadaOcupada = true;
      throw ocupado;
    }
  }

  #agendarTempoParaAtender(callId, controle, segundos) {
    controle.timers.push(setTimeout(() => {
      const estado = this.voip.getCall(callId)?.stateData?.state;
      if (estado && estado !== "active" && estado !== "ended") this.encerrar(callId, "Timeout");
    }, segundos * 1000));
  }

  /**
   * Liga para `jid` e toca o áudio quando atenderem.
   * @returns resumo da chamada (state "initiating"/"ringing")
   */
  async ligarComAudio(jid, arquivoWav, { tempoParaAtenderS = config.callRingTimeoutSeconds, encerrarAoTerminar = true } = {}) {
    try {
      this.#garantirLivre();
    } catch (erro) {
      fs.unlink(arquivoWav, () => {});
      throw erro;
    }

    let callId;
    try {
      callId = await this.voip.startCall({ peerJid: jid, audioFile: arquivoWav });
    } catch (erro) {
      fs.unlink(arquivoWav, () => {});
      throw erro;
    }

    const controle = { arquivo: arquivoWav, timers: [], encerrarAoTerminar };
    this.controles.set(callId, controle);
    this.#agendarTempoParaAtender(callId, controle, tempoParaAtenderS);
    return resumoChamada(this.voip.getCall(callId)) || { callId };
  }

  /**
   * Liga para `jid` em modo ao vivo. `ouvinte` = { estado(resumo), audio(Float32Array) }.
   */
  async ligarAoVivo(jid, ouvinte) {
    this.#garantirLivre();
    const callId = await this.voip.startCall({ peerJid: jid });
    const controle = { aoVivo: true, ouvinte, timers: [] };
    this.controles.set(callId, controle);
    this.#agendarTempoParaAtender(callId, controle, config.callRingTimeoutSeconds);
    return resumoChamada(this.voip.getCall(callId)) || { callId };
  }

  /** Atende uma ligação recebida em modo ao vivo. */
  async atenderAoVivo(callId, ouvinte) {
    const chamada = this.voip.getCall(callId);
    if (!chamada || chamada.stateData?.state === "ended") throw new Error("Ligação não encontrada ou já encerrada");
    this.#garantirLivre(callId);
    this.controles.set(callId, { aoVivo: true, ouvinte, timers: [] });
    await this.voip.acceptCall(callId);
    return resumoChamada(this.voip.getCall(callId));
  }

  /**
   * Envia a voz do atendente (Float32 16 kHz mono). Se a fila passar do limite do plugin,
   * descarta o trecho: numa conversa, perder 60 ms é melhor do que acumular atraso.
   * @returns ms de áudio na fila, ou -1 se descartado / chamada não ativa
   */
  alimentar(callId, pcm) {
    const controle = this.controles.get(callId);
    if (!controle?.aoVivo || !controle.externoAtivo) return -1;
    if (this.voip.getLiveBufferMs(callId) >= this.voip.getFeedWatermarksMs().pauseMs) return -1;
    return this.voip.feedLiveAudio(callId, pcm);
  }

  mutar(callId, mudo) {
    this.voip.setMute(callId, Boolean(mudo));
  }

  #aoConectar(callId) {
    const controle = this.controles.get(callId);
    if (!controle || controle.limiteAgendado) return;
    controle.limiteAgendado = true;
    if (controle.aoVivo) {
      // a partir daqui a voz enviada vem do atendente (feedLiveAudio)
      this.voip.setExternalAudioMode(callId, true);
      controle.externoAtivo = true;
    }
    const limite = controle.aoVivo ? config.callLiveMaxDurationSeconds : config.callMaxDurationSeconds;
    controle.timers.push(setTimeout(() => this.encerrar(callId, "UserEnded"), limite * 1000));
  }

  async encerrar(callId, motivo = "UserEnded") {
    const chamada = this.voip.getCall(callId);
    if (!chamada || chamada.stateData?.state === "ended") return false;
    const { EndCallReason } = await carregarVoip();
    await this.voip.endCall(callId, EndCallReason[motivo] || EndCallReason.UserEnded);
    return true;
  }

  async rejeitar(callId) {
    await this.voip.rejectCall(callId);
  }

  listar() {
    return this.voip.getCalls().map(resumoChamada);
  }

  obter(callId) {
    return resumoChamada(this.voip.getCall(callId));
  }

  /** O atendente fechou o painel: encerra as chamadas ao vivo dele. */
  async desligarDoOuvinte(ouvinte) {
    for (const [callId, controle] of this.controles) {
      if (controle.ouvinte === ouvinte) await this.encerrar(callId).catch(() => {});
    }
  }

  #limpar(callId) {
    const controle = this.controles.get(callId);
    if (!controle) return;
    controle.timers.forEach(clearTimeout);
    if (controle.arquivo) fs.unlink(controle.arquivo, () => {});
    this.controles.delete(callId);
  }

  /** Ao encerrar a sessão: cancela timers e apaga os arquivos temporários. */
  limparTudo() {
    for (const callId of [...this.controles.keys()]) this.#limpar(callId);
  }
}
