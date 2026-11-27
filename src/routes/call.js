/**
 * Chamadas de voz: ligar para um contato e tocar um áudio quando ele atender.
 * Montado em /api/call. Requer ENABLE_CALLS=true. Usa o header `apikey` da sessão.
 *
 * O andamento de cada chamada (tocando, atendida, encerrada e o motivo) chega pelo
 * webhook/WebSocket no evento "call_update".
 */
import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import config from "../config/env.js";
import { rotaSessao } from "./rotaSessao.js";
import { normalizarJid, resolverMidia } from "../whatsapp/utils.js";
import { prepararAudioChamada } from "../whatsapp/chamadas.js";

const router = express.Router();

/** Bloqueia as rotas quando as chamadas estão desligadas ou a sessão subiu sem o plugin. */
function exigirChamadas(acao) {
  return async (contexto) => {
    if (!config.enableCalls) return contexto.erroValidacao("Chamadas desativadas. Defina ENABLE_CALLS=true no .env e reinicie a API.");
    if (!contexto.sock.chamadas) return contexto.erroValidacao("Esta sessão foi iniciada sem o plugin de chamadas. Reinicie a sessão (PUT /api/session/restart).");
    return acao(contexto);
  };
}

/** Aceita URL, data URI ou base64 puro. */
async function lerAudio(entrada) {
  if (typeof entrada === "string" && !entrada.startsWith("data:") && !/^https?:\/\//i.test(entrada)) {
    const buffer = Buffer.from(entrada, "base64");
    if (buffer.length === 0) throw Object.assign(new Error("Áudio em base64 inválido"), { audioInvalido: true });
    return buffer;
  }
  return resolverMidia(entrada);
}

// Liga e toca o áudio quando atenderem. Responde logo após começar a chamar.
router.post("/start", authenticateApiKey, rotaSessao(exigirChamadas(async ({ req, sock, erroValidacao }) => {
  const { jid, audio, ringTimeoutSeconds, hangupAfterAudio = true } = req.body || {};
  if (!jid) return erroValidacao("jid é obrigatório");
  if (String(jid).endsWith("@g.us")) return erroValidacao("Chamadas em grupo não são suportadas nesta rota; informe um contato");
  if (!audio) return erroValidacao("audio é obrigatório (URL, data URI ou base64)");
  const tempo = ringTimeoutSeconds === undefined ? config.callRingTimeoutSeconds : Number(ringTimeoutSeconds);
  if (!Number.isFinite(tempo) || tempo < 5 || tempo > 120) return erroValidacao("ringTimeoutSeconds deve estar entre 5 e 120");

  // Converte e valida o áudio ANTES de ligar: um áudio quebrado não deve fazer o telefone tocar.
  let arquivo;
  try {
    arquivo = await prepararAudioChamada(await lerAudio(audio));
  } catch (erro) {
    if (erro?.audioInvalido) return erroValidacao(erro.message);
    throw erro;
  }

  try {
    const call = await sock.chamadas.ligarComAudio(normalizarJid(jid), arquivo, {
      tempoParaAtenderS: tempo,
      encerrarAoTerminar: hangupAfterAudio !== false,
    });
    return { message: "Chamando. Acompanhe pelo evento call_update.", call };
  } catch (erro) {
    if (erro?.chamadaOcupada) return { success: false, message: erro.message };
    throw erro;
  }
}), "Erro ao iniciar a chamada"));

// Encerra uma chamada (tocando ou em andamento)
router.post("/end", authenticateApiKey, rotaSessao(exigirChamadas(async ({ req, sock, erroValidacao }) => {
  const { callId } = req.body || {};
  if (!callId) return erroValidacao("callId é obrigatório");
  const encerrada = await sock.chamadas.encerrar(callId);
  if (!encerrada) return { success: false, message: "Chamada não encontrada ou já encerrada" };
  return { message: "Chamada encerrada" };
}), "Erro ao encerrar a chamada"));

// Chamadas acompanhadas pela sessão (em andamento e encerradas recentemente)
router.get("/list", authenticateApiKey, rotaSessao(exigirChamadas(async ({ sock }) => {
  const calls = sock.chamadas.listar();
  return { total: calls.length, calls };
}), "Erro ao listar as chamadas"));

router.get("/:callId", authenticateApiKey, rotaSessao(exigirChamadas(async ({ req, sock }) => {
  const call = sock.chamadas.obter(req.params.callId);
  if (!call) return { success: false, message: "Chamada não encontrada" };
  return { call };
}), "Erro ao buscar a chamada"));

export default router;
