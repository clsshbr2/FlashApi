import express from "express";
import { v4 as uuidv4 } from "uuid";
import globalAuth from "../middleware/globalAuth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import Session from "../models/Session.js";
import logger from "../utils/logger.js";
import authenticateApiKey from "../middleware/auth.js";
import axios from "axios";
import path from "path";
import redis, { KEYS } from "../services/redis.js";

const router = express.Router();

//Verificar tipos ao criar sessão
async function tiposCreate(dados) {
  const {
    nome_sessao = "",
    apikey = "",
    proxy = {
      "protocol": "http",
      "username": "teste1234",
      "password": "teste1234",
      "host": "192.168.0.1",
      "port": "8080",
      "active": false
    },
    webhook_url = "",
    webhook_status = 0,
    events = ["message_received"],
    leitura_automatica = false,
    numero = "",
    rejeitar_ligacoes = false,
    msg_rejectcalls = "Não atendo ligações",
    ignorar_grupos = true,
  } = dados

  const activeProxy = proxy?.active || false
  let SessaoId = apikey ? apikey : uuidv4()

  const protocolos = [
    "http",
    "https",
    "socks4",
    "socks4a",
    "socks5",
    "socks5h"
  ];

  let finalNomeSessao = nome_sessao;
  if (nome_sessao.trim() == "") {
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    finalNomeSessao = `instacia_${randomDigits}`;
  }

  if (activeProxy && (!proxy?.protocol || !protocolos.includes(proxy.protocol))) {
    return {
      success: false,
      message: "protocol de proxy inválido."
    }
  }

  if (activeProxy && (!proxy?.username || proxy.username.trim() == '')) {
    return {
      success: false,
      message: "username de proxy inválido."
    }
  }

  if (activeProxy && (!proxy?.password || proxy.password.trim() == '')) {
    return {
      success: false,
      message: "password de proxy inválido."
    }
  }

  if (activeProxy && (!proxy?.host || proxy.host.trim() == '')) {
    return {
      success: false,
      message: "host de proxy inválido."
    }
  }

  if (activeProxy && (!proxy?.port || proxy.port.trim() == '')) {
    return {
      success: false,
      message: "port de proxy inválido."
    }
  }

  if (activeProxy && typeof proxy?.active !== "boolean") {
    return {
      success: false,
      message: "active de proxy inválido deve ser true ou false."
    }
  }

  if (!Array.isArray(events)) {
    return {
      success: false,
      message: "events deve ser um array evendos disponivel: ",
      events: [
        "connection_update",
        "qr_updated",
        "message_received",
        "message_update",
        "chats_set",
        "chats_update",
        "contacts_set",
        "contacts_update",
        "groups_update",
        "group_participants_update",
        "presence_update",
        "call",
        "messaging_history_set"
      ]
    }
  }

  //Verificar apikey e nome
  const getSessaoId = await Session.findById(apikey)
  const getSessaoName = await Session.findByName(finalNomeSessao)
  if (getSessaoId || getSessaoName) {
    return {
      success: false,
      message: "Já existe uma sessão com essa apikey ou com esse nome"
    };
  }

  //verificar status webhook
  if (webhook_status !== 0 && webhook_status !== 1) {
    return {
      success: false,
      message: "webhook_status deve ser 1 ou 0"
    };
  }

  //verificar nome de usuario
  if (!finalNomeSessao || finalNomeSessao.length < 6) {
    return {
      success: false,
      message: "Nome da sessão deve conter 6 ou mais digitos"
    };
  }

  //Verificar tipo de nome de usuario
  if (finalNomeSessao == '<string>') {
    return {
      success: false,
      message: "Nome de sessão invalido",
    }
  }

  //Veirificar apikey
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(SessaoId)) {
    return {
      success: false,
      message: "A apikey fornecida não está no formato UUID v4 válido (ex: 83725a47-fc7a-404a-bbac-206d590bae8f)",
    }
  }

  if (typeof leitura_automatica !== "boolean") {
    return {
      success: false,
      message: "leitura_automatica deve ser true ou false",
    }
  }

  if (typeof rejeitar_ligacoes !== "boolean") {
    return {
      success: false,
      message: "rejeitar_ligacoes deve ser true ou false",
    }
  }

  if (typeof ignorar_grupos !== "boolean") {
    return {
      success: false,
      message: "ignorar_grupos deve ser true ou false",
    }
  }
  dados.nome_sessao = finalNomeSessao;
  dados.apikey = SessaoId;
  return {
    success: true,
    dados
  }
}

//Criar sessão
router.post("/create_sessao", globalAuth.authenticateGlobalApiKey, async (req, res) => {
  const verificar = await tiposCreate(req.body);
  if (!verificar?.success) {
    return res.status(400).json({
      success: false,
      message: verificar.message
    });
  }

  const add_sessao = verificar.dados
  const addSessao = await Session.addsessao(add_sessao)

  if (!addSessao) {
    return res.status(500).json({
      success: false,
      message: "Erro ao adicionar sessão"
    });
  }

  return res.status(200).json({
    success: true,
    message: "Sessão adicionada",
    data: add_sessao
  });

});

