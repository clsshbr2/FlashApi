/**
 * Funções utilitárias da camada que conecta a API à zapo (JSON, JIDs, mídia e logger).
 */
import axios from "axios";
import { randomBytes } from "node:crypto";
import logger from "../utils/logger.js";
import config from "../config/env.js";

/**
 * Converte um objeto da zapo para o formato JSON que a API sempre publicou.
 *
 * A API publica campos binários (chaves, hashes, thumbnails, etc.) como
 * string base64 e timestamps (Long) como número. Os webhooks/WebSocket e o
 * banco de dados da API dependem desse formato, então convertemos aqui:
 *   - Uint8Array / Buffer  -> string base64
 *   - bigint               -> number
 *   - Long ({low, high})   -> number
 *   - Map / Set            -> ignorados (viram objeto/array simples)
 * Retorna uma CÓPIA; o objeto original não é alterado.
 */
export function paraJsonApi(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return valor;
  if (profundidade > 40) return undefined; // proteção contra referências circulares

  if (valor instanceof Uint8Array) return Buffer.from(valor).toString("base64");
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor !== "object") return valor;

  // Objeto Long (protobuf.js): { low, high, unsigned }
  if (typeof valor.low === "number" && typeof valor.high === "number" && "unsigned" in valor) {
    return valor.unsigned ? (valor.high >>> 0) * 4294967296 + (valor.low >>> 0) : valor.high * 4294967296 + (valor.low >>> 0);
  }

  if (Array.isArray(valor)) return valor.map((item) => paraJsonApi(item, profundidade + 1));
  if (valor instanceof Map) return Object.fromEntries([...valor].map(([k, v]) => [k, paraJsonApi(v, profundidade + 1)]));
  if (valor instanceof Set) return [...valor].map((item) => paraJsonApi(item, profundidade + 1));

  const resultado = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (typeof item === "function") continue;
    // `rawNode` é o stanza bruto da zapo: grande e inútil para os consumidores da API.
    if (chave === "rawNode") continue;
    resultado[chave] = paraJsonApi(item, profundidade + 1);
  }
  return resultado;
}

// Campos de mensagens de mídia que a zapo espera como bytes (nos webhooks viram base64).
const CAMPOS_BINARIOS = new Set(["mediaKey", "fileSha256", "fileEncSha256", "streamingSidecar", "thumbnailSha256", "thumbnailEncSha256"]);

/**
 * Operação inversa de paraJsonApi: converte para bytes os campos binários
 * conhecidos (mediaKey, fileSha256...) que vieram como base64. Retorna uma cópia.
 */
export function base64ParaBinario(valor) {
  if (Array.isArray(valor)) return valor.map(base64ParaBinario);
  if (valor && typeof valor === "object" && !(valor instanceof Uint8Array)) {
    return Object.fromEntries(
      Object.entries(valor).map(([chave, item]) => [
        chave,
        CAMPOS_BINARIOS.has(chave) && typeof item === "string" ? Buffer.from(item, "base64") : base64ParaBinario(item),
      ]),
    );
  }
  return valor;
}

/** Mantém apenas os dígitos de um texto (ex.: "+55 (11) 9..." -> "5511..."). */
export function somenteDigitos(texto) {
  return String(texto ?? "").replace(/\D/g, "");
}

/**
 * Normaliza um JID. Se vier só o número, completa com @s.whatsapp.net.
 * Remove o sufixo de dispositivo (":12") dos JIDs de usuário.
 */
export function normalizarJid(jid) {
  const texto = String(jid ?? "");
  if (!texto.includes("@")) return `${somenteDigitos(texto)}@s.whatsapp.net`;
  const [usuario, servidor] = texto.split("@");
  return `${usuario.split(":")[0]}@${servidor}`;
}

/** Gera um ID de mensagem no mesmo padrão do WhatsApp Web ("3EB0..."). */
export function gerarIdMensagem() {
  return "3EB0" + randomBytes(9).toString("hex").toUpperCase();
}

/**
 * Resolve qualquer forma de mídia aceita pela API para um Buffer:
 *   - Buffer / Uint8Array
 *   - "data:...;base64,XXXX"
 *   - "http(s)://..."  (baixa o arquivo)
 *   - { url: <qualquer um dos itens acima> }  (formato usado pelas rotas)
 */
export async function resolverMidia(entrada, timeoutMs = 30000) {
  if (entrada === null || entrada === undefined) throw new Error("Mídia não informada");

  if (Buffer.isBuffer(entrada)) return entrada;
  if (entrada instanceof Uint8Array) return Buffer.from(entrada);

  // Formato { url: ... } usado pelas rotas
  if (typeof entrada === "object" && "url" in entrada) return resolverMidia(entrada.url, timeoutMs);

  if (typeof entrada === "string") {
    if (entrada.startsWith("data:")) {
      const base64 = entrada.split(",")[1] || "";
      return Buffer.from(base64, "base64");
    }
    if (/^https?:\/\//i.test(entrada)) {
      const resposta = await axios.get(entrada, { responseType: "arraybuffer", timeout: timeoutMs });
      return Buffer.from(resposta.data);
    }
  }

  throw new Error("Formato de mídia inválido (use URL, base64 data URI ou buffer)");
}

/** Extrai o tipo de conteúdo principal de uma mensagem (ex.: "imageMessage"). */
export function tipoDaMensagem(mensagem) {
  if (!mensagem || typeof mensagem !== "object") return null;
  return Object.keys(mensagem).find((chave) => chave !== "messageContextInfo") || null;
}

// ---------------------------------------------------------------- Logger
// A zapo chama `logger.info("mensagem", { contexto })`, enquanto o pino do projeto
// espera `logger.info("mensagem")`; criarLoggerZapo faz a ponte entre os dois formatos.

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
