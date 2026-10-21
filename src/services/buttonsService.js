import { generateWAMessageFromContent, proto } from "@whiskeysockets/baileys";
import { prepararMidia } from "./midiaBotoes.js";
import BaileysService from "./BaileysService.js";
import logger from "../utils/logger.js";
import { prepareMedia } from "../utils/prepareMedia.js";

const BIZ_NATIVE_LIST = [
    {
        tag: "biz",
        attrs: {},
        content: [
            {
                tag: "list",
                attrs: { type: "product_list", v: "2" },
            },
        ],
    },
];

const BIZ_NATIVE_FLOW_NODE = [
    {
        tag: "biz",
        attrs: {},
        content: [
            {
                tag: "interactive",
                attrs: { type: "native_flow", v: "1" },
                content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }],
            },
        ],
    },
];

//Enviar lista
export const sendList = async (sessionId, data) => {
    try {
        /** @type {import("@whiskeysockets/baileys").WASocket} */
        const sock = BaileysService.sockets.get(sessionId);
        if (!sock) return { success: false, message: "Sessão não conectada" };

        const session = await BaileysService.GetSessao(sessionId);
        if (!session) return { success: false, message: "Sessão não conectada" };

        const jid = data.jid.includes("@") ? data.jid : `${data.jid}@s.whatsapp.net`;
        const delay = Number.isFinite(Number(data.delay))
            ? Number(data.delay)
            : 1200;

        const payloadList = {
            listMessage: proto.Message.ListMessage.fromObject({
                title: data.title,
                description: data.description,
                buttonText: data.buttonText,
                footerText: data.footerText,
                listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
                sections: data.sections.map((sec) =>
                    proto.Message.ListMessage.Section.fromObject({
                        title: sec.title,
                        rows: sec.rows.map((row) =>
                            proto.Message.ListMessage.Row.fromObject({
                                title: row.title,
                                rowId: row.rowId,
                                description: row.description || "",
                            }),
                        ),
                    }),
                ),
            }),
        };

        await BaileysService.delay(delay)
        await sock.sendPresenceUpdate("composing", jid);
        await BaileysService.delay(1200)
        const msg = generateWAMessageFromContent(jid, payloadList, {
            userJid: sock.user.id,
        });

        const send = await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: BIZ_NATIVE_LIST,
        });
        await BaileysService.delay(100)
        await sock.sendPresenceUpdate("paused", jid);
        return { success: true, message: send }
    } catch (error) {
        console.log(error)
        logger.error('Erro ao enviar Lista: ', error.message || error)
        return { success: false, message: "Erro ao enviar Lista", error: error.message || error };
    }

}

