import express from 'express';
import globalAuth from '../middleware/globalAuth.js';
import WhatsAppService from '../services/WhatsAppService.js';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import os from 'os';
import si from 'systeminformation';
import Session from '../models/Session.js';

const router = express.Router();
const SYSTEM_STATUS_CACHE_KEY = 'cache:system:status';
const SYSTEM_STATUS_CACHE_TTL_SECONDS = 120;

router.get('/status', globalAuth.authenticateGlobalApiKey, async (req, res) => {
  try {
    const cachedStatus = await WhatsAppService.redis.get(SYSTEM_STATUS_CACHE_KEY);
    if (cachedStatus) {
      return res.json(cachedStatus);
    }

    const [
      sessionsStats,
      webhookInfo,
      poolStatus,
      cpuInfo,
      cpuLoad,
      memInfo,
      fsInfo,
      networkStats,
      osInfo,
      processesInfo,
      networkInterfaces,
      usersInfo,
      currentTime
    ] = await Promise.all([
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null), // poolStatus
      si.cpu().catch(() => null),
      si.currentLoad().catch(() => null),
      si.mem().catch(() => null),
      si.fsSize().catch(() => []),
      si.networkStats().catch(() => []),
      si.osInfo().catch(() => null),
      si.processes().catch(() => null),
      si.networkInterfaces().catch(() => []),
      si.users().catch(() => []),
      si.time().catch(() => null)
    ]);

    const memoryUsage = process.memoryUsage();
    const cpuCount = os.cpus()?.length || 0;
    const totalRam = os.totalmem();
    const freeRam = os.freemem();
    const usedRam = totalRam - freeRam;

    const processMemory = {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers || 0
    };

    const processStats = {
      pid: process.pid,
      ppid: process.ppid,
      title: process.title,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
      uptime: process.uptime(),
      memory: processMemory,
      cpuUsage: process.cpuUsage(),
      resourceUsage: process.resourceUsage?.() || null
    };

    const runtime = {
      nodeVersion: process.version,
      v8Version: process.versions?.v8,
      uvVersion: process.versions?.uv,
      opensslVersion: process.versions?.openssl,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      now: new Date().toISOString(),
      bootTime: currentTime?.current ? new Date(currentTime.current - (os.uptime() * 1000)).toISOString() : null
    };

    const host = {
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      uptime: os.uptime(),
      cpuCount,
      loadAverage: os.loadavg(),
      memory: {
        total: totalRam,
        free: freeRam,
        used: usedRam,
        usagePercent: totalRam > 0 ? Number(((usedRam / totalRam) * 100).toFixed(2)) : 0
      },
      interfaces: networkInterfaces,
      activeUsers: usersInfo?.length || 0
    };

    const cpu = {
      manufacturer: cpuInfo?.manufacturer || null,
      brand: cpuInfo?.brand || null,
      cores: cpuInfo?.cores || cpuCount,
      physicalCores: cpuInfo?.physicalCores || null,
      speed: cpuInfo?.speed || null,
      load: {
        current: cpuLoad?.currentLoad || 0,
        user: cpuLoad?.currentLoadUser || 0,
        system: cpuLoad?.currentLoadSystem || 0,
        idle: cpuLoad ? Math.max(0, 100 - (cpuLoad.currentLoad || 0)) : null
      }
    };

    const memory = {
      system: {
        total: memInfo?.total || totalRam,
        free: memInfo?.free || freeRam,
        used: memInfo?.used || usedRam,
        active: memInfo?.active || null,
        available: memInfo?.available || null,
        swapTotal: memInfo?.swaptotal || null,
        swapUsed: memInfo?.swapused || null,
        usagePercent: memInfo?.total ? Number((((memInfo.used || 0) / memInfo.total) * 100).toFixed(2)) : host.memory.usagePercent
      },
      process: processMemory
    };

    const storage = {
      disks: Array.isArray(fsInfo)
        ? fsInfo.map((d) => ({
          fs: d.fs,
          mount: d.mount,
          type: d.type,
          total: d.size,
          used: d.used,
          available: d.available,
          use: d.use
        }))
        : []
    };

    const network = {
      stats: Array.isArray(networkStats)
        ? networkStats.map((n) => ({
          iface: n.iface,
          operstate: n.operstate,
          rxBytes: n.rx_bytes,
          txBytes: n.tx_bytes,
          rxDropped: n.rx_dropped,
          txDropped: n.tx_dropped,
          rxErrors: n.rx_errors,
          txErrors: n.tx_errors
        }))
        : [],
      interfaces: networkInterfaces
    };

    const services = {
      webhook: {
        global: webhookInfo,
        enabled: config.enableGlobalWebhook
      },
      websocket: {
        enabled: config.enableGlobalWebsocket,
        clients: 0 // Will be updated by WebSocket service
      },
      database: {
        dados: poolStatus
      }
    };

    const response = {
      success: true,
      data: {
        system: {
          status: 'online',
          uptime: process.uptime(),
          memory: processMemory,
          version: config.apiversao,
          host,
          runtime,
          process: processStats,
          os: osInfo,
          cpu,
          memoryDetails: memory,
          storage,
          network,
          processes: {
            all: processesInfo?.all || null,
            running: processesInfo?.running || null,
            blocked: processesInfo?.blocked || null,
            sleeping: processesInfo?.sleeping || null,
            list: Array.isArray(processesInfo?.list) ? processesInfo.list.slice(0, 20) : []
          }
        },
        sessions: sessionsStats,
        webhook: services.webhook,
        websocket: services.websocket,
        database: services.database,
        redis: services.redis,
        services
      }
    };

    try {
      await WhatsAppService.redis.set(
        SYSTEM_STATUS_CACHE_KEY,
        response,
        SYSTEM_STATUS_CACHE_TTL_SECONDS,
      );
    } catch (cacheError) {
      logger.warn('Falha ao gravar cache do status do sistema:', cacheError);
    }

    res.json(response);
  } catch (error) {
    console.log(error)
    logger.error('Erro ao obter status do sistema:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/config', globalAuth.authenticateGlobalApiKey, async (req, res) => {
  try {
    const sessoes = await Session.findAllSessao();
    res.json({
      success: true,
      data: {
        features: {
          ...config
        },
        version: config.apiversao,
        instacias: sessoes.length
      }
    });
  } catch (error) {
    logger.error('Erro ao obter configurações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});


export default router;