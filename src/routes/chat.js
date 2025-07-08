const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const BaileysService = require('../services/BaileysService');
const Session = require('../models/Session');
const Store = require('../models/Store');
const MessageQueueService = require('../services/MessageQueueService');
const logger = require('../utils/logger');
const Chats = require('../models/chats');

const router = express.Router();


router.post('/send-text', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, text, linkPreview = true, mentions, delay = 0, useQueue = false } = req.body;

    if (!to || !text) {
      return res.status(400).json({
        success: false,
        message: 'to e text são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      text,
      linkPreview: linkPreview
    };

    if (mentions && mentions.length > 0) {
      message.mentions = mentions;
    }


    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Mensagem adicionada à fila' : 'Mensagem de texto enviada com sucesso',
      data: result
    });

    logger.info(`Mensagem de texto ${useQueue ? 'enfileirada' : 'enviada'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar mensagem de texto:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-image', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, image, caption, mentions, delay = 0, useQueue = false } = req.body;

    if (!to || !image) {
      return res.status(400).json({
        success: false,
        message: 'to e image são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      image: { url: image },
      caption: caption || ''
    };

    if (mentions && mentions.length > 0) {
      message.mentions = mentions;
    }

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Imagem adicionada à fila' : 'Imagem enviada com sucesso',
      data: result
    });

    logger.info(`Imagem ${useQueue ? 'enfileirada' : 'enviada'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar imagem:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-video', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, video, caption, gifPlayback = false, delay = 0, useQueue = false } = req.body;

    if (!to || !video) {
      return res.status(400).json({
        success: false,
        message: 'to e video são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      video: { url: video },
      caption: caption || '',
      gifPlayback
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Vídeo adicionado à fila' : 'Vídeo enviado com sucesso',
      data: result
    });

    logger.info(`Vídeo ${useQueue ? 'enfileirado' : 'enviado'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar vídeo:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-audio', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, audio, ptt = false, delay = 0, useQueue = false } = req.body;

    if (!to || !audio) {
      return res.status(400).json({
        success: false,
        message: 'to e audio são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      audio: { url: audio },
      ptt
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Áudio adicionado à fila' : 'Áudio enviado com sucesso',
      data: result
    });

    logger.info(`Áudio ${useQueue ? 'enfileirado' : 'enviado'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar áudio:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-document', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, document, fileName, mimetype, caption, delay = 0, useQueue = false } = req.body;

    if (!to || !document || !fileName) {
      return res.status(400).json({
        success: false,
        message: 'to, document e fileName são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      document: { url: document },
      fileName,
      mimetype: mimetype || 'application/octet-stream',
      caption: caption || ''
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Documento adicionado à fila' : 'Documento enviado com sucesso',
      data: result
    });

    logger.info(`Documento ${useQueue ? 'enfileirado' : 'enviado'}: ${sessionId} -> ${to}`);
  } catch (error) {

    logger.error('Erro ao enviar documento:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-location', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, latitude, longitude, name, address, delay = 0, useQueue = false } = req.body;

    if (!to || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'to, latitude e longitude são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      location: {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
        name: name || '',
        address: address || ''
      }
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Localização adicionada à fila' : 'Localização enviada com sucesso',
      data: result
    });

    logger.info(`Localização ${useQueue ? 'enfileirada' : 'enviada'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar localização:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-contact', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, contact, delay = 0, useQueue = false } = req.body;

    if (!to || !contact) {
      return res.status(400).json({
        success: false,
        message: 'to e contact são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      contacts: {
        displayName: contact.displayName,
        contacts: [{ vcard: contact.vcard }]
      }
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Contato adicionado à fila' : 'Contato enviado com sucesso',
      data: result
    });

    logger.info(`Contato ${useQueue ? 'enfileirado' : 'enviado'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar contato:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-sticker', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, sticker, delay = 0, useQueue = false } = req.body;

    if (!to || !sticker) {
      return res.status(400).json({
        success: false,
        message: 'to e sticker são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      sticker: { url: sticker }
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Sticker adicionado à fila' : 'Sticker enviado com sucesso',
      data: result
    });

    logger.info(`Sticker ${useQueue ? 'enfileirado' : 'enviado'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar sticker:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-reaction', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, messageId, emoji } = req.body;

    if (!to || !messageId || emoji === undefined) {
      return res.status(400).json({
        success: false,
        message: 'to, messageId e emoji são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.sendReaction(sessionId, to, messageId, emoji);

    res.json({
      success: true,
      message: emoji ? 'Reação enviada com sucesso' : 'Reação removida com sucesso',
      data: result
    });

    logger.info(`Reação ${emoji ? 'enviada' : 'removida'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar reação:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/send-poll', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, name, options, selectableCount = 1, delay = 0, useQueue = false } = req.body;

    if (!to || !name || !options || !Array.isArray(options)) {
      return res.status(400).json({
        success: false,
        message: 'to, name e options são obrigatórios'
      });
    }

    if (options.length < 2 || options.length > 12) {
      return res.status(400).json({
        success: false,
        message: 'A enquete deve ter entre 2 e 12 opções'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const message = {
      poll: {
        name,
        values: options,
        selectableCount
      }
    };

    const sendFunction = async () => {
      await BaileysService.sendTyping(sessionId, to, true)
      if (delay > 0) {
        await BaileysService.delay(delay);
      }
      await BaileysService.sendMessage(sessionId, to, message);
      return await BaileysService.sendTyping(sessionId, to, false)
    };

    let result;
    if (useQueue) {
      const queueInfo = await MessageQueueService.addToQueue(sessionId, {
        sendFunction,
        delay
      });

      result = {
        queued: true,
        queuePosition: queueInfo.queuePosition,
        estimatedDelay: queueInfo.estimatedDelay
      };
    } else {
      result = await sendFunction();
    }

    res.json({
      success: true,
      message: useQueue ? 'Enquete adicionada à fila' : 'Enquete enviada com sucesso',
      data: result
    });

    logger.info(`Enquete ${useQueue ? 'enfileirada' : 'enviada'}: ${sessionId} -> ${to}`);
  } catch (error) {
    logger.error('Erro ao enviar enquete:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/typing', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { to, typing } = req.body;

    if (!to || typing === undefined) {
      return res.status(400).json({
        success: false,
        message: 'to e typing são obrigatórios'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.sendTyping(sessionId, to, typing);

    res.json({
      success: true,
      message: `Status de digitação ${typing ? 'iniciado' : 'parado'} com sucesso`,
      data: result
    });

  } catch (error) {
    logger.error('Erro ao enviar status de digitação:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.post('/mark-read', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { jid, messageId } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: 'jid é obrigatório'
      });
    }

    if (!BaileysService.isSessionConnected(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Sessão não está conectada'
      });
    }

    const result = await BaileysService.markAsRead(sessionId, jid, messageId);

    res.json({
      success: true,
      message: 'Mensagem marcada como lida com sucesso',
      data: result
    });

  } catch (error) {
    logger.error('Erro ao marcar mensagem como lida:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

router.get('/messages', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { jid, limit = 50, offset = 0 } = req.query;

    const messages = await Store.getMessages(sessionId, jid, parseInt(limit), parseInt(offset));

    res.json({
      success: true,
      data: {
        messages,
        total: messages.length,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    logger.error('Erro ao obter mensagens:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/chats', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const chats = await Store.getChats(sessionId);

    res.json({
      success: true,
      data: {
        chats,
        total: chats.length
      }
    });

  } catch (error) {
    logger.error('Erro ao obter chats:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/queue/status', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const queueStatus = MessageQueueService.getQueueStatus(sessionId);

    res.json({
      success: true,
      data: queueStatus
    });

  } catch (error) {
    logger.error('Erro ao obter status da fila:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/queue/clear', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    MessageQueueService.clearQueue(sessionId);

    res.json({
      success: true,
      message: 'Fila de mensagens limpa com sucesso'
    });

  } catch (error) {
    logger.error('Erro ao limpar fila:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.delete('/delete/:id_message', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { id_message } = req.params;
    if (!id_message) {
      return res.json({
        success: false,
        message: 'Paramentro "id_message" Ausente',
        data: []
      });
    }
    const get_message = await Chats.getchat(sessionId, id_message)
    if (!get_message) {
      return res.json({
        success: false,
        message: 'Mensagem não encontrada',
        data: []
      });
    }
    const key = {
      id: get_message.mensagem_id,
      remoteJid: get_message.remoteJid,
      fromMe: get_message.fromMe == '1' ? true : false
    }
    const delete_msg = await BaileysService.deleteMessage(sessionId, get_message.remoteJid, key)
    if (!delete_msg) {
      return res.json({
        success: false,
        message: 'Error ao deletar mensagem',
        data: delete_msg
      });
    }
    res.json({
      success: true,
      message: 'Mensagem deletada',
      data: delete_msg
    });
  } catch (error) {
    logger.error('Erro ao enviar enquete:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erro interno do servidor'
    });
  }
});

module.exports = router;