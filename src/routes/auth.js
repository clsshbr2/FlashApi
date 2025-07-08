// const express = require('express');
// const ApiKey = require('../models/ApiKey');
// const logger = require('../utils/logger');

// const router = express.Router();

// /**
//  * @swagger
//  * /auth/create-key:
//  *   post:
//  *     summary: Criar nova API Key
//  *     tags: [Autenticação]
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             required:
//  *               - name
//  *             properties:
//  *               name:
//  *                 type: string
//  *                 description: Nome identificador da API Key
//  *     responses:
//  *       201:
//  *         description: API Key criada com sucesso
//  *         content:
//  *           application/json:
//  *             schema:
//  *               type: object
//  *               properties:
//  *                 success:
//  *                   type: boolean
//  *                 message:
//  *                   type: string
//  *                 data:
//  *                   type: object
//  *                   properties:
//  *                     id:
//  *                       type: integer
//  *                     key:
//  *                       type: string
//  *                     name:
//  *                       type: string
//  */
// router.post('/create-key', async (req, res) => {
//   try {
//     const { name } = req.body;
    
//     if (!name) {
//       return res.status(400).json({
//         success: false,
//         message: 'Nome é obrigatório'
//       });
//     }
    
//     const apiKey = await ApiKey.create(name);
    
//     res.status(201).json({
//       success: true,
//       message: 'API Key criada com sucesso',
//       data: apiKey
//     });
    
//     logger.info(`Nova API Key criada: ${name}`);
//   } catch (error) {
//     logger.error('Erro ao criar API Key:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Erro interno do servidor'
//     });
//   }
// });

// /**
//  * @swagger
//  * /auth/keys:
//  *   get:
//  *     summary: Listar todas as API Keys
//  *     tags: [Autenticação]
//  *     responses:
//  *       200:
//  *         description: Lista de API Keys
//  */
// router.get('/keys', async (req, res) => {
//   try {
//     const keys = await ApiKey.list();
    
//     res.json({
//       success: true,
//       data: keys
//     });
//   } catch (error) {
//     logger.error('Erro ao listar API Keys:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Erro interno do servidor'
//     });
//   }
// });

// /**
//  * @swagger
//  * /auth/deactivate-key/{id}:
//  *   patch:
//  *     summary: Desativar API Key
//  *     tags: [Autenticação]
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema:
//  *           type: integer
//  *     responses:
//  *       200:
//  *         description: API Key desativada com sucesso
//  */
// router.patch('/deactivate-key/:id', async (req, res) => {
//   try {
//     const { id } = req.params;
    
//     const success = await ApiKey.deactivate(id);
    
//     if (!success) {
//       return res.status(404).json({
//         success: false,
//         message: 'API Key não encontrada'
//       });
//     }
    
//     res.json({
//       success: true,
//       message: 'API Key desativada com sucesso'
//     });
    
//     logger.info(`API Key desativada: ${id}`);
//   } catch (error) {
//     logger.error('Erro ao desativar API Key:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Erro interno do servidor'
//     });
//   }
// });

// module.exports = router;