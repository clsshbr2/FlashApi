import axios from 'axios'
import { randomUUID } from 'node:crypto'
import pLimit from 'p-limit'
import logger from '../utils/logger.js'
import config from '../config/env.js'
import redis from './redis.js'

/**
 * Envio de webhooks.
 *
 * 1. Tenta enviar na hora (GLOBAL_WEBHOOK_ATTEMPTS vezes, espera 1s, 2s, 3s...).
 * 2. Se todas falharem (erro de rede, timeout ou HTTP 5xx), o evento vai para uma fila no Redis
 *    (sorted set ordenado pelo horário da próxima tentativa) em vez de se perder.
 * 3. Um worker lê a fila a cada 30s e reenvia com espera crescente (1, 2, 4, 8... máx. 30 min),
 *    até WEBHOOK_QUEUE_MAX_ATTEMPTS tentativas. Depois disso o evento é descartado (com log).
 *
 * Respostas 4xx não são repetidas nem enfileiradas: é erro de quem recebe (URL/rota errada, auth...).
 */

const FILA = 'webhook:fila'
const INTERVALO_WORKER_MS = 30 * 1000
const LOTE_WORKER = 100
const ESPERA_BASE_FILA_MS = 60 * 1000
const ESPERA_MAX_FILA_MS = 30 * 60 * 1000

const RESULTADO = { OK: 'ok', ERRO_CLIENTE: 'erro_cliente', FALHA: 'falha' }

class WebhookService {
  static worker = null
  static processando = false

  /** Uma tentativa de envio. */
  static async tentarEnviar(url, data) {
    try {
      const response = await axios.post(url, data, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'flash-api/1.0'
        },
        validateStatus: () => true
      })

      if (response.status >= 200 && response.status < 300) return { resultado: RESULTADO.OK }
      if (response.status >= 400 && response.status < 500) return { resultado: RESULTADO.ERRO_CLIENTE, status: response.status }
      return { resultado: RESULTADO.FALHA, status: response.status }
    } catch (error) {
      return { resultado: RESULTADO.FALHA, erro: error.message }
    }
  }

  static async sendWebhook(url, data) {
    if (!url) {
      logger.error('URL do webhook inválida')
      return false
    }

    const retries = Math.max(1, parseInt(config.globalWebsocketTentativas, 10) || 1)

    for (let i = 0; i < retries; i++) {
      const { resultado, status, erro } = await this.tentarEnviar(url, data)

      if (resultado === RESULTADO.OK) {
        logger.debug(`Webhook enviado: ${url}`)
        return true
      }

      if (resultado === RESULTADO.ERRO_CLIENTE) {
        logger.error(`❌ Webhook recusado pelo destino (HTTP ${status}) - ${url}`)
        return false
      }

      logger.warn(`⚠️ Webhook tentativa ${i + 1}/${retries} falhou (${status ? `HTTP ${status}` : erro}) - ${url}`)

      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }

    await this.enfileirar(url, data, 0)
    return false
  }

  // ------------------------------------------------------------------ Fila no Redis

  static esperaFila(tentativasFila) {
    return Math.min(ESPERA_BASE_FILA_MS * 2 ** tentativasFila, ESPERA_MAX_FILA_MS)
  }

  static async enfileirar(url, data, tentativasFila) {
    if (!config.webhookQueueEnabled) {
      logger.error(`💥 Falha total ao enviar webhook (fila desativada, evento descartado): ${url}`)
      return
    }

    try {
      const item = JSON.stringify({ id: randomUUID(), url, data, tentativas: tentativasFila, criadoEm: Date.now() })
      await redis.client.zadd(FILA, Date.now() + this.esperaFila(tentativasFila), item)

      // Limita o tamanho da fila: descarta os itens com a tentativa mais distante (os mais tentados/antigos).
      const tamanho = await redis.client.zcard(FILA)
      if (tamanho > config.webhookQueueMaxSize) {
        const excesso = tamanho - config.webhookQueueMaxSize
        await redis.client.zremrangebyrank(FILA, -excesso, -1)
        logger.warn(`Fila de webhooks cheia (${config.webhookQueueMaxSize}): ${excesso} evento(s) descartado(s)`)
      }

      if (tentativasFila === 0) logger.warn(`Webhook guardado na fila para reenvio: ${url}`)
    } catch (error) {
      logger.error(`💥 Não foi possível guardar o webhook na fila (evento perdido): ${url} - ${error.message}`)
    }
  }

  /** Reenvia os itens da fila cujo horário de nova tentativa já chegou. */
  static async processarFila() {
    if (this.processando) return
    this.processando = true
    try {
      const itens = await redis.client.zrangebyscore(FILA, '-inf', Date.now(), 'LIMIT', 0, LOTE_WORKER)
      if (itens.length === 0) return

      const limite = pLimit(10)
      await Promise.allSettled(itens.map(bruto => limite(async () => {
        // ZREM devolve 1 só para quem removeu: evita reenvio duplicado com várias instâncias da API.
        if (await redis.client.zrem(FILA, bruto) !== 1) return

        let item
        try { item = JSON.parse(bruto) } catch { return }

        const { resultado, status, erro } = await this.tentarEnviar(item.url, item.data)
        const tentativas = item.tentativas + 1

        if (resultado === RESULTADO.OK) {
          logger.info(`✅ Webhook da fila entregue após ${tentativas} reenvio(s): ${item.url}`)
          return
        }
        if (resultado === RESULTADO.ERRO_CLIENTE) {
          logger.error(`❌ Webhook da fila recusado pelo destino (HTTP ${status}), descartado: ${item.url}`)
          return
        }
        if (tentativas >= config.webhookQueueMaxAttempts) {
          logger.error(`💥 Webhook descartado após ${tentativas} reenvios pela fila (${status ? `HTTP ${status}` : erro}): ${item.url}`)
          return
        }
        await this.enfileirar(item.url, item.data, tentativas)
      })))
    } catch (error) {
      logger.error(`Erro ao processar a fila de webhooks: ${error.message}`)
    } finally {
      this.processando = false
    }
  }

  static iniciarWorker() {
    if (this.worker || !config.webhookQueueEnabled) return
    this.worker = setInterval(() => this.processarFila(), INTERVALO_WORKER_MS)
    this.worker.unref()
    logger.info('Fila de reenvio de webhooks iniciada')
  }

  static pararWorker() {
    if (this.worker) clearInterval(this.worker)
    this.worker = null
  }
}

export default WebhookService
