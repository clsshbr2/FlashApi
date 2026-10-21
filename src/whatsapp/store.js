/**
 * Store (armazenamento) da zapo em PostgreSQL.
 *
 * A zapo guarda credenciais, chaves Signal, sessões e estado de app em
 * tabelas próprias (prefixo `zapo_`). As tabelas são criadas automaticamente
 * na primeira conexão (migrations internas do @zapo-js/store-postgres), então
 * NÃO é preciso alterar o `supabase/migrations/postgres.sql`.
 *
 * A zapo também guarda sozinha mensagens, chats e contatos (tabelas
 * `zapo_mailbox_*`); a API não grava nada disso manualmente, apenas consulta
 * (veja "Consultas" no fim do arquivo).
 *
 * Um único store é compartilhado por todas as sessões; cada sessão é
 * separada pelo `sessionId` (que continua sendo a `apikey` da sessão).
 */
import { createStore, proto } from "zapo-js";
import { createPostgresStore } from "@zapo-js/store-postgres";
import config from "../config/env.js";
import logger from "../utils/logger.js";
import { execute } from "../config/database.js";
import { paraJsonApi } from "./utils.js";

/** Prefixo das tabelas da zapo (evita colisão com as tabelas da API). */
export const PREFIXO_TABELAS = "zapo_";

let storeUnico = null;
let resultadoPg = null;

/**
 * Retorna (criando na primeira chamada) o store compartilhado da zapo.
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
      // Histórico: a zapo guarda mensagens, chats e contatos sozinha.
      messages: "pg",
      threads: "pg",
      contacts: "pg",
    },
    // Segredo das mensagens (necessário para decifrar votos de enquete) sobrevive
    // a reinícios da API. As linhas expiradas são removidas por iniciarLimpezaStore().
    cacheProviders: { messageSecret: "pg", retry: "pg" },
  });

  logger.info(`Store da zapo iniciado (PostgreSQL, prefixo "${PREFIXO_TABELAS}")`);
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

// ============================================================== Consultas
// Leitura do que a zapo guardou. Mensagens ficam como bytes do proto; chats e
// contatos são lidos direto das tabelas porque o contrato da zapo não lista/busca.

const T = (nome) => `${PREFIXO_TABELAS}mailbox_${nome}`;

function paraMensagemApi(registro) {
  let conteudo = null;
  if (registro.messageBytes) {
    try {
      conteudo = paraJsonApi(proto.Message.toObject(proto.Message.decode(registro.messageBytes), { defaults: false }));
    } catch {
      // bytes inválidos: devolve só os metadados
    }
  }
  return {
    key: { id: registro.id, remoteJid: registro.threadJid, fromMe: registro.fromMe, participant: registro.participantJid || undefined },
    message: conteudo,
    messageTimestamp: registro.timestampMs ? Math.floor(registro.timestampMs / 1000) : undefined,
  };
}

/** Mensagens de uma conversa, da mais nova para a mais antiga. */
export async function listarMensagens(sessionId, jid, limite = 50, antesDeMs) {
  const registros = await obterStoreZapo().session(sessionId).messages.listByThread(jid, limite, antesDeMs);
  return registros.map(paraMensagemApi);
}

/** Uma mensagem pelo ID (ou null). */
export async function obterMensagem(sessionId, id) {
  const registro = await obterStoreZapo().session(sessionId).messages.getById(id);
  return registro ? paraMensagemApi(registro) : null;
}

/** Chats paginados, com busca opcional por nome ou jid. */
export async function listarChats(sessionId, { page = 1, limit = 50, search = "" } = {}) {
  const params = [sessionId];
  let filtro = "";
  if (search) {
    params.push(`%${search}%`);
    filtro = `AND (name ILIKE $2 OR jid ILIKE $2)`;
  }
  const where = `WHERE session_id = $1 ${filtro}`;
  const [{ rows }, { rows: total }] = await Promise.all([
    execute(
      `SELECT jid, name, unread_count, archived, pinned, mute_end_ms, marked_as_unread
         FROM ${T("threads")} ${where}
        ORDER BY pinned DESC NULLS LAST, jid
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, (page - 1) * limit],
    ),
    execute(`SELECT COUNT(*) AS total FROM ${T("threads")} ${where}`, params),
  ]);
  const totalChats = Number(total[0]?.total) || 0;
  return { page, limit, total: totalChats, pages: Math.ceil(totalChats / limit), data: rows };
}

/** Todos os contatos da sessão, por nome. */
export async function listarContatos(sessionId) {
  const { rows } = await execute(
    `SELECT jid, display_name, push_name, lid, phone_number, username
       FROM ${T("contacts")} WHERE session_id = $1
      ORDER BY COALESCE(display_name, push_name, jid)`,
    [sessionId],
  );
  return rows;
}

/** Totais usados na tela de configuração da sessão. */
export async function estatisticasSessao(sessionId) {
  const contar = async (tabela, extra = "") => {
    const { rows } = await execute(`SELECT COUNT(*) AS total FROM ${T(tabela)} WHERE session_id = $1 ${extra}`, [sessionId]);
    return Number(rows[0]?.total) || 0;
  };
  try {
    const [mensagens, enviadas, contatos, chats, grupos] = await Promise.all([
      contar("messages"),
      contar("messages", "AND from_me = TRUE"),
      contar("contacts"),
      contar("threads"),
      contar("threads", "AND jid LIKE '%@g.us'"),
    ]);
    return {
      mensagens: [{ total_mensagens: mensagens, mensagens_enviadas: enviadas, mensagens_recebidas: mensagens - enviadas }],
      contatos: [{ total_contatos: contatos }],
      chats: [{ total_chats: chats, chats_grupo: grupos, chats_privados: chats - grupos }],
      grupos: [{ total_grupos: grupos }],
    };
  } catch (erro) {
    logger.error(`Erro ao buscar estatísticas da sessão ${sessionId}: ${erro?.message || erro}`);
    return {
      mensagens: { total_mensagens: 0, mensagens_enviadas: 0, mensagens_recebidas: 0 },
      contatos: { total_contatos: 0 },
      chats: { total_chats: 0, chats_grupo: 0, chats_privados: 0 },
      grupos: { total_grupos: 0 },
    };
  }
}
