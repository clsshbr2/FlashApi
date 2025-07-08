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

    const groups = await Store.getGroups(sessionId);

    res.json({
      success: true,
      data: {
        groups,
        total: groups.length
      }
    });

  } catch (error) {
    logger.error('Erro ao listar grupos:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/info', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: 'groupJid é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const groupInfo = await BaileysService.getGroupInfo(sessionId, groupJid);

    res.json({
      success: true,
      data: groupInfo
    });

  } catch (error) {
    logger.error('Erro ao obter informações do grupo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/create', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { subject, participants } = req.body;

    if (!subject || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: 'subject e participants são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.createGroup(sessionId, subject, participants);

    res.json({
      success: true,
      message: 'Grupo criado com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao criar grupo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/add-participant', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, participants } = req.body;

    if (!groupJid || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e participants são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.addParticipants(sessionId, groupJid, participants);

    res.json({
      success: true,
      message: 'Participantes adicionados com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao adicionar participantes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/remove-participant', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, participants } = req.body;

    if (!groupJid || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e participants são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.removeParticipants(sessionId, groupJid, participants);

    res.json({
      success: true,
      message: 'Participantes removidos com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao remover participantes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/promote', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, participants } = req.body;

    if (!groupJid || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e participants são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.promoteParticipants(sessionId, groupJid, participants);

    res.json({
      success: true,
      message: 'Participantes promovidos com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao promover participantes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/demote', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, participants } = req.body;

    if (!groupJid || !participants || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e participants são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.demoteParticipants(sessionId, groupJid, participants);

    res.json({
      success: true,
      message: 'Participantes rebaixados com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao rebaixar participantes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/leave', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: 'groupJid é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    await BaileysService.leaveGroup(sessionId, groupJid);

    res.json({
      success: true,
      message: 'Saiu do grupo com sucesso',
      data: { groupJid }
    });

  } catch (error) {
    logger.error('Erro ao sair do grupo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/update-subject', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, subject } = req.body;

    if (!groupJid || !subject) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e subject são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    await BaileysService.updateGroupSubject(sessionId, groupJid, subject);

    res.json({
      success: true,
      message: 'Nome do grupo atualizado com sucesso',
      data: { groupJid, subject }
    });

  } catch (error) {
    logger.error('Erro ao atualizar nome do grupo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/update-description', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { groupJid, description } = req.body;

    if (!groupJid || !description) {
      return res.status(400).json({
        success: false,
        message: 'groupJid e description são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    await BaileysService.updateGroupDescription(sessionId, groupJid, description);

    res.json({
      success: true,
      message: 'Descrição do grupo atualizada com sucesso',
      data: { groupJid, description }
    });

  } catch (error) {
    logger.error('Erro ao atualizar descrição do grupo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;