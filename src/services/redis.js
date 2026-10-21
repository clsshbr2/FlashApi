// redis.js
import Redis from "ioredis";
import config from "../config/env.js";
import logger from "../utils/logger.js";

class RedisClient {

  createClient() {
    return new Redis({
      host: config.redis_host,
      port: config.redis_port,
      password: config.redis_pass,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      connectTimeout: 10000,
      lazyConnect: false,
      retryStrategy: (times) => {
        if (times > 100) {
          logger.error("❌ Redis: Máximo de tentativas de reconexão atingido");
          return null; // Para de tentar reconectar
        }
        // Tempo de reconexão em caso de falha
        const delay = Math.min(times * 50, 2000);
        logger.info(`Tentando reconectar ao Redis em ${delay}ms... (tentativa ${times})`);
        return delay;
      },
    });
  }
  constructor() {
    // Cria apenas uma instância global (Singleton)
    if (!RedisClient.instance) {
      this.hasBeenReady = false;
      this.wasDisconnected = false;


      this.client = this.createClient();

      // uso geral: lpush, llen, etc
      this.workerClient = this.createClient();



      this.client.on("connect", () => logger.info("✅ Conectado ao Redis"));

      this.client.on("ready", () => {
        logger.info("✅ Redis pronto para uso");

        const recovered = this.hasBeenReady && this.wasDisconnected;
        this.hasBeenReady = true;
        this.wasDisconnected = false;

        if (recovered) {
          logger.info("♻️ Redis recuperado após instabilidade");
          process.emit("flashapi:redis-recovered");
        }
      });

      this.client.on("error", (err) => {
        console.log(err);
        this.wasDisconnected = true;
        logger.error("❌ Erro no Redis:", err.message);
        // Não encerra o processo, deixa o retryStrategy lidar com reconexão
      });

      this.client.on("close", () => {
        this.wasDisconnected = true;
        logger.warn("⚠️ Conexão Redis fechada");
      });

      this.client.on("reconnecting", () => {
        logger.info("🔄 Reconectando ao Redis...");
      });

      RedisClient.instance = this;
    }

    return RedisClient.instance;
  }

  // Busca chaves por padrão de forma incremental para evitar bloqueio com KEYS
  async scanKeys(pattern, count = 200) {
    try {
      let cursor = "0";
      const foundKeys = [];

      do {
        const [nextCursor, batch] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", count);
        cursor = nextCursor;
        if (Array.isArray(batch) && batch.length > 0) {
          foundKeys.push(...batch);
        }
      } while (cursor !== "0");

      return foundKeys;
    } catch (err) {
      console.error(`Erro ao varrer chaves com padrão ${pattern}:`, err);
      return [];
    }
  }

  // Define valor com tempo de expiração
  async set(key, value, ttl = null) {
    try {
      const data = JSON.stringify(value);

      const parsedTtl = ttl != null ? parseInt(ttl, 10) : null;
      if (parsedTtl && !isNaN(parsedTtl) && parsedTtl > 0) {
        // se tiver TTL válido, define com expiração
        await this.client.setex(key, parsedTtl, data);
      } else {
        // se não tiver TTL, define permanente
        await this.client.set(key, data);
      }
    } catch (err) {
      console.error(`Erro ao definir chave ${key}:`, err);
    }
  }

  // Retorna todas as sessões salvas no Redis
  async getAllSessions() {
    try {
      const keys = await this.scanKeys("sessao:*");
      const sessions = [];

      for (const key of keys) {
        const data = await this.client.get(key);
        sessions.push({
          key,
          value: JSON.parse(data),
        });
      }

      return sessions;
    } catch (err) {
      console.error("Erro ao buscar sessões:", err);
      return [];
    }
  }

  // Busca valor
  async get(key) {
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`Erro ao buscar chave ${key}:`, err);
      return null;
    }
  }

  // Remove chave
  async del(key) {
    try {
      await this.client.del(key);
    } catch (err) {
      console.error(`Erro ao deletar chave ${key}:`, err);
    }
  }

  // Verifica se chave existe
  async exists(key) {
    try {
      return await this.client.exists(key);
    } catch (err) {
      console.error(`Erro ao verificar chave ${key}:`, err);
      return false;
    }
  }

  // Busca chaves por padrão
  async keys(pattern) {
    try {
      return await this.scanKeys(pattern);
    } catch (err) {
      console.error(`Erro ao buscar chaves com padrão ${pattern}:`, err);
      return [];
    }
  }

  // Deleta múltiplas chaves
  async delMany(...keys) {
    try {
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch (err) {
      console.error(`Erro ao deletar chaves:`, err);
    }
  }

  // Fecha conexão
  async disconnect() {
    await this.client.quit();
    logger.info("🔌 Conexão Redis encerrada.");
  }
}

export const KEYS = () => ({

  sessao: (sessaoId) => `sessao:${sessaoId}`, //Key para salvar sessão
  lid_map: (botId, id) => `lid-mapping:${botId}:${id}`,   //Key de lid_map

  grupos_cache: (sessaoId) => `grupos:${sessaoId}`

});

export default new RedisClient();
