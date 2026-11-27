/**
 * WebSocket /ws/call: chamadas AO VIVO pelo painel (atendente falando pelo navegador).
 *
 * Autenticação: o mesmo login do painel (cookie da sessão do express-session), nada na URL.
 *   - cliente: usa a própria sessão do WhatsApp;
 *   - admin:   escolhe a sessão com ?sessao=<apikey>.
 *
 * Protocolo
 *   navegador -> API (texto JSON): { type: "ligar", jid } | { type: "atender", callId }
 *                                  | { type: "recusar", callId } | { type: "desligar" }
 *                                  | { type: "mudo", mudo: true|false }
 *   navegador -> API (binário):    voz do atendente, PCM Int16 little-endian, 16 kHz, mono
 *   API -> navegador (texto JSON): { type: "pronto" } | { type: "estado", call } | { type: "recebendo", call }
 *                                  | { type: "recebida-encerrada", call } | { type: "erro", mensagem }
 *   API -> navegador (binário):    voz do contato, PCM Int16 little-endian, 16 kHz, mono
 */
import { WebSocketServer } from "ws";
import config from "../config/env.js";
import logger from "../utils/logger.js";
import WhatsAppService from "./WhatsAppService.js";
import { normalizarJid } from "../whatsapp/utils.js";

const INTERVALO_VERIFICACAO_MS = 5000;

const float32ParaInt16 = (f32) => {
  const saida = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    saida[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return saida;
};

const int16ParaFloat32 = (buffer) => {
  // copia para um ArrayBuffer alinhado (o Buffer do ws pode começar em offset ímpar)
  const amostras = new Int16Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + (buffer.byteLength & ~1)));
  const saida = new Float32Array(amostras.length);
  for (let i = 0; i < amostras.length; i++) saida[i] = amostras[i] / 0x8000;
  return saida;
};

export function criarServidorChamadas({ sessionMiddleware }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  /** Valida o login do painel antes de aceitar o WebSocket. */
  function tratarUpgrade(req, socket, head) {
    sessionMiddleware(req, {}, () => {
      const sessao = req.session;
      if (!sessao?.userId || !sessao?.modo) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        return socket.destroy();
      }
      const url = new URL(req.url, "http://localhost");
      const apikey = sessao.modo === "admin" ? url.searchParams.get("sessao") : sessao.userId;
      wss.handleUpgrade(req, socket, head, (ws) => conectar(ws, apikey));
    });
  }

  function conectar(ws, apikey) {
    const enviarJson = (dados) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(dados));
    const erro = (mensagem) => enviarJson({ type: "erro", mensagem });

    if (!config.enableCalls) {
      erro("Chamadas desativadas. Defina ENABLE_CALLS=true no .env e reinicie a API.");
      return ws.close(1008, "chamadas desativadas");
    }
    const sock = apikey ? WhatsAppService.sockets.get(apikey) : null;
    if (!sock?.chamadas) {
      erro(sock ? "Esta sessão foi iniciada sem o plugin de chamadas. Reinicie a sessão." : "Sessão não encontrada ou não iniciada.");
      return ws.close(1008, "sessão indisponível");
    }

    const gerenciador = sock.chamadas;
    let callIdAtual = null;

    const ouvinte = {
      estado(call) {
        enviarJson({ type: "estado", call });
        if (call?.state === "ended" && call.callId === callIdAtual) callIdAtual = null;
      },
      audio(pcm) {
        if (ws.readyState === ws.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(float32ParaInt16(pcm));
      },
    };
    const painel = {
      chamadaRecebida: (call) => enviarJson({ type: "recebendo", call }),
      chamadaEncerrada: (call) => enviarJson({ type: "recebida-encerrada", call }),
    };
    gerenciador.paineis.add(painel);

    // Se a sessão do WhatsApp for reiniciada, este painel aponta para a conexão antiga
    const verificacao = setInterval(() => {
      if (WhatsAppService.sockets.get(apikey) !== sock) {
        erro("A sessão do WhatsApp foi reiniciada. Recarregue a página.");
        ws.close(1012, "sessão reiniciada");
      }
    }, INTERVALO_VERIFICACAO_MS);

    ws.on("message", async (dados, binario) => {
      if (binario) {
        if (callIdAtual) gerenciador.alimentar(callIdAtual, int16ParaFloat32(dados));
        return;
      }
      let msg;
      try { msg = JSON.parse(dados.toString()); } catch { return erro("Mensagem inválida"); }

      try {
        switch (msg.type) {
          case "ligar": {
            if (!msg.jid) return erro("Informe o número");
            const call = await gerenciador.ligarAoVivo(normalizarJid(msg.jid), ouvinte);
            callIdAtual = call.callId;
            return enviarJson({ type: "estado", call });
          }
          case "atender": {
            const call = await gerenciador.atenderAoVivo(msg.callId, ouvinte);
            callIdAtual = msg.callId;
            return enviarJson({ type: "estado", call });
          }
          case "recusar":
            return await gerenciador.rejeitar(msg.callId);
          case "desligar":
            if (callIdAtual) await gerenciador.encerrar(callIdAtual);
            return;
          case "mudo":
            if (callIdAtual) gerenciador.mutar(callIdAtual, msg.mudo);
            return;
          default:
            return erro(`Tipo desconhecido: ${msg.type}`);
        }
      } catch (e) {
        logger.warn(`Chamada ao vivo (sessão ${apikey}): ${e?.message || e}`);
        erro(e?.message || "Erro na chamada");
      }
    });

    ws.on("close", () => {
      clearInterval(verificacao);
      gerenciador.paineis.delete(painel);
      // fechou o painel no meio da ligação: desliga para o contato não ficar falando sozinho
      gerenciador.desligarDoOuvinte(ouvinte);
    });

    enviarJson({
      type: "pronto",
      chamadas: gerenciador.listar().filter((c) => c.state !== "ended"),
    });
  }

  return { wss, tratarUpgrade };
}
