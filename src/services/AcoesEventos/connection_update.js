import WhatsAppService from "../WhatsAppService.js";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import Session from "../../models/Session.js";
import logger from "../../utils/logger.js";
import config from "../../config/env.js";
import { updateSessao } from "./connection_update_status.js";


export const connection = async (sessionId, update) => {
    const { connection, lastDisconnect, qr } = update;

    const countConnect = WhatsAppService.limitReconnect.get(sessionId) || 0;
    const count = WhatsAppService.countQrcode.get(sessionId) || 0;

    //Limite de conexão
    if (countConnect >= 10) {
        logger.info('Limite de Conexão atingido');
        Session.delete(sessionId, false);
        return;
    }
    WhatsAppService.limitReconnect.set(sessionId, countConnect + 1);

    const sock = WhatsAppService.sockets.get(sessionId)
    if (!sock) return

    const getsessao = await WhatsAppService.GetSessao(sessionId)
    if (!getsessao) return

    if (qr) {
        const limiteQr = parseInt(config.qrcode_limite)
        if (count >= limiteQr) {
            logger.info('Limite de Qrcode atingido');
            Session.delete(sessionId, false);
            return;
        }
        WhatsAppService.countQrcode.set(sessionId, count + 1);

        let code = null

        if (getsessao.numero && getsessao.numero !== "" && !sock.authState?.creds?.registered) {
            try {
                code = await sock.requestPairingCode(getsessao.numero);
                console.log('code: ', code)
            } catch (error) {
                console.log(error)
            }
        }

        logger.info(`Qrcode sessão ${sessionId}`)

        // qrcode.generate(qr, { small: true, });
        const qrCode = await QRCode.toDataURL(qr)
        getsessao.code = code;
        getsessao.qrcode = qrCode
        getsessao.status = "qr_ready";
        void updateSessao(sessionId, getsessao)
    }

    if (connection === "connecting") {
        // Antes gravava a string "connecting" no lugar do objeto da sessão (corrompia o cache no Redis).
        getsessao.status = "connecting";
        void updateSessao(sessionId, getsessao)
    }

    if (connection === "open") {
        getsessao.status = "connected"
        const numero = sock.user.id.split(':')[0] || null
        logger.info(`Sessão ${sessionId} Conectada numero: ${numero} Nome: ${sock.user.name}`)
        getsessao.status = "connected"
        getsessao.numero = numero
        getsessao.qrcode = null
        getsessao.code = null

        void updateSessao(sessionId, getsessao)
        WhatsAppService.countQrcode.delete(sessionId, 0);
        WhatsAppService.limitReconnect.delete(sessionId, 0);

    }

    if (connection === "close") {
        if (sock) { try { sock.ev.removeAllListeners(); sock.end(); } catch { } }
        const statusCode = new Boom(lastDisconnect?.error).output.statusCode;
        const motivo = new Boom(lastDisconnect?.error).output?.payload?.error
        const message = new Boom(lastDisconnect?.error).output?.payload?.message
        const payload = new Boom(lastDisconnect?.error).output?.payload
        logger.info(`sessão desconectado motivo: `, payload)
        getsessao.status = "disconnected"
        void updateSessao(sessionId, getsessao)

        if (statusCode == 515) {
            logger.info(`Status 515 Reniciando sessão: ${sessionId}`)
            getsessao.status = "connecting"
            void updateSessao(sessionId, getsessao)
            await WhatsAppService.delay(3000);
            return WhatsAppService.createSession(sessionId)
        }


        if (statusCode == 401 && message == 'Intentional Logout') {
            logger.info(`Sessão: ${sessionId} Logout Removendo`);
            await Session.delete(sessionId, false);
            return;

        } else {
            logger.info(`Reconectando sessão: ${sessionId}`);
            getsessao.status = "connecting";
            void updateSessao(sessionId, getsessao);
            await WhatsAppService.delay(3000);
            return WhatsAppService.createSession(sessionId);
        }
        void updateSessao(sessionId, getsessao)
        return
    }

}