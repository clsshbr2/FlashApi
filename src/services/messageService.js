import logger from "../utils/logger.js";
import WhatsAppService from "./WhatsAppService.js";
import fs from "fs";
import path from "path";
import os from "os";

import { Sticker } from "wa-sticker-formatter";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import axios from "axios";
import { prepareMedia } from "../utils/prepareMedia.js";
ffmpeg.setFfmpegPath(ffmpegInstaller.path)

/**
 * @param {string} sessionId
 * @param {object} data  corpo da requisição (jid, text, image, audio, quoted, etc.)
 */
export const sendMessage = async (sessionId, data) => {

    try {
        const sock = WhatsAppService.sockets.get(sessionId);
        if (!sock) return { success: false, message: "Sessão não conectada" };

        const session = await WhatsAppService.GetSessao(sessionId);
        if (!session) return { success: false, message: "Sessão não conectada" };

        const jid = data.jid.includes("@") ? data.jid : `${data.jid}@s.whatsapp.net`;
        const delay = Number.isFinite(Number(data.delay))
            ? Number(data.delay)
            : 1200;

        let mentions = []
        if (data?.MarkAll === true && data.jid.endsWith("@g.us")) {
            const grupos = await sock.groupMetadata(data.jid);
            mentions.push(...grupos.participants.map((p) => p.id));
        }

        const message = {
            linkPreview: data.linkPreview || null
        }

        if (data.message) {
            message.mimetype = data.mimetype || undefined;
        }

        if (data.fileName) {
            message.fileName = data.fileName || undefined;
        }

        if (data?.image) {
            message.image = await prepareMedia(data.image);
            message.fileName = data.fileName || "image.jpg";
            message.mimetype = data.mimetype || "image/jpeg";
        }

        if (data.caption) {
            message.caption = data.caption
        }

        if (data?.video) {
            message.video = await prepareMedia(data.video);
        }

        if (data.audio) {
            let buffer;
            if (data.audio.startsWith("data:audio")) {
                const base64 = data.audio.split(",")[1];
                buffer = Buffer.from(base64, "base64");
            } else {
                const response = await axios.get(data.audio, {
                    responseType: "arraybuffer",
                });

                buffer = Buffer.from(response.data);
            }

            if (data.ptt) {
                buffer = await converterParaOpus(buffer);
            }
            message.audio = buffer;
            message.mimetype = data.ptt ? "audio/ogg; codecs=opus" : "audio/mpeg"
            message.ptt = data.ptt
        }

        if (data.gifPlayback) {
            message.gifPlayback = data.gifPlayback
        }

        if (data.document) {
            message.document = await prepareMedia(data.document);
            message.fileName = data.fileName || "docs.docs";
            message.mimetype = data.mimetype || "application/octet-stream";
        }

        if (data.sticker) {
            message.sticker = await prepareMedia(data.sticker);
        }

        if (data.text) {
            message.text = data.text
        }

        if (data.location) {
            message.location = data.location
        }

        if (data.contact) {
            message.contacts = {
                displayName: data.displayName || "Sem nome",
                contacts: [{ vcard: createVCard(data.contact) }]
            }
        }

        if (data.sticker) {
            message.sticker = await createSticker(data.sticker)
        }

        if (data.react) {
            message.react = {
                text: data?.react?.emoji,
                key: { remoteJid: jid, id: data?.react?.messageId },
            }
        }

        if (data.poll) {
            message.poll = data.poll
        }


        if (mentions.length > 0) {
            message.mentions = mentions;
        }

        const outros = {
            quoted: data.quoted || undefined
        }

        if (data.statusJidList) {
            outros.statusJidList = data.statusJidList || undefined
        }
        if (data.backgroundArgb) {
            outros.backgroundArgb = data.backgroundArgb || undefined
        }
        if (data.font) {
            outros.font = data.font || undefined
        }
        if (data.broadcast) {
            outros.broadcast = data.broadcast || undefined
        }

        await WhatsAppService.delay(delay)
        await sock.sendPresenceUpdate(data.audio ? "recording" : "composing", jid);
        await WhatsAppService.delay(1200)


        if (data.externalAdReply) {
            try {
                const response = await fetch(
                    data.externalAdReply?.thumbnailUrl
                );
                const thumbnail = Buffer.from(await response.arrayBuffer());
                message.linkPreview = true
                message.contextInfo = {
                    externalAdReply: {
                        title: data.externalAdReply?.title,
                        body: data.externalAdReply?.body,
                        sourceUrl: data.externalAdReply?.sourceUrl,
                        thumbnail,
                        renderLargerThumbnail: true,
                        showAdAttribution: false,
                        mediaType: 1
                    }
                }
            } catch (error) { }

        }
        const send = await sock.sendMessage(
            jid,
            message,
            outros
        );
        await WhatsAppService.delay(100)
        await sock.sendPresenceUpdate("paused", jid);
        return { success: true, message: send };

    } catch (error) {
        logger.error('Erro ao enviar message: ', error.message || error)
        return { success: false, message: "Erro ao enviar messagem", error: error.message || error };
    }


};


//Converte audio para ptt
async function converterParaOpus(buffer) {
    const input = path.join(os.tmpdir(), `${Date.now()}.mp3`);
    const output = path.join(os.tmpdir(), `${Date.now()}.ogg`);

    await fs.promises.writeFile(input, buffer);

    await new Promise((resolve, reject) => {
        ffmpeg(input).audioCodec("libopus").format("ogg").on("end", resolve).on("error", reject).save(output);
    });

    const result = await fs.promises.readFile(output);

    fs.unlink(input, () => { });
    fs.unlink(output, () => { });

    return result;
}

//Criar vcard
function createVCard(contact) {
    const {
        firstName,
        lastName = "",
        organization = "",
        jobTitle = "",
        phone,
        email = "",
        website = "",
        address = {}
    } = contact;

    const fullName = [firstName, lastName].filter(Boolean).join(" ");

    return [
        "BEGIN:VCARD",
        "VERSION:3.0",
        `N:${lastName};${firstName};;;`,
        `FN:${fullName}`,
        organization && `ORG:${organization}`,
        jobTitle && `TITLE:${jobTitle}`,
        phone && `TEL;TYPE=CELL:+${phone.replace(/\D/g, "")}`,
        email && `EMAIL;TYPE=INTERNET:${email}`,
        website && `URL:${website}`,
        (address.street || address.city || address.state || address.zip || address.country)
            ? `ADR;TYPE=WORK:;;${address.street || ""};${address.city || ""};${address.state || ""};${address.zip || ""};${address.country || ""}`
            : "",
        "END:VCARD"
    ]
        .filter(Boolean)
        .join("\n");
}

//Criar figurinha
async function createSticker(input) {
    try {
        let imageBuffer;

        if (typeof input === "string" && input.startsWith("data:")) {
            const base64Data = input.split(",")[1];
            imageBuffer = Buffer.from(base64Data, "base64");
        } else {
            imageBuffer = input;
        }

        const sticker = new Sticker(imageBuffer, {
            pack: "Flash API",
            author: "Store",
            type: "full",
            quality: 100,
        });

        return await sticker.toBuffer();
    } catch (error) {
        console.error("Erro ao criar sticker:", error);
        return false;
    }
}