router.post("/creds", authenticateApiKey, async (req, res) => {
  try {
    //?apiurl=https://api.exemplo.com/api/session/creds&apikey=
    const sessionId = req.sessao.apikey
    const { creds, keys } = req.body
    const setcreds = await Session.setCreds(sessionId, creds, keys)
    if (setcreds.success) {
      Session.update(sessionId, {
        status: 'connected'
      })
      return res.status(200).json({
        success: true,
        message: "Sessão adicionada",
        data: {}
      });


    }
    return res.status(400).json({
      success: false,
      message: setcreds.message || "Erro ao injeta sessão"
    });
  } catch (error) {
    console.log(error)
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error
    });
  }
});

//Conectar uma sessão
router.put("/conectar_sessao", authenticateApiKey, async (req, res) => {
  try {
    const { numero = null } = req.body
    await WhatsAppService.limitReconnect.set(req.sessao.apikey, 0)
    await WhatsAppService.countQrcode.set(req.sessao.apikey, 0);

    const conect = await WhatsAppService.createSession(req.sessao.apikey, numero)
    await WhatsAppService.delay(4000);
    const sessao = await WhatsAppService.GetSessao(req.sessao.apikey)
    if (!sessao) {
      return res.status(500).json({
        success: false,
        message: "Erro ao buscar QRcode"
      });
    }
    return res.status(200).json({
      success: true,
      message: "Qrcode gerado",
      data: sessao
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao conectar sessão",
      error: error
    });
  }

});

//Reniciar uma sessão
router.put("/restart", authenticateApiKey, async (req, res) => {
  const sock = await WhatsAppService.sockets.get(req.sessao.apikey)
  try { sock.end() } catch (error) { }
  return res.status(200).json({
    success: true,
    message: "Sessão reniciada com sucesso",
    data: {}
  });
});

//Buscar status de uma sessão
router.get("/status", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    if (!sessao) {
      return res.json({
        success: false,
        message: "Sessão não encontrada",
      });
    }
    const proxy = await Session.getProxy(sessao.apikey);


    const dados = {
      ...sessao,
      proxy,
    };
    return res.json({
      success: true,
      dados,
    });
  } catch (error) {
    logger.error("Erro ao obter status:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

//listar sessões
router.get("/list", globalAuth.authenticateGlobalApiKey, async (req, res) => {
  try {
    const getSessao = await Session.findAllSessao();
    const sessionsWithStats = await Promise.all(
      getSessao.map(async (session) => {
        const memorySession = await WhatsAppService.GetSessao(session.apikey);
        return {
          apikey: session.apikey,
          nome_sessao: session.nome_sessao,
          status: session.status,
          phoneNumber: session.numero,
          hasWebhook: !!session.webhook_url,
          createdAt: session.created_at,
          updatedAt: session.updated_at,
          inMemory: !!memorySession,
          isConnected: session.status == "connected" ? 'connected' : 'disconnected',
          reconnectAttempts: 0,
          lastConnected: null,
          connectionAttempts: 0,
        };
      }),
    );
    const stats = {
      total: getSessao.length,
      connected: getSessao.filter((s) => s.status === "connected").length,
      connecting: getSessao.filter((s) => s.status === "connecting" || s.status === "qr_ready").length,
      disconnected: getSessao.filter((s) => s.status === "disconnected").length,
    };

    const data = {
      stats,
      sessions: sessionsWithStats,
    };
    const response = {
      success: true,
      data: {
        ...data,
        total: getSessao.length,
        activeSessions: getSessao.filter((s) => s.status === "connected").length
      },
    };

    res.json(response);
  } catch (error) {
    logger.error("Erro ao listar sessões:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });

  }

});

//Verificar saude da sessão
router.get("/health", globalAuth.authenticateGlobalApiKey, async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Nada pra você ver aqui",
    data: {}
  });
});

//Deletar sessão
router.delete("/delete/:sessionId", globalAuth.authenticateGlobalApiKey, async (req, res) => {
  try {
    const { sessionId = null } = req.params

    if (!sessionId) return res.status(500).json({
      success: false,
      message: "Sessão não encontrada"
    });

    try {
      const sock = await WhatsAppService.sockets.get(sessionId)
      sock.logout();
    } catch (error) { }

    await Session.delete(sessionId, true)
    return res.status(200).json({
      success: true,
      message: "Sessão deletada com sucesso",
      data: {}
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error
    });
  }

});

//Desconectar sessão
router.delete("/desconect/", authenticateApiKey, async (req, res) => {
  try {
    const sock = await WhatsAppService.sockets.get(req.sessao.apikey)
    sock.logout();
    Session.delete(req.sessao.id, false)

    return res.status(200).json({
      success: true,
      message: "Whatsapp desconectado com sucesso",
      data: {}
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Erro ao desconectar whatsapp"
    });

  }
});

//buscar foto de perfil
router.get("/avatar/:apikey", async (req, res) => {
  try {
    const apiKey = req.params.apikey;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: "ApiKey é obrigatória",
      });
    }
    const sock = WhatsAppService.sockets.get(apiKey);

    if (!sock?.user?.id) {
      return res.sendFile(path.resolve("public/images/image.png"));
    }

    let url;
    try {
      url = await sock.profilePictureUrl(sock.user.id, "image");
    } catch {
      url = await sock.profilePictureUrl(sock.user.id, "preview");
    }
    if (!url) return res.sendFile(path.resolve("public/images/image.png"));
    const response = await axios.get(url, {
      responseType: "stream",
      timeout: 5000,
    });

    res.setHeader("Content-Type", "image/jpeg");
    response.data.pipe(res);
  } catch (error) {
    logger.error('Erro ao buscar foto de perfil: ', error)
    return res.sendFile(path.resolve("public/images/image.png"));
  }
});

export default router;
