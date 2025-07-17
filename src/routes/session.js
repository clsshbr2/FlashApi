const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticateGlobalApiKey } = require('../middleware/globalAuth');
const BaileysService = require('../services/BaileysService');
const Session = require('../models/Session');
const logger = require('../utils/logger');
const { authenticateApiKey } = require('../middleware/auth');

const router = express.Router();


router.post('/create_sessao', authenticateGlobalApiKey, async (req, res) => {
  try {
    const { numero = null, criar_sessao = false, gerar_qrcode = false, nome_sessao = null, apikey = null } = req.body;

    const uuid = !apikey ? uuidv4() : apikey;

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      logger.warn(`Apikey inválida: ${uuid}`);
      return res.status(400).json({
        success: false,
        message: 'A apikey fornecida não está no formato UUID v4 válido (ex: 83725a47-fc7a-404a-bbac-206d590bae8f)',
      });
    }

    let finalNomeSessao;
    if (nome_sessao === null || nome_sessao === '') {
      const randomDigits = Math.floor(10000 + Math.random() * 90000);
      finalNomeSessao = `instacia_${randomDigits}`;

    } else {
      if (nome_sessao.length <= 5) {
        logger.warn(`Nome da sessão "${nome_sessao}" é inválido: deve ter mais de 5 caracteres`);
        return res.status(400).json({
          success: false,
          message: 'Nome da sessão deve ter mais de 5 caracteres'
        });
      }
      finalNomeSessao = nome_sessao;
    }

    //Verificar se sessão existe
    const getsessao = await Session.findByApiKey();
    const apikeyExist = getsessao.find(a => a.apikey === uuid)
    if (apikeyExist) {
      logger.warn(`A apikey: ${uuid} gerada já existe tente novamente`);
      return res.status(409).json({
        success: false,
        message: 'A apikey gerada já existe tente novamente'
      });
    }

    const nameExist = getsessao.find(a => a.nome_sessao === nome_sessao)

    if (nameExist) {
      logger.warn(`Name Sessão: ${nameExist} Já existe`);
      return res.status(409).json({
        success: false,
        message: `Name Sessão: ${nameExist.nome_sessao} Já existe tente outro`
      });
    }


    //Adicionar sessão
    const addapikey = await Session.addsessao({ uuid, numero, finalNomeSessao });
    if (!addapikey) {
      logger.warn(`Erro ao criar apikey`);
      return res.status(409).json({
        success: false,
        message: 'Erro ao criar apikey'
      });
    }
    let qrcode = null;
    let code = null;
    if (criar_sessao) {
      await BaileysService.createSession(uuid, numero);
      if (gerar_qrcode) {
        await BaileysService.delay(3000)
        const getsessao = await Session.findById(uuid);
        if (getsessao && getsessao.qrcode != '') {
          qrcode = getsessao.qrcode
          code = getsessao.code
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'sessão criada com sucesso',
      dados: {
        apikey: uuid,
        name: finalNomeSessao,
        qrcode
      }

    });

  } catch (error) {
    logger.error('Erro ao criar apikey:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro ao criar apikey'
    });
  }
});

