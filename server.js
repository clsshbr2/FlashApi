process.on("uncaughtException", (err) => {
  console.error("❌ Erro global:", err.message);

  if (err.stack) {
    const lines = err.stack.split("\n");
    console.error("📍 Origem provável:", lines);
  }
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Rejeição não tratada (unhandledRejection):", reason);
});

import express from "express";
import cors from "cors";
import helmet from "helmet";
import swaggerJsDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import http from "http";
import { WebSocketServer } from "ws";
import fs from "fs";
import session from "express-session";
import { RedisStore } from "connect-redis";
import redis from "./src/services/redis.js";

import config from "./src/config/env.js";
import WebSocketService from "./src/services/WebSocketService.js";

import logger from "./src/utils/logger.js";

// Import routes
import sessionRoutes from "./src/routes/session.js";
import chatRoutes from "./src/routes/chat.js";
import contactRoutes from "./src/routes/contact.js";
import groupRoutes from "./src/routes/group.js";
import configRoutes from "./src/routes/config.js";
import systemRoutes from "./src/routes/system.js";
import managerRoutes from "./src/routes/manager.js";
import { execSync } from "child_process";
import modifyTable from "./src/config/verificardb.js";
import WhatsAppService from "./src/services/WhatsAppService.js";
import Session from "./src/models/Session.js";
import { checkAndInitDatabase } from "./gerardb.js";
import { startWorkers } from "./src/services/workers/index.js";


const app = express();

const server = http.createServer(app);
const PORT = config.port;

const allowedOrigins = config.origins;

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

// Middleware
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.set("trust proxy", 1);

//Usar redis como cache
const ioredisAdapter = {
  get: (key) => redis.client.get(key),
  set: (key, val, opts) => (opts?.EX ? redis.client.set(key, val, "EX", opts.EX) : redis.client.set(key, val)),
  del: (key) => redis.client.del(key),
  expire: (key, ttl) => redis.client.expire(key, ttl),
  mget: (...keys) => redis.client.mget(...keys),
};

//Sistema de sessão (persistida no Redis)
app.use(
  session({
    store: new RedisStore({ client: ioredisAdapter }),
    secret: config.manager_senha_admin,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.protocol == "https" ? true : false,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  }),
);


// Routes
app.use("/api/session", sessionRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/group", groupRoutes);
app.use("/api/config", configRoutes);
app.use("/api/system", systemRoutes);
app.use("/manager", managerRoutes);

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 200 * 1024 * 1024 });
const WebSocket = new WebSocketService(wss);

// Conexão websocket
WhatsAppService.SetWebSocketService(WebSocket);

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err);
  logger.error("Global error:", err);
  res.status(500).json({
    success: false,
    message: "Erro interno do servidor",
    error: config.isDevelopment ? err.message : undefined,
  });
});

app.post("/teste", (req, res) => {
  console.log("Webhook recebido:");
  console.log(req.body);

  res.json({
    success: true,
    message: "Webhook recebido com sucesso!",
    received: req.body,
    timestamp: new Date().toISOString()
  });
});

app.get("/", (req, res) => {
  return res.redirect("/manager/login");
});

// Initialize database and start server
async function startServer() {
  try {
    server.listen(PORT, "0.0.0.0", async () => {
      logger.info(`🚀 Flash API rodando na porta ${PORT}`);
      //Criar banco de dados
      await checkAndInitDatabase();

      logger.info("✅ Iniciando Flash API - WhatsApp Multi-Session");
      startWorkers()


      //iniciando as sessões de WhatsApp
      WhatsAppService.initialize();
    });
  } catch (error) {
    logger.error(error);
    logger.error("❌ Erro ao iniciar servidor:");
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGTERM", () => {
  // fecha conexões e (no provider zapo) grava as chaves pendentes antes de sair
  server.close(() => WhatsAppService.encerrarTodas().finally(() => process.exit(0)));
});

process.on("SIGINT", () => {
  // espera a zapo gravar as chaves pendentes no banco antes de sair
  WhatsAppService.encerrarTodas().finally(() => process.exit(0));
});
startServer();

export default { app, server, wss };
