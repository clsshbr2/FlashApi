/**
 * Store (armazenamento) da zapo em PostgreSQL.
 *
 * A zapo guarda credenciais, chaves Signal, sessões e estado de app em
 * tabelas próprias (prefixo `zapo_`). As tabelas são criadas automaticamente
 * na primeira conexão (migrations internas do @zapo-js/store-postgres), então
 * NÃO é preciso alterar o `supabase/migrations/postgres.sql`.
 *
 * Um único store é compartilhado por todas as sessões; cada sessão é
 * separada pelo `sessionId` (que continua sendo a `apikey` da sessão).
 */
import { createStore } from "zapo-js";
import { createPostgresStore } from "@zapo-js/store-postgres";
import config from "../config/env.js";
import logger from "../utils/logger.js";
import { execute } from "../config/database.js";

/** Prefixo das tabelas da zapo (evita colisão com as tabelas da API). */
export const PREFIXO_TABELAS = "zapo_";

let storeUnico = null;
let resultadoPg = null;

/**
 * Retorna (criando na primeira chamada) o store compartilhado da zapo.
 * Por padrão mensagens/chats/contatos NÃO são gravados pela zapo, porque a API
 * já tem as próprias tabelas para isso. Para a zapo guardá-los também, use
 * ZAPO_STORE_HISTORICO=true no .env.
 */
export function obterStoreZapo() {
  if (storeUnico) return storeUnico;

  resultadoPg = createPostgresStore({
    // Pool próprio da zapo, com as mesmas credenciais do banco da API.
    pool: {
      host: config.host,
      port: config.porta,
      user: config.user,
      password: config.password,
      database: config.database,
      max: Number(process.env.ZAPO_DB_POOL_MAX) || 10,
      keepAlive: true,
    },
    tablePrefix: PREFIXO_TABELAS,
  });

  const guardarHistorico = process.env.ZAPO_STORE_HISTORICO === "true";
  const dominioHistorico = guardarHistorico ? "pg" : "none";

  storeUnico = createStore({
    backends: { pg: resultadoPg },
    providers: {
      // Domínios obrigatórios para a sessão continuar logada após reiniciar.
      auth: "pg",
      signal: "pg",
      preKey: "pg",
      session: "pg",
      identity: "pg",
      senderKey: "pg",
      appState: "pg",
      privacyToken: "pg",
      // Domínios opcionais (histórico). "none" = a zapo não guarda.
      messages: dominioHistorico,
      threads: dominioHistorico,
      contacts: dominioHistorico,
    },
    // Segredo das mensagens (necessário para decifrar votos de enquete) sobrevive
    // a reinícios da API. As linhas expiradas são removidas por iniciarLimpezaStore().
    cacheProviders: { messageSecret: "pg", retry: "pg" },
  });

  logger.info(`Store da zapo iniciado (PostgreSQL, prefixo "${PREFIXO_TABELAS}", histórico: ${guardarHistorico})`);
  return storeUnico;
}

const limpezas = new Map();

/**
 * Inicia (uma vez por sessão) a limpeza periódica das linhas expiradas dos
 * caches guardados no PostgreSQL. Sem isso as tabelas de cache só crescem.
 */
export function iniciarLimpezaStore(sessionId) {
  if (!resultadoPg || limpezas.has(sessionId)) return;
  limpezas.set(sessionId, resultadoPg.startCleanup(sessionId));
}

/** Para a limpeza periódica de uma sessão (quando ela é encerrada). */
export function pararLimpezaStore(sessionId) {
  limpezas.get(sessionId)?.stop();
  limpezas.delete(sessionId);
}

/**
 * Apaga TODOS os dados da zapo de uma sessão (credenciais, chaves, etc.).
 * Chamado quando a sessão é deletada ou desvinculada.
 */
export async function limparDadosSessaoZapo(sessionId) {
  try {
    // Descobre dinamicamente as tabelas da zapo que possuem a coluna session_id.
    const { rows } = await execute(
      `SELECT DISTINCT table_name
         FROM information_schema.columns
        WHERE column_name = 'session_id'
          AND table_schema = current_schema()
          AND table_name LIKE $1`,
      [`${PREFIXO_TABELAS}%`],
    );

    for (const { table_name: tabela } of rows) {
      // O nome da tabela vem do catálogo do banco (não do usuário), mas
      // validamos mesmo assim antes de montar o SQL.
      if (!/^[a-z0-9_]+$/i.test(tabela)) continue;
      await execute(`DELETE FROM "${tabela}" WHERE session_id = $1`, [sessionId]);
    }
  } catch (erro) {
    logger.error(`Erro ao limpar dados da zapo da sessão ${sessionId}: ${erro?.message || erro}`);
  }
}

/** Encerra o pool do store (usado no desligamento da aplicação). */
export async function encerrarStoreZapo() {
  try {
    await resultadoPg?.destroy();
  } catch {
    // ignora erros no desligamento
  } finally {
    for (const poller of limpezas.values()) poller.stop();
    limpezas.clear();
    storeUnico = null;
    resultadoPg = null;
  }
}