router.put('/conectar_sessao', authenticateApiKey, async (req, res) => {
  try {
    const uuid = req.headers['apikey'];
    const getsessao = await Session.findById(uuid);

    if (!getsessao) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não existe'
      });
    }

    if (getsessao.status && getsessao.status == 'connected' ) {
      return res.status(200).json({
        success: true,
        message: 'Sessão já conectada'
      });
    }
    if (getsessao.status && getsessao.status == 'connecting' ) {
      return res.status(200).json({
        success: true,
        message: 'Sessão já conectada'
      });
    }
    if (getsessao.status == 'qr_ready' && getsessao.qrcode !== null) {
      res.status(200).json({
        success: true,
        message: 'Qrcode recuperado com sucesso',
        qrcode: getsessao.qrcode,
        code: getsessao.code
      });
      return
    }

    await BaileysService.createSession(uuid, getsessao.numero);
    await BaileysService.delay(4000);
    const getqr = await Session.findById(uuid);
    if (getqr && getqr.qrcode && getqr.qrcode != '') {
      res.status(200).json({
        success: true,
        message: 'Qrcode Gerado com sucesso',
        qrcode: getqr.qrcode,
        code: getqr.code
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Erro ao buscar qrcode caso continue delete a sessao e crie outra'
      });
    }

  } catch (error) {
    logger.error('Erro ao criar sessão:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.put('/restart', authenticateApiKey, async (req, res) => {
  try {
    const uuid = req.headers['apikey'];
    const getsessao = await Session.findById(uuid);

    if (!getsessao) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não existe'
      });
    }

    if (getsessao.status && getsessao.status != 'connected' && getsessao.status != 'connecting') {
      return res.status(400).json({
        success: false,
        message: 'Sessão Deve está conectada'
      });
    }

    await BaileysService.createSession(uuid, null);
    await BaileysService.delay(2000);

    return res.status(200).json({
      success: true,
      message: 'Sessão reniciada'
    });

  } catch (error) {
    logger.error('Erro ao criar sessão:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.get('/status', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    const memorySession = BaileysService.getSession(sessionId);
    const inMemory = !!memorySession;
    const memoryStatus = memorySession?.status || 'not_in_memory';

    res.json({
      success: true,
      data: {
        id: session.apikey,
        status: session.status,
        phoneNumber: session.numero,
        hasWebhook: !!session.webhook_url,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        inMemory,
        memoryStatus,
        isConnected: BaileysService.isSessionConnected(sessionId),
        reconnectAttempts: memorySession?.reconnectAttempts || 0,
        lastConnected: memorySession?.lastConnected || null,
        connectionAttempts: memorySession?.connectionAttempts || 0
      }
    });
  } catch (error) {
    logger.error('Erro ao obter status:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/list', authenticateGlobalApiKey, async (req, res) => {
  try {
    const sessions = await Session.findByApiKey();

    const sessionsWithStats = sessions.map(session => {
      const memorySession = BaileysService.getSession(session.apikey);
      return {
        id: session.apikey,
        nome_sessao: session.nome_sessao,
        status: session.status,
        phoneNumber: session.numero,
        hasWebhook: !!session.webhook_url,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        inMemory: !!memorySession,
        memoryStatus: memorySession?.status || 'not_in_memory',
        isConnected: BaileysService.isSessionConnected(session.apikey),
        reconnectAttempts: memorySession?.reconnectAttempts || 0,
        lastConnected: memorySession?.lastConnected || null,
        connectionAttempts: memorySession?.connectionAttempts || 0
      };
    });

    res.json({
      success: true,
      data: {
        sessions: sessionsWithStats,
        total: sessionsWithStats.length,
        stats: BaileysService.getSessionsStats(),
        activeSessions: BaileysService.getActiveSessions()
      }
    });
  } catch (error) {
    logger.error('Erro ao listar sessões:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/reconnect', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    await BaileysService.reconnectSession(sessionId);

    res.json({
      success: true,
      message: 'Reconexão iniciada com sucesso',
      data: {
        sessionId,
        status: 'connecting'
      }
    });

    logger.info(`Reconexão manual iniciada: ${sessionId}`);
  } catch (error) {
    logger.error('Erro ao reconectar sessão:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.get('/health', authenticateGlobalApiKey, async (req, res) => {
  try {
    const healthData = await BaileysService.healthCheck();

    res.json({
      success: true,
      data: healthData
    });
  } catch (error) {
    logger.error('Erro ao verificar saúde do sistema:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.delete('/delete/:sessionId', authenticateGlobalApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;

    let sessao = await Session.findById(sessionId);

    if (!sessao) {
      sessao = await Session.findByName(sessionId);
    }

    if (!sessao) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    await BaileysService.deleteSession(sessao.apikey, true);
    await Session.delete(sessao.apikey);

    res.json({
      success: true,
      message: 'Sessão deletada com sucesso'
    });

    logger.info(`Sessão deletada: ${sessao.apikey}`);
  } catch (error) {
    logger.error('Erro ao deletar sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.delete('/desconect/:sessionId', authenticateApiKey, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const apiKey = req.headers['apikey'];

    let sessao = await Session.findById(sessionId);

    if (!sessao) {
      sessao = await Session.findByName(sessionId);
      if (apiKey !== sessao.apikey) {
        return res.status(404).json({
          success: false,
          message: 'Essa apikey não corresponde a essa sessão'
        });
      }
    }

    if (!sessao) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    const sessionData = BaileysService.sessions.get(sessionId);

    if (!sessionData) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não foi iniciada ainda'
      });
    }
    if (sessionData.sock) {
      try {
        if (sessionData.sock.ws && sessionData.sock.ws.readyState === 1) {
          // 1 = WebSocket.OPEN
          await sessionData.sock.logout();
        } else {
          console.warn("⚠️ WebSocket já fechado. Pulando logout.");
        }

        await sessionData.sock.end().catch(err => {
          console.warn("⚠️ Erro ao encerrar sessão com .end():", err.message);
        });

        if (sessionData.sock.ws && sessionData.sock.ws.readyState !== 3) {
          // 3 = WebSocket.CLOSED
          sessionData.sock.ws.close();
        }

      } catch (err) {
        console.error("❌ Erro ao encerrar sessão:", err.message);
      }
    }

    BaileysService.sessions.delete(sessionId);
    await Session.saveCreds(sessionId, null)
    await Session.update(sessionId, {
      qr_code: 'null',
      code: 'null',
      status: 'disconnected'
    })

    res.json({
      success: true,
      message: 'Sessão Desconectada com sucesso'
    });

    logger.info(`Sessão Desconectada: ${sessao.apikey}`);
  } catch (error) {
    console.log(error)
    logger.error('Erro ao Desconectada sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;