//Enviar butoes reply
export const sendButton = async (sessionId, data) => {
    try {
        /** @type {import("@whiskeysockets/baileys").WASocket} */
        const sock = BaileysService.sockets.get(sessionId);
        if (!sock) return { success: false, message: "Sessão não conectada" };

        const session = await BaileysService.GetSessao(sessionId);
        if (!session) return { success: false, message: "Sessão não conectada" };

        const jid = data.jid.includes("@") ? data.jid : `${data.jid}@s.whatsapp.net`;
        const delay = Number.isFinite(Number(data.delay))
            ? Number(data.delay)
            : 1200;

        const payloadButtons = {
            buttonsMessage: proto.Message.ButtonsMessage.fromObject({
                contentText: data.text,
                footerText: data.footer,
                headerType: proto.Message.ButtonsMessage.HeaderType.EMPTY,
                buttons: data.buttons.map((btn) =>
                    proto.Message.ButtonsMessage.Button.fromObject({
                        buttonId: btn.buttonId,
                        buttonText: { displayText: btn.buttonText.displayText },
                        type: proto.Message.ButtonsMessage.Button.Type.RESPONSE,
                    }),
                ),
            }),
        };

        if (data.video) {
            let video
            if (Buffer.isBuffer(data?.video?.url)) {
                video = data.video.url;
            } else if (typeof data?.video?.url === "string") {
                if (data.video.url.startsWith("data:")) {
                    const base64Data = data?.video?.url.split(",")[1];
                    video = Buffer.from(base64Data, "base64");
                } else if (data?.video?.url.startsWith("http")) {
                    video = { url: data?.video?.url };
                }
            }
            const media = await prepararMidia(sock, { video, caption: data?.video?.caption || "" });
            payloadButtons.buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.VIDEO
            payloadButtons.buttonsMessage.videoMessage = media.videoMessage
        }

        if (data.image) {
            let image
            if (Buffer.isBuffer(data?.image?.url)) {
                image = data?.image?.url;
            } else if (typeof data?.image?.url === "string") {
                if (data?.image?.url.startsWith("data:")) {
                    const base64Data = data?.image?.url.split(",")[1];
                    image = Buffer.from(base64Data, "base64");
                } else if (data?.image?.url.startsWith("http")) {
                    image = { url: data?.image?.url };
                }
            }
            const media = await prepararMidia(sock, { image, caption: data?.image?.caption || "" });
            payloadButtons.buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.IMAGE
            payloadButtons.buttonsMessage.imageMessage = media.imageMessage
        }

        if (data.document) {
            let document
            if (Buffer.isBuffer(data?.document?.url)) {
                document = data?.document?.url;
            } else if (typeof data?.document?.url === "string") {
                if (data?.document?.url.startsWith("data:")) {
                    const base64Data = data?.document?.url.split(",")[1];
                    document = Buffer.from(base64Data, "base64");
                } else if (data?.document?.url.startsWith("http")) {
                    document = { url: data?.document?.url };
                }
            }
            const media = await prepararMidia(sock, { document, caption: data?.document?.caption || "" });
            payloadButtons.buttonsMessage.headerType = proto.Message.ButtonsMessage.HeaderType.DOCUMENT
            payloadButtons.buttonsMessage.documentMessage = media.documentMessage
        }


        await BaileysService.delay(delay)
        await sock.sendPresenceUpdate("composing", jid);
        await BaileysService.delay(1200)
        const msg = generateWAMessageFromContent(jid, payloadButtons, {
            userJid: sock.user.id,
        });

        const send = await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: BIZ_NATIVE_FLOW_NODE,
        });
        await BaileysService.delay(100)
        await sock.sendPresenceUpdate("paused", jid);
        return { success: true, message: send }
    } catch (error) {
        console.log(error)
        logger.error('Erro ao enviar Lista: ', error.message || error)
        return { success: false, message: "Erro ao enviar Lista", error: error.message || error };
    }

}

