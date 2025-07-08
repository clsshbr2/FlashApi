const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const BaileysService = require('../services/BaileysService');
const Store = require('../models/Store');
const logger = require('../utils/logger');

const router = express.Router();


router.get('/list', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const contacts = await Store.getContacts(sessionId);

    res.json({
      success: true,
      data: {
        contacts,
        total: contacts.length
      }
    });

  } catch (error) {
    logger.error('Erro ao listar contatos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/sync', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    // Forçar sincronização manual de contatos
    await BaileysService.syncContactsManually(sessionId);

    // Aguardar um pouco e obter contatos atualizados
    setTimeout(async () => {
      const contacts = await Store.getContacts(sessionId);
      logger.info(`📱 Sincronização manual concluída: ${contacts.length} contatos encontrados`);
    }, 2000);

    res.json({
      success: true,
      message: 'Sincronização de contatos iniciada com sucesso',
      data: {
        sessionId,
        status: 'syncing'
      }
    });

  } catch (error) {
    logger.error('Erro ao sincronizar contatos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/force-sync-all', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    // Forçar sincronização completa
    await BaileysService.forceSyncAll(sessionId);

    res.json({
      success: true,
      message: 'Sincronização completa iniciada com sucesso',
      data: {
        sessionId,
        status: 'syncing_all'
      }
    });

  } catch (error) {
    logger.error('Erro ao sincronizar dados:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/profile', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { jid } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'JID é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const profile = await BaileysService.getContactProfile(sessionId, jid);

    res.json({
      success: true,
      data: profile
    });

  } catch (error) {
    logger.error('Erro ao obter perfil do contato:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/check', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { numbers } = req.body;

    if (!numbers || !Array.isArray(numbers)) {
      return res.status(400).json({
        success: false,
        message: 'Lista de números é obrigatória'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const results = await BaileysService.checkNumbers(sessionId, numbers);

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    logger.error('Erro ao verificar números:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/block', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { jid } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'JID é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    await BaileysService.blockContact(sessionId, jid);

    res.json({
      success: true,
      message: 'Contato bloqueado com sucesso',
      data: { jid, action: 'blocked' }
    });

  } catch (error) {
    logger.error('Erro ao bloquear contato:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/unblock', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { jid } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'JID é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    await BaileysService.unblockContact(sessionId, jid);

    res.json({
      success: true,
      message: 'Contato desbloqueado com sucesso',
      data: { jid, action: 'unblocked' }
    });

  } catch (error) {
    logger.error('Erro ao desbloquear contato:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;