const path = require('path');
require('dotenv').config();

const config = {
  // Server
  port: process.env.PORT || 3000,
  hostapi: process.env.HOST ||  'localhost',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',

  // Global API Key
  globalApiKey: process.env.GLOBAL_API_KEY || 'default-api-key-change-me',

  // Global Webhook
  enableGlobalWebhook: process.env.ENABLE_GLOBAL_WEBHOOK === 'true',
  globalWebhookUrl: process.env.GLOBAL_WEBHOOK_URL || null,
  globalWebhookSecret: process.env.GLOBAL_WEBHOOK_SECRET || 'default-webhook-secret',

  // Global WebSocket
  enableGlobalWebsocket: process.env.ENABLE_WEBSOCKET === 'true',
  globalWebsocketSecret: process.env.GLOBAL_WEBSOCKET_SECRET || '123',
  auth_timeout: process.env.AUTH_TIMEOUT || 1,

  // Database
  databasePath: process.env.DATABASE_PATH || './database.sqlite',

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,

  // Validation
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',

  //TimeZone
  timeZone: process.env.TZ || 'America/Sao_Paulo',

  //delete sessao disconectada automatico
  delete_sessao: process.env.DELETE_SESAO_DISCONECT === 'true',
  temp_delete_sessao: parseInt(process.env.TEMP_DELETE_SESSAO) || 5,

  //Session Management
  sessaoPhone: process.env.SESSION_PHONE_NAME || 'Flash-Api',

  //Banco de dados
  host: process.env.MYSQL_HOST || 'localhost',
  porta: process.env.MYSQL_PORT || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'FlashApi',
  connectionLimit: process.env.MYSQL_CONNECTION_LIMIT || 50,
  queuelimit: process.env.QUEUELIMIT || 0,
};

// Validate required configurations
if (config.enableGlobalWebhook && !config.globalWebhookUrl) {
  console.warn('⚠️  GLOBAL_WEBHOOK_URL não configurada, mas webhook global está habilitado');
}

if (config.globalApiKey === 'default-api-key-change-me' && config.isProduction) {
  console.error('❌ GLOBAL_API_KEY deve ser alterada em produção!');
  process.exit(1);
}

module.exports = config;