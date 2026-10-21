import Chats from "../../models/chats.js";
import Contato from "../../models/Contatos.js";
import Message from "../../models/Message.js";
import Session from "../../models/Session.js";
import WhatsAppService from "../WhatsAppService.js";
import redis, { KEYS } from "../redis.js";
import { createLoopWorker } from "./LoopWorker.js";
import { formMessage } from "./Batch/Messagebatch.js";
import { createQueueWorker } from "./QueueWorker.js";
import { utilHandlers } from "./utilHandlers.js";
import { formContatos } from "./Batch/ContatoBatch.js";
import { formChats } from "./Batch/ChatBatch.js";

export const workers = [

    //Workers de chats
    createQueueWorker({
        concurrency: 2, // Total de workers
        name: "Chats",
        client: redis.blockingClients.chat,
        queue: KEYS().Store_chats(),
        validate: async (dados) => {
            if (!await redis.workerClient.get(KEYS().sessao(dados.sessionId))) return false
            if (!dados?.id) return false

            return true
        },
        handler: (dados) => formChats(dados)
    }),

    //Workers de Contatos
    createQueueWorker({
        concurrency: 2, // Total de workers
        name: "Contatos",
        client: redis.blockingClients.contato,
        queue: KEYS().Store_contatos(),
        validate: async (dados) => {
            if (!await redis.workerClient.get(KEYS().sessao(dados.sessionId)))
                return false

            if (dados.id.endsWith('@g.us'))
                return false;

            if (dados.id.endsWith('@newsletter'))
                return false;

            return true;
        },
        handler: (dados) => formContatos(dados)
    }),

    //Workers de mensagens
    createQueueWorker({
        concurrency: 2, // Total de workers
        name: "messages",
        client: redis.blockingClients.message,
        queue: KEYS().Store_mensagens(),
        validate: (dados) => redis.workerClient.get(KEYS().sessao(dados.sessionId)),
        handler: (dados) => formMessage(dados),
    }),

    //Ultilitarios
    createQueueWorker({
        concurrency: 2, // Total de workers
        name: "Utilitarios",
        client: redis.blockingClients.util,
        queue: KEYS().queue_util(),
        validate: (dados) => redis.workerClient.get(KEYS().sessao(dados.sessionId)),
        handler: async (dados) => {
            const handler = utilHandlers[dados.type];
            if (!handler) {
                return
            }
            await handler(dados)
        },
    }),

    // Loop de sessão
    // createLoopWorker({
    //     name: "Sessões",
    //     interval: 3000,
    //     handler: async () => {
    //         for (const [id, sock] of WhatsAppService.sockets) {

    //             if (sock.status === "open") {
    //                 await Session.update(id, {
    //                     status: "connected"
    //                 });
    //             }
    //         }
    //     }
    // })

];