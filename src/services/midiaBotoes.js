/**
 * Prepara (faz upload de) uma mídia para ser usada dentro de botões,
 * mensagens interativas e carrossel.
 *
 * - Provider zapo: usa o upload da própria zapo (ZapoSocket.prepararMidiaZapo).
 * - Provider Baileys: usa o prepareWAMessageMedia original.
 *
 * Em ambos os casos o retorno tem o mesmo formato:
 *   { imageMessage } | { videoMessage } | { documentMessage }
 */
import { prepareWAMessageMedia } from "@whiskeysockets/baileys";

/**
 * @param {object} sock      Socket da sessão (Baileys ou ZapoSocket).
 * @param {object} conteudo  Ex.: { image, caption } | { video, caption } | { document, mimetype, fileName }
 */
export async function prepararMidia(sock, conteudo) {
  if (typeof sock.prepararMidiaZapo === "function") {
    return sock.prepararMidiaZapo(conteudo);
  }
  return prepareWAMessageMedia(conteudo, { upload: sock.waUploadToServer });
}