//Enviar interactives
export const sendinteractiveMessage = async (sessionId, data) => {
    try {
        /** @type {import("@whiskeysockets/baileys").WASocket} */
        const sock = BaileysService.sockets.get(sessionId);
        if (!sock) return { success: false, message: "Sessão não conectada" };

        const session = await BaileysService.GetSessao(sessionId);
        if (!session) return { success: false, message: "Sessão não conectada" };

        const jid = data.jid.includes("@") ? data.jid : `${data.jid}@s.whatsapp.net`;
        const delay = Number.isFinite(Number(data.delay))
            ? Number(data.delay)
            : 1200;

        const payloadButtons = {
            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                header: proto.Message.InteractiveMessage.Header.fromObject({
                    title: data?.header?.title || "",
                    subtitle: data?.header?.subtitle || "",
                    hasMediaAttachment: false
                }),
                body: proto.Message.InteractiveMessage.Body.fromObject({
                    text: data?.body?.text || "",
                }),
                footer: proto.Message.InteractiveMessage.Footer.fromObject({
                    text: data?.footer?.text || "",
                }),
                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                    buttons: data.buttons.map(button => ({
                        name: button.name,
                        buttonParamsJson: typeof button.buttonParamsJson === "string"
                            ? button.buttonParamsJson
                            : JSON.stringify(button.buttonParamsJson)
                    }))
                }),
            }),
        };

        if (data.video) {
            let video
            if (Buffer.isBuffer(data?.video?.url)) {
                video = data.video.url;
            } else if (typeof data?.video?.url === "string") {
                if (data.video.url.startsWith("data:")) {
                    const base64Data = data?.video?.url.split(",")[1];
                    video = Buffer.from(base64Data, "base64");
                } else if (data?.video?.url.startsWith("http")) {
                    video = { url: data?.video?.url };
                }
            }
            const media = await prepararMidia(sock, { video, caption: data?.video?.caption || "" });
            payloadButtons.interactiveMessage.header.hasMediaAttachment = true
            payloadButtons.interactiveMessage.header.videoMessage = media.videoMessage
        }

        if (data.image) {
            let image
            if (Buffer.isBuffer(data?.image?.url)) {
                image = data?.image?.url;
            } else if (typeof data?.image?.url === "string") {
                if (data?.image?.url.startsWith("data:")) {
                    const base64Data = data?.image?.url.split(",")[1];
                    image = Buffer.from(base64Data, "base64");
                } else if (data?.image?.url.startsWith("http")) {
                    image = { url: data?.image?.url };
                }
            }
            const media = await prepararMidia(sock, { image });
            payloadButtons.interactiveMessage.header.hasMediaAttachment = true
            payloadButtons.interactiveMessage.header.imageMessage = media.imageMessage
        }

        if (data.document) {
            let document
            if (Buffer.isBuffer(data?.document?.url)) {
                document = data?.document?.url;
            } else if (typeof data?.document?.url === "string") {
                if (data?.document?.url.startsWith("data:")) {
                    const base64Data = data?.document?.url.split(",")[1];
                    document = Buffer.from(base64Data, "base64");
                } else if (data?.document?.url.startsWith("http")) {
                    document = { url: data?.document?.url };
                }
            }
            const media = await prepararMidia(sock, { document, mimetype: data?.document?.mimetype || "application/octet-stream", fileName: data?.document?.fileName || "docs.docs" });
            payloadButtons.interactiveMessage.header.hasMediaAttachment = true
            payloadButtons.interactiveMessage.header.documentMessage = media.documentMessage
        }


        await BaileysService.delay(delay)
        await sock.sendPresenceUpdate("composing", jid);
        await BaileysService.delay(1200)
        const msg = generateWAMessageFromContent(jid, payloadButtons, {
            userJid: sock.user.id,
        });

        const send = await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: BIZ_NATIVE_FLOW_NODE,
        });
        await BaileysService.delay(100)
        await sock.sendPresenceUpdate("paused", jid);
        return { success: true, message: send }
    } catch (error) {
        console.log(error)
        logger.error('Erro ao enviar Lista: ', error.message || error)
        return { success: false, message: "Erro ao enviar Lista", error: error.message || error };
    }

}

