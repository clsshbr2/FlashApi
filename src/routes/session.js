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
    const { numero = null, criar_sessao = false, gerar_qrcode = false, nome_sessao = null } = req.body;

    const uuid = uuidv4();

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
      logger.warn(`Name Sessão: ${nameExist} Ja existe`);
      return res.status(409).json({
        success: false,
        message: `Name Sessão: ${nameExist.nome_sessao} Ja existe tente outro`
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
    let qrcode = 'Erro ao gerar';
    if (criar_sessao) {
      await BaileysService.createSession(uuid, numero);
      if (gerar_qrcode) {
        await BaileysService.delay(2000)
        const getsessao = await Session.findById(uuid);
        if (getsessao && getsessao.qrcode != '') {
          qrcode = getsessao.qrcode
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

    if(!getsessao){
        return res.status(400).json({
        success: false,
        message: 'Sessão não existe'
      });
    }

    if (getsessao.status && getsessao.status == 'connected') {
      return res.status(400).json({
        success: false,
        message: 'Sessão já conectada'
      });
    }

    await BaileysService.createSession(uuid, null);
    await BaileysService.delay(2000);

    if (getsessao && getsessao.qrcode && getsessao.qrcode != '') {
      res.status(200).json({
        success: true,
        qrcode: getsessao.qrcode
      });
    } else {
      res.status(400).json({
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

    if(!getsessao){
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

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    await BaileysService.deleteSession(sessionId);
    await Session.delete(sessionId);

    res.json({
      success: true,
      message: 'Sessão deletada com sucesso'
    });

    logger.info(`Sessão deletada: ${sessionId}`);
  } catch (error) {
    logger.error('Erro ao deletar sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;