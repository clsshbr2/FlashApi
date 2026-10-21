import logger from "../../utils/logger.js"
import WhatsAppService from "../WhatsAppService.js"
import { sendMessage } from "../messageService.js"
import redis, { KEYS } from "../redis.js"


export const call = async (sessionId, data) => {

    const sock = WhatsAppService.sockets.get(sessionId)
    if (!sock) return

    const getsesssao = await WhatsAppService.GetSessao(sessionId)
    if (!getsesssao) return;

    for (const call of data) {
        if (getsesssao?.rejeitar_ligacoes && call.status === "offer") {
            await sock.rejectCall(call.id, call.from);
            if (getsesssao?.msg_rejectcalls && getsesssao?.msg_rejectcalls !== "") {
                const message = {
                    text: getsesssao.msg_rejectcalls,
                };

                if (call.from.includes("@lid")) {
                    const lid = call.from.split(':')[0]

                    const getjid = await redis.get(KEYS().lid_map(lid))
                    if (getjid) {
                        call.from = getjid;
                    }
                }
                if (call.callerPn) {
                    call.from = call.callerPn
                }

                const send = await sendMessage(sessionId, {
                    jid: call.from,
                    text: getsesssao.msg_rejectcalls,
                    delay: "1200"
                })
                console.log(send)
            }
            logger.info(`📞 Chamada rejeitada automaticamente de ${call.from}`);
        }
    }
}