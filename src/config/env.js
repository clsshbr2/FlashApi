
import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve('.env') });

const minPort = process.env.PROXY_PORT_MIN ? Number(process.env.PROXY_PORT_MIN) : 10000;
const maxPort = process.env.PROXY_PORT_MAX ? Number(process.env.PROXY_PORT_MAX) : 20000;

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const config = {
  // Server
  port: process.env.PORT || 3000,
  hostapi: process.env.HOST || 'localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  // Nível de log da zapo (aceita também o antigo BAILEYS_LOG_LEVEL)
  waLogLevel: process.env.WA_LOG_LEVEL || process.env.BAILEYS_LOG_LEVEL || process.env.LOG_LEVEL || 'info',
  protocol: process.env.PROTOCOLO || 'http',
  versao: process.env.VERSION_ZAP || '[2, 3000, 1043914743]',


  origins: process.env.CORS_ORIGINS || '*',

  // Global API Key
  globalApiKey: process.env.GLOBAL_API_KEY || 'ASDASDSA55WQ88E55R8ER5T2QW5E5Q',

  // Global Webhook
  enableGlobalWebhook: process.env.ENABLE_GLOBAL_WEBHOOK == 'true',
  globalWebhookUrl: process.env.GLOBAL_WEBHOOK_URL || null,
  globalWebsocketTentativas: process.env.GLOBAL_WEBHOOK_ATTEMPTS || 4,

  // Fila de reenvio de webhooks (Redis): guarda eventos cujo envio falhou e tenta de novo depois
  webhookQueueEnabled: process.env.WEBHOOK_QUEUE_ENABLED !== 'false',
  webhookQueueMaxAttempts: parseInt(process.env.WEBHOOK_QUEUE_MAX_ATTEMPTS, 10) || 12,
  webhookQueueMaxSize: parseInt(process.env.WEBHOOK_QUEUE_MAX_SIZE, 10) || 10000,

  // Chamadas de voz (plugin @zapo-js/voip): ligar e tocar um áudio. Desligado por padrão.
  enableCalls: process.env.ENABLE_CALLS === 'true',
  callRingTimeoutSeconds: parseInt(process.env.CALL_RING_TIMEOUT_SECONDS, 10) || 45,
  callMaxDurationSeconds: parseInt(process.env.CALL_MAX_DURATION_SECONDS, 10) || 300,
  callLiveMaxDurationSeconds: parseInt(process.env.CALL_LIVE_MAX_DURATION_SECONDS, 10) || 3600,


  // Configuração de sessão
  sessao_phone: process.env.SESSION_PHONE_CLIENT || 'Flash_api',
  sessao_phone_name: process.env.SESSION_PHONE_NAME || 'Chrome',

  // Global WebSocket
  enableGlobalWebsocket: process.env.ENABLE_WEBSOCKET === 'true',
  globalWebsocketSecret: process.env.GLOBAL_WEBSOCKET_SECRET || "ASDASDSA55WQ88E55R8ER5T2QW5E5Q",

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
  host: process.env.DB_HOST || 'localhost',
  porta: toPositiveInt(process.env.DB_PORT, 5432),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'FlashApi',
  connectionLimit: toPositiveInt(process.env.DB_CONNECTION_LIMIT, 10),
  queuelimit: toPositiveInt(process.env.QUEUELIMIT, 0),
  db_client: process.env.DB_TYPE || 'postgres',

  //Redis
  redis_host: process.env.REDIS_HOST || '127.0.0.1',
  redis_port: process.env.REDIS_PORT || 6379,
  redis_pass: process.env.REDIS_PASS || '',

  //manager
  login_manager_admin: process.env.LOGIN_MANAGER_ADMIN,
  login_manager_user: process.env.LOGIN_MANAGER_USER,
  manager_senha_admin: process.env.SENHA_MANAGER_ADMIN || '123456',
  manager_status: process.env.MANAGER === "true",

  //Proxy
  proxy_state: process.env.PROXY_STATE || false,
  proxy_host: process.env.PROXY_HOST || "",
  proxy_port: process.env.PROXY_PORT
    ? Number(process.env.PROXY_PORT)
    : getRandomPort(minPort, maxPort),
  proxy_protocol: process.env.PROXY_PROTOCOL || "http",
  proxy_usename: process.env.PROXY_USERNAME || "",
  proxy_password: process.env.PROXY_PASSWORD || "",

  // Limite qrcode 
  qrcode_limite: process.env.LIMITE_QRCODE || 10,

  //Temp message
  apiversao: process.env.VERSAO || '1.0.4',
  sync_sessions: process.env.SYNC_SESSIONS == 'false' ? false : true,
  // false = não reconecta as sessões salvas ao iniciar (use em ambiente local que compartilha o banco com a produção)
  auto_iniciar_sessoes: process.env.AUTO_INICIAR_SESSOES == 'false' ? false : true,


  ignore_boadcast: process.env.IGNORE_BROADCAST == 'false' ? false : true,
};



function getRandomPort(min = 10000, max = 20000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


export default config;
