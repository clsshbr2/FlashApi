/**
 * Tradutor de CONTEÚDO de mensagens: corpo da requisição da API -> formato da zapo.
 *
 * Os serviços da API (messageService.js, rotas, etc.) montam o conteúdo no
 * formato da requisição, por exemplo:
 *     { image: <buffer|{url}>, caption: "oi", mimetype: "image/jpeg" }
 * A zapo usa uma união discriminada com o campo `type`:
 *     { type: "image", media: <Buffer>, caption: "oi", mimetype: "image/jpeg" }
 *
 * Este módulo faz essa conversão para que NENHUM serviço/rota precise mudar.
 */
import { resolverMidia } from "./utils.js";

// Mimetypes padrão quando a requisição não informar.
const MIMETYPE_PADRAO = {
  image: "image/jpeg",
  video: "video/mp4",
  audio: "audio/mpeg",
  document: "application/octet-stream",
  sticker: "image/webp",
};

/**
 * Converte o objeto "quoted" da requisição (mensagem completa ou só a chave)
 * para o `quote` da zapo.
 */
export function converterQuote(quoted) {
  if (!quoted) return undefined;
  const chave = quoted.key || quoted;
  if (!chave?.id) return undefined;
  return {
    id: chave.id,
    remoteJid: chave.remoteJid,
    participant: chave.participant,
    message: quoted.message,
  };
}

/**
 * Converte uma chave de mensagem da requisição para a chave exigida pela zapo
 * (todos os campos obrigatórios).
 */
export function converterChave(chave, jidPadrao) {
  return {
    remoteJid: chave?.remoteJid || jidPadrao,
    id: chave?.id,
    fromMe: Boolean(chave?.fromMe),
    participant: chave?.participant || undefined,
  };
}

/**
 * Converte o conteúdo da requisição em { conteudo, opcoes } da zapo.
 *
 * @param {string} jid       JID de destino.
 * @param {object} c         Conteúdo no formato da requisição.
 * @param {object} [extras]  Opções extras do envio (quoted, statusJidList...).
 */
export async function converterConteudo(jid, c, extras = {}) {
  const opcoes = {};
  let conteudo;

  // ---- Opções comuns (responder, mencionar, anúncio externo) ----
  const quote = converterQuote(extras.quoted);
  if (quote) opcoes.quote = quote;
  if (Array.isArray(c.mentions) && c.mentions.length > 0) opcoes.mentions = c.mentions;

  // Anúncio externo ("externalAdReply") vai direto no contextInfo bruto do proto.
  const contextInfo = c.contextInfo?.externalAdReply ? { raw: { externalAdReply: c.contextInfo.externalAdReply } } : undefined;

  // ---- Apagar mensagem para todos ----
  if (c.delete) {
    return { conteudo: { type: "revoke", target: converterChave(c.delete, jid) }, opcoes };
  }

  // ---- Reação ----
  if (c.react) {
    return {
      conteudo: { type: "reaction", emoji: c.react.text ?? "", target: converterChave(c.react.key, jid) },
      opcoes,
    };
  }

  // ---- Enquete ----
  if (c.poll) {
    const opcoesEnquete = c.poll.values || c.poll.options || [];
    return {
      conteudo: {
        type: "poll",
        name: c.poll.name,
        options: opcoesEnquete,
        selectableCount: c.poll.selectableCount ?? 1,
      },
      opcoes,
    };
  }

  // ---- Localização ----
  if (c.location) {
    return { conteudo: { locationMessage: { ...c.location } }, opcoes };
  }

  // ---- Contatos (vCard) ----
  if (c.contacts) {
    const lista = c.contacts.contacts || [];
    if (lista.length === 1) {
      return {
        conteudo: { contactMessage: { displayName: lista[0].displayName || c.contacts.displayName, vcard: lista[0].vcard } },
        opcoes,
      };
    }
    return {
      conteudo: {
        contactsArrayMessage: {
          displayName: c.contacts.displayName,
          contacts: lista.map((ct) => ({ displayName: ct.displayName || c.contacts.displayName, vcard: ct.vcard })),
        },
      },
      opcoes,
    };
  }

  // ---- Mídias ----
  if (c.sticker) {
    conteudo = {
      type: "sticker",
      media: await resolverMidia(c.sticker),
      mimetype: c.mimetype || MIMETYPE_PADRAO.sticker,
    };
  } else if (c.image) {
    conteudo = {
      type: "image",
      media: await resolverMidia(c.image),
      mimetype: c.mimetype || MIMETYPE_PADRAO.image,
      caption: c.caption || undefined,
    };
  } else if (c.video) {
    conteudo = {
      type: "video",
      media: await resolverMidia(c.video),
      mimetype: c.mimetype || MIMETYPE_PADRAO.video,
      caption: c.caption || undefined,
      gifPlayback: c.gifPlayback ? true : undefined,
    };
  } else if (c.audio) {
    conteudo = {
      type: "audio",
      media: await resolverMidia(c.audio),
      mimetype: c.mimetype || MIMETYPE_PADRAO.audio,
      ptt: c.ptt ? true : undefined,
    };
  } else if (c.document) {
    conteudo = {
      type: "document",
      media: await resolverMidia(c.document),
      mimetype: c.mimetype || MIMETYPE_PADRAO.document,
      fileName: c.fileName || "documento",
      caption: c.caption || undefined,
    };
  } else if (typeof c.text === "string") {
    // ---- Texto simples ----
    const ehStatus = jid === "status@broadcast";

    if (ehStatus && (extras.backgroundArgb || extras.font)) {
      // Status de texto com cor de fundo/fonte: usa o proto bruto.
      conteudo = {
        extendedTextMessage: {
          text: c.text,
          backgroundArgb: extras.backgroundArgb,
          font: extras.font,
        },
      };
    } else {
      conteudo = { type: "text", text: c.text };
      // linkPreview: true/false/objeto são repassados; null/undefined segue o padrão da zapo.
      if (c.linkPreview === true || c.linkPreview === false || (c.linkPreview && typeof c.linkPreview === "object")) {
        conteudo.linkPreview = c.linkPreview;
      }
    }
  } else {
    throw new Error("Conteúdo de mensagem não suportado");
  }

  if (contextInfo && conteudo.type) conteudo.contextInfo = contextInfo;
  return { conteudo, opcoes };
}
