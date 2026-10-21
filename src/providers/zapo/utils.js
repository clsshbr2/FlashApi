/**
 * Funções utilitárias da camada de compatibilidade Baileys → zapo.
 */
import axios from "axios";
import { randomBytes } from "node:crypto";

/**
 * Converte um objeto da zapo para o formato JSON que a Baileys produzia.
 *
 * A Baileys serializa campos binários (chaves, hashes, thumbnails, etc.) como
 * string base64 e timestamps (Long) como número. Os webhooks/WebSocket e o
 * banco de dados da API dependem desse formato, então convertemos aqui:
 *   - Uint8Array / Buffer  -> string base64
 *   - bigint               -> number
 *   - Long ({low, high})   -> number
 *   - Map / Set            -> ignorados (viram objeto/array simples)
 * Retorna uma CÓPIA; o objeto original não é alterado.
 */
export function paraJsonBaileys(valor, profundidade = 0) {
  if (valor === null || valor === undefined) return valor;
  if (profundidade > 40) return undefined; // proteção contra referências circulares

  if (valor instanceof Uint8Array) return Buffer.from(valor).toString("base64");
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor !== "object") return valor;

  // Objeto Long (protobuf.js): { low, high, unsigned }
  if (typeof valor.low === "number" && typeof valor.high === "number" && "unsigned" in valor) {
    return valor.unsigned ? (valor.high >>> 0) * 4294967296 + (valor.low >>> 0) : valor.high * 4294967296 + (valor.low >>> 0);
  }

  if (Array.isArray(valor)) return valor.map((item) => paraJsonBaileys(item, profundidade + 1));
  if (valor instanceof Map) return Object.fromEntries([...valor].map(([k, v]) => [k, paraJsonBaileys(v, profundidade + 1)]));
  if (valor instanceof Set) return [...valor].map((item) => paraJsonBaileys(item, profundidade + 1));

  const resultado = {};
  for (const [chave, item] of Object.entries(valor)) {
    if (typeof item === "function") continue;
    // `rawNode` é o stanza bruto da zapo: grande e inútil para os consumidores da API.
    if (chave === "rawNode") continue;
    resultado[chave] = paraJsonBaileys(item, profundidade + 1);
  }
  return resultado;
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

/** Gera um ID de mensagem no mesmo padrão da Baileys/WhatsApp Web ("3EB0..."). */
export function gerarIdMensagem() {
  return "3EB0" + randomBytes(9).toString("hex").toUpperCase();
}

/**
 * Resolve qualquer forma de mídia aceita pela API para um Buffer:
 *   - Buffer / Uint8Array
 *   - "data:...;base64,XXXX"
 *   - "http(s)://..."  (baixa o arquivo)
 *   - { url: <qualquer um dos itens acima> }  (formato que a Baileys usava)
 */
export async function resolverMidia(entrada, timeoutMs = 30000) {
  if (entrada === null || entrada === undefined) throw new Error("Mídia não informada");

  if (Buffer.isBuffer(entrada)) return entrada;
  if (entrada instanceof Uint8Array) return Buffer.from(entrada);

  // Formato { url: ... } da Baileys
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
