/**
 * Mensagens interativas: lista, botões de resposta, mensagem interativa
 * (native flow) e carrossel.
 *
 * Tudo é montado como objeto de proto puro (formato do WhatsApp) e enviado
 * pela zapo, que monta sozinha os nós "biz" necessários para cada tipo.
 */
import { proto } from "zapo-js";
import WhatsAppService from "./WhatsAppService.js";
import logger from "../utils/logger.js";

const { ListMessage, ButtonsMessage } = proto.Message;

// ---------------------------------------------------------------- Auxiliares

/** Normaliza o destino: se vier só o número, completa com @s.whatsapp.net. */
const normalizarDestino = (jid) => (jid.includes("@") ? jid : `${jid}@s.whatsapp.net`);

/** Atraso em ms informado na requisição (padrão 1200). */
const atrasoDaRequisicao = (data) => (Number.isFinite(Number(data.delay)) ? Number(data.delay) : 1200);

/** Busca a sessão conectada; lança erro com mensagem amigável se não existir. */
async function obterSessaoConectada(sessionId) {
    const sock = WhatsAppService.sockets.get(sessionId);
    const session = sock ? await WhatsAppService.GetSessao(sessionId) : null;
    if (!sock || !session) throw Object.assign(new Error("Sessão não conectada"), { amigavel: true });
    return sock;
}

/**
 * Envia o proto simulando "digitando" antes e "pausado" depois.
 * Retorna o id da mensagem enviada.
 */
async function enviarComPresenca(sock, jid, mensagemProto, atraso) {
    await WhatsAppService.delay(atraso);
    await sock.sendPresenceUpdate("composing", jid);
    await WhatsAppService.delay(1200);
    const id = await sock.enviarProto(jid, mensagemProto);
    await WhatsAppService.delay(100);
    await sock.sendPresenceUpdate("paused", jid);
    return id;
}

/** Executa um envio padronizando o retorno { success, message, error }. */
async function executar(nome, sessionId, data, montarEEnviar) {
    try {
        const sock = await obterSessaoConectada(sessionId);
        const jid = normalizarDestino(data.jid);
        const id = await montarEEnviar(sock, jid);
        return { success: true, message: id };
    } catch (error) {
        if (error.amigavel) return { success: false, message: error.message };
        logger.error(`Erro ao enviar ${nome}: `, error.message || error);
        return { success: false, message: `Erro ao enviar ${nome}`, error: error.message || error };
    }
}

/**
 * Faz o upload da mídia e devolve o imageMessage/videoMessage/documentMessage
 * pronto para o proto. `fonte` é o objeto da requisição:
 * { url: <http | data URI | buffer>, caption }.
 */
async function enviarMidia(sock, tipo, fonte, extras = {}) {
    const resultado = await sock.prepararMidia({ [tipo]: fonte.url, caption: fonte.caption || "", ...extras });
    return resultado[`${tipo}Message`];
}

// -------------------------------------------------------------------- Lista

export const sendList = (sessionId, data) =>
    executar("Lista", sessionId, data, (sock, jid) => {
        const mensagem = {
            listMessage: {
                title: data.title,
                description: data.description,
                buttonText: data.buttonText,
                footerText: data.footerText,
                listType: ListMessage.ListType.SINGLE_SELECT,
                sections: data.sections.map((secao) => ({
                    title: secao.title,
                    rows: secao.rows.map((linha) => ({
                        title: linha.title,
                        rowId: linha.rowId,
                        description: linha.description || "",
                    })),
                })),
            },
        };
        return enviarComPresenca(sock, jid, mensagem, atrasoDaRequisicao(data));
    });

// ------------------------------------------------------------ Botões (reply)

export const sendButton = (sessionId, data) =>
    executar("Botões", sessionId, data, async (sock, jid) => {
        const botoes = {
            contentText: data.text,
            footerText: data.footer,
            headerType: ButtonsMessage.HeaderType.EMPTY,
            buttons: data.buttons.map((botao) => ({
                buttonId: botao.buttonId,
                buttonText: { displayText: botao.buttonText.displayText },
                type: ButtonsMessage.Button.Type.RESPONSE,
            })),
        };

        // Cabeçalho opcional com mídia
        if (data.video) {
            botoes.headerType = ButtonsMessage.HeaderType.VIDEO;
            botoes.videoMessage = await enviarMidia(sock, "video", data.video);
        }
        if (data.image) {
            botoes.headerType = ButtonsMessage.HeaderType.IMAGE;
            botoes.imageMessage = await enviarMidia(sock, "image", data.image);
        }
        if (data.document) {
            botoes.headerType = ButtonsMessage.HeaderType.DOCUMENT;
            botoes.documentMessage = await enviarMidia(sock, "document", data.document);
        }

        return enviarComPresenca(sock, jid, { buttonsMessage: botoes }, atrasoDaRequisicao(data));
    });

