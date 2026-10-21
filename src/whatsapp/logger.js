/**
 * Adaptador de logger: converte o logger (pino) do projeto para a interface
 * `Logger` esperada pela zapo-js (trace/debug/info/warn/error/child + level).
 *
 * A zapo chama `logger.info("mensagem", { contexto })`, enquanto o pino do
 * projeto espera `logger.info(objeto, "mensagem")` ou `logger.info("mensagem")`.
 * Este arquivo faz a ponte entre os dois formatos.
 */
import logger from "../utils/logger.js";
import config from "../config/env.js";

const NIVEIS = ["trace", "debug", "info", "warn", "error"];

/** Garante que um nível desconhecido não quebre o logger. */
function nivelValido(nivel) {
  return NIVEIS.includes(nivel) ? nivel : "info";
}

/**
 * Cria um logger compatível com a zapo.
 * @param {Record<string, unknown>} [vinculos] Campos fixos adicionados a todo log (ex.: sessionId).
 * @param {string} [nivel] Nível mínimo de log.
 */
export function criarLoggerZapo(vinculos = {}, nivel = config.waLogLevel || "info") {
  const nivelAtual = nivelValido(nivel);
  const prioridade = Object.fromEntries(NIVEIS.map((n, i) => [n, i]));

  const registrar = (nome) => (mensagem, contexto) => {
    // Respeita o nível mínimo configurado (WA_LOG_LEVEL / LOG_LEVEL).
    if (prioridade[nome] < prioridade[nivelAtual]) return;

    // O pino do projeto não tem "trace" configurado com transporte; usamos "debug".
    const metodo = nome === "trace" ? "debug" : nome;
    const extras = { ...vinculos, ...(contexto || {}) };
    const temExtras = Object.keys(extras).length > 0;

    try {
      if (temExtras) {
        logger[metodo](`[zapo] ${mensagem} ${JSON.stringify(extras, substituirBinarios)}`);
      } else {
        logger[metodo](`[zapo] ${mensagem}`);
      }
    } catch {
      // Nunca deixa um erro de log derrubar a conexão.
    }
  };

  return {
    level: nivelAtual,
    trace: registrar("trace"),
    debug: registrar("debug"),
    info: registrar("info"),
    warn: registrar("warn"),
    error: registrar("error"),
    child(novosVinculos = {}, opcoes = {}) {
      return criarLoggerZapo({ ...vinculos, ...novosVinculos }, opcoes.level || nivelAtual);
    },
  };
}

/** Evita logs gigantes: binários viram um resumo e erros viram texto. */
function substituirBinarios(_chave, valor) {
  if (valor instanceof Uint8Array) return `<binario ${valor.length} bytes>`;
  if (valor instanceof Error) return valor.message;
  if (typeof valor === "bigint") return Number(valor);
  return valor;
}