//Enviar carousel
export const sendCarousel = async (sessionId, data) => {
    try {
        /** @type {import("@whiskeysockets/baileys").WASocket} */
        const sock = BaileysService.sockets.get(sessionId);
        if (!sock) return { success: false, message: "Sessão não conectada" };

        const session = await BaileysService.GetSessao(sessionId);
        if (!session) return { success: false, message: "Sessão não conectada" };

        const jid = data.jid.includes("@") ? data.jid : `${data.jid}@s.whatsapp.net`;
        const delay = Number.isFinite(Number(data.delay))
            ? Number(data.delay)
            : 1200;

        const cards = await Promise.all(
            data.carousel.map(async (item) => {
                if (!item.image && !item.video && !item.document) {
                    return {
                        success: false,
                        message: 'Cada card deve conter uma midia image|video|document.',
                    };
                }

                const header = {
                    title: item.title,
                    hasMediaAttachment: false,
                }
                if (item.video) {
                    let video
                    if (Buffer.isBuffer(item?.video?.url)) {
                        video = item.video.url;
                    } else if (typeof item?.video?.url === "string") {
                        if (item.video.url.startsWith("data:")) {
                            const base64Data = item?.video?.url.split(",")[1];
                            video = Buffer.from(base64Data, "base64");
                        } else if (item?.video?.url.startsWith("http")) {
                            video = { url: item?.video?.url };
                        }
                    }
                    const media = await prepararMidia(sock, { video, caption: data?.video?.caption || "" });
                    header.hasMediaAttachment = true
                    header.videoMessage = media.videoMessage
                }

                if (item.image) {
                    let image
                    if (Buffer.isBuffer(item?.image?.url)) {
                        image = item?.image?.url;
                    } else if (typeof item?.image?.url === "string") {
                        if (item?.image?.url.startsWith("data:")) {
                            const base64Data = item?.image?.url.split(",")[1];
                            image = Buffer.from(base64Data, "base64");
                        } else if (item?.image?.url.startsWith("http")) {
                            image = { url: item?.image?.url };
                        }
                    }
                    const media = await prepararMidia(sock, { image });
                    header.hasMediaAttachment = true
                    header.imageMessage = media.imageMessage
                }

                // if (item.document) {
                //     let document
                //     if (Buffer.isBuffer(item?.document?.url)) {
                //         document = item?.document?.url;
                //     } else if (typeof item?.document?.url === "string") {
                //         if (item?.document?.url.startsWith("data:")) {
                //             const base64Data = item?.document?.url.split(",")[1];
                //             document = Buffer.from(base64Data, "base64");
                //         } else if (item?.document?.url.startsWith("http")) {
                //             document = { url: item?.document?.url };
                //         }
                //     }
                //     const media = await prepararMidia(sock, { document, mimetype: item?.document?.mimetype || "application/octet-stream", fileName: item?.document?.fileName || "docs.docs", title: "teste" });
                //     header.hasMediaAttachment = true
                //     header.documentMessage = media.documentMessage
                // }

                return {
                    header: header,
                    body: {
                        text: item.description,
                    },
                    footer: {
                        text: item.footer || "",
                    },
                    carouselCardType: proto.Message.InteractiveMessage.CarouselMessage.CarouselCardType.HSCROLL_CARDS,
                    nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.create({
                        buttons: item.actions.map((action) => {
                            switch (action.type) {
                                case "reply":
                                    return {
                                        name: "quick_reply",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: action.text,
                                            id: action.id
                                        })
                                    };

                                case "url":
                                    return {
                                        name: "cta_url",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: action.text,
                                            url: action.url
                                        })
                                    };

                                case "call":
                                    return {
                                        name: "cta_call",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: action.text,
                                            phone_number: action.phone
                                        })
                                    };

                                case "copy":
                                    return {
                                        name: "cta_copy",
                                        buttonParamsJson: JSON.stringify({
                                            display_text: action.text,
                                            copy_code: action.code
                                        })
                                    };

                                case "list":
                                    return {
                                        name: "single_select",
                                        buttonParamsJson: JSON.stringify({
                                            title: action.title,
                                            sections: action.sections
                                        })
                                    };

                                default:
                                    throw new Error(`Tipo de ação inválido: ${action.type}`);
                            }
                        })
                    }),
                };
            }),
        );

        const payload = {
            interactiveMessage: proto.Message.InteractiveMessage.create({
                body: proto.Message.InteractiveMessage.Body.create({
                    text: data.text || "",
                }),
                footer: proto.Message.InteractiveMessage.Footer.create({
                    text: data.footer.text || "",
                    hasMediaAttachment: false
                }),
                carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
                    cards,
                }),
            }),
        };

        await BaileysService.delay(delay)
        await sock.sendPresenceUpdate("composing", jid);
        await BaileysService.delay(1200)
        const msg = generateWAMessageFromContent(jid, payload, {
            userJid: sock.user.id,
        });

        const send = await sock.relayMessage(jid, msg.message, {
            messageId: msg.key.id,
            additionalNodes: BIZ_NATIVE_FLOW_NODE,
        });
        await BaileysService.delay(100)
        await sock.sendPresenceUpdate("paused", jid);
        return { success: true, message: send }
    } catch (error) {
        console.log(error)
        logger.error('Erro ao enviar Lista: ', error.message || error)
        return { success: false, message: "Erro ao enviar Lista", error: error.message || error };
    }

}