// ------------------------------------------------- Mensagem interativa (flow)

export const sendinteractiveMessage = (sessionId, data) =>
    executar("Mensagem interativa", sessionId, data, async (sock, jid) => {
        const cabecalho = {
            title: data?.header?.title || "",
            subtitle: data?.header?.subtitle || "",
            hasMediaAttachment: false,
        };

        if (data.video) {
            cabecalho.hasMediaAttachment = true;
            cabecalho.videoMessage = await enviarMidia(sock, "video", data.video);
        }
        if (data.image) {
            cabecalho.hasMediaAttachment = true;
            cabecalho.imageMessage = await enviarMidia(sock, "image", data.image, { caption: undefined });
        }
        if (data.document) {
            cabecalho.hasMediaAttachment = true;
            cabecalho.documentMessage = await enviarMidia(sock, "document", data.document, {
                mimetype: data.document.mimetype || "application/octet-stream",
                fileName: data.document.fileName || "docs.docs",
            });
        }

        const mensagem = {
            interactiveMessage: {
                header: cabecalho,
                body: { text: data?.body?.text || "" },
                footer: { text: data?.footer?.text || "" },
                nativeFlowMessage: {
                    buttons: data.buttons.map((botao) => ({
                        name: botao.name,
                        buttonParamsJson:
                            typeof botao.buttonParamsJson === "string" ? botao.buttonParamsJson : JSON.stringify(botao.buttonParamsJson),
                    })),
                },
            },
        };
        return enviarComPresenca(sock, jid, mensagem, atrasoDaRequisicao(data));
    });

// ----------------------------------------------------------------- Carrossel

/** Converte uma ação do card do carrossel no botão de native flow correspondente. */
function botaoDaAcao(acao) {
    const json = (objeto) => JSON.stringify(objeto);
    switch (acao.type) {
        case "reply":
            return { name: "quick_reply", buttonParamsJson: json({ display_text: acao.text, id: acao.id }) };
        case "url":
            return { name: "cta_url", buttonParamsJson: json({ display_text: acao.text, url: acao.url }) };
        case "call":
            return { name: "cta_call", buttonParamsJson: json({ display_text: acao.text, phone_number: acao.phone }) };
        case "copy":
            return { name: "cta_copy", buttonParamsJson: json({ display_text: acao.text, copy_code: acao.code }) };
        case "list":
            return { name: "single_select", buttonParamsJson: json({ title: acao.title, sections: acao.sections }) };
        default:
            throw new Error(`Tipo de ação inválido: ${acao.type}`);
    }
}

export const sendCarousel = (sessionId, data) =>
    executar("Carrossel", sessionId, data, async (sock, jid) => {
        const cards = await Promise.all(
            data.carousel.map(async (item) => {
                if (!item.image && !item.video && !item.document) {
                    throw new Error("Cada card deve conter uma midia image|video|document.");
                }

                const cabecalho = { title: item.title, hasMediaAttachment: false };
                if (item.video) {
                    cabecalho.hasMediaAttachment = true;
                    cabecalho.videoMessage = await enviarMidia(sock, "video", item.video);
                }
                if (item.image) {
                    cabecalho.hasMediaAttachment = true;
                    cabecalho.imageMessage = await enviarMidia(sock, "image", item.image, { caption: undefined });
                }

                return {
                    header: cabecalho,
                    body: { text: item.description },
                    footer: { text: item.footer || "" },
                    nativeFlowMessage: { buttons: item.actions.map(botaoDaAcao) },
                };
            }),
        );

        const mensagem = {
            interactiveMessage: {
                body: { text: data.text || "" },
                footer: { text: data.footer?.text || "" },
                carouselMessage: { cards },
            },
        };
        return enviarComPresenca(sock, jid, mensagem, atrasoDaRequisicao(data));
    });
