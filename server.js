process.on('uncaughtException', (err) => {
    console.error('❌ Erro não tratado (uncaughtException):', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Rejeição não tratada (unhandledRejection):', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const config = require('./src/config/env');
const { swaggerOptions } = require('./src/config/swagger');
const GlobalWebSocketService = require('./src/services/GlobalWebSocketService');
const BaileysService = require('./src/services/BaileysService');
const logger = require('./src/utils/logger');


// Import routes
const sessionRoutes = require('./src/routes/session');
const chatRoutes = require('./src/routes/chat');
const contactRoutes = require('./src/routes/contact');
const groupRoutes = require('./src/routes/group');
const configRoutes = require('./src/routes/config');
const systemRoutes = require('./src/routes/system');
const { execSync } = require('child_process');
const { modifyTable } = require('./src/config/verificardb');


// Gerar arquivo swagger completo
fs.writeFileSync('swagger_full.json', JSON.stringify(swaggerOptions.definition, null, 2));
console.log('Arquivo swagger_full.json gerado com sucesso');

try {
  // Executar o comando para converter para Postman
  execSync('openapi2postmanv2 -s swagger_full.json -o postman_collection.json -p', { stdio: 'inherit' });
  console.log('Arquivo postman_collection.json gerado com sucesso');
} catch (error) {
  console.error('Erro ao gerar coleção Postman:', error);
}

const app = express();

const server = http.createServer(app);
const PORT = config.port;


const allowedOrigins = config.origins;

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
};

// Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Swagger documentation
const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Routes
app.use('/api/session', sessionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/group', groupRoutes);
app.use('/api/config', configRoutes);
app.use('/api/system', systemRoutes);

// WebSocket server
const wss = new WebSocket.Server({ server });
const globalWebSocketService = new GlobalWebSocketService(wss);

// Connect BaileysService with GlobalWebSocketService
BaileysService.setGlobalWebSocketService(globalWebSocketService);

// Global error handler
app.use((err, req, res, next) => {
  console.log(err)
  logger.error('Global error:', err);
  res.status(500).json({
    success: false,
    message: 'Erro interno do servidor',
    error: config.isDevelopment ? err.message : undefined
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint não encontrado',
    // availableEndpoints: [
    //   '/api/info',
    //   '/api-docs',
    //   '/health',
    //   '/api/session/*',
    //   '/api/chat/*',
    //   '/api/contact/*',
    //   '/api/group/*',
    //   '/api/config/*',
    //   '/api/system/*'
    // ]
  });
});

// Initialize database and start server
async function startServer() {
  try {
    logger.info('✅ Iniciando Flash API - WhatsApp Multi-Session');
    
    // Initialize BaileysService and restore sessions
    await BaileysService.initialize();
    logger.info('✅ BaileysService inicializado');
    
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 Flash API rodando na porta ${PORT}`);
      logger.info(`📚 Documentação: http://localhost:${PORT}/api-docs`);
      
      if (config.enableGlobalWebsocket) {
        logger.info(`🔗 WebSocket Global: ws://localhost:${PORT}`);
      } else {
        logger.info(`🔗 WebSocket Global: DESABILITADO`);
      }
      
      if (config.enableGlobalWebhook) {
        logger.info(`📡 Webhook Global: HABILITADO (${config.globalWebhookUrl || 'URL não configurada'})`);
      } else {
        logger.info(`📡 Webhook Global: DESABILITADO`);
      }

      logger.info(`🔑 API Key Global: ${config.globalApiKey.substring(0, 10)}...`);
      
      const stats = BaileysService.getSessionsStats();
      logger.info(`📱 Sessões ativas: ${stats.connected} conectadas, ${stats.connecting} conectando, ${stats.total} total`);
      
      logger.info('🎯 Recursos disponíveis:');
      logger.info('   📤 Envio de mensagens (texto, imagem, vídeo, áudio, documento, localização, enquete)');
      logger.info('   👥 Gerenciamento de grupos (criar, adicionar/remover participantes, promover/rebaixar)');
      logger.info('   📞 Gerenciamento de contatos (verificar, bloquear/desbloquear)');
      logger.info('   ⚙️  Configurações de sessão (webhook, auto-reply, auto-read, ignorar grupos)');
      logger.info('   📊 Fila de mensagens com delay personalizado');
      logger.info('   💾 Store persistente MySQL para mensagens, contatos, chats e grupos');
      logger.info('   🔄 Reconexão automática e health check');
      
      // Cleanup sessions periodically
      setInterval(() => {
        BaileysService.cleanupSessions();
      }, 5 * 60 * 1000); // Every 5 minutes
    });
  } catch (error) {
    logger.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM recebido, encerrando servidor...');
  BaileysService.stopHealthCheck();
  server.close(() => {
    logger.info('Servidor encerrado');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT recebido, encerrando servidor...');
  process.exit(0);
});

startServer();

module.exports = { app, server, wss };