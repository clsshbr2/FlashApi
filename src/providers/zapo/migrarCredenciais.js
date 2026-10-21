/**
 * Importação das sessões antigas da Baileys para a zapo (SEM novo QR Code).
 *
 * A Baileys guarda a autenticação na tabela `wa_session_keys`
 * (uma linha "creds" + uma linha por chave Signal: pre-key, session, sender-key...).
 * A zapo usa tabelas próprias (prefixo `zapo_`). Este módulo:
 *   1. lê as linhas da `wa_session_keys` de UMA sessão;
 *   2. converte com o pacote `wa-store-migrate` (Baileys -> zapo);
 *   3. grava o resultado no store da zapo.
 *
 * É chamado automaticamente por createSession() na primeira vez que uma sessão
 * antiga conecta usando a zapo. Os dados da Baileys NÃO são apagados
 * (servem de backup para voltar a WA_PROVIDER=baileys).
 *
 * Também pode ser executado em lote: `npm run migrar:zapo` (scripts/migrar-para-zapo.js).
 */
import { migrate, bufferJsonReviver, coerceBufferJson } from "wa-store-migrate";
import { execute } from "../../config/database.js";
import logger from "../../utils/logger.js";

// Categorias de chaves que a Baileys grava como "<categoria>-<id>".
// (Ordem importa: "sender-key-memory" precisa ser testada antes de "sender-key".)
const CATEGORIAS_BAILEYS = [
  "app-state-sync-version",
  "app-state-sync-key",
  "sender-key-memory",
  "sender-key",
  "identity-key",
  "device-list",
  "lid-mapping",
  "pre-key",
  "session",
  "tctoken",
];

/** Separa "pre-key-12" em { categoria: "pre-key", id: "12" }. */
function separarChave(keyId) {
  for (const categoria of CATEGORIAS_BAILEYS) {
    if (keyId.startsWith(`${categoria}-`)) {
      return { categoria, id: keyId.slice(categoria.length + 1) };
    }
  }
  return null;
}

/** Converte base64/objetos {type:"Buffer"} em Buffer de forma tolerante. */
function paraBuffer(valor) {
  if (!valor) return valor;
  if (Buffer.isBuffer(valor) || valor instanceof Uint8Array) return valor;
  if (typeof valor === "string") return Buffer.from(valor, "base64");
  return valor;
}

/** Garante que os pares de chaves das credenciais estejam como Buffer. */
function normalizarCredenciais(creds) {
  const par = (p) => (p ? { ...p, private: paraBuffer(p.private), public: paraBuffer(p.public) } : p);
  creds.noiseKey = par(creds.noiseKey);
  creds.signedIdentityKey = par(creds.signedIdentityKey);
  creds.pairingEphemeralKeyPair = par(creds.pairingEphemeralKeyPair);
  if (creds.signedPreKey) {
    creds.signedPreKey = {
      ...creds.signedPreKey,
      keyPair: par(creds.signedPreKey.keyPair),
      signature: paraBuffer(creds.signedPreKey.signature),
    };
  }
  return creds;
}

/** Lê do banco e monta o snapshot no formato esperado pelo adaptador "baileys". */
async function lerSnapshotBaileys(sessionId) {
  const { rows } = await execute(`SELECT key_id, value_json FROM wa_session_keys WHERE sessao_id = $1`, [sessionId]);
  if (rows.length === 0) return null;

  // value_json é JSONB: já vem como objeto. Passamos pelo reviver para
  // transformar {"type":"Buffer","data":"<base64>"} em Buffer de verdade.
  const revive = (valor) => coerceBufferJson(JSON.parse(JSON.stringify(valor), bufferJsonReviver));

  const linhaCreds = rows.find((r) => r.key_id === "creds");
  if (!linhaCreds) return null;

  const creds = normalizarCredenciais(revive(linhaCreds.value_json));
  const keys = {};

  for (const { key_id: keyId, value_json: valor } of rows) {
    if (keyId === "creds") continue;
    const separado = separarChave(keyId);
    if (!separado || separado.categoria === "lid-mapping") continue; // lid-mapping vive no Redis da API
    if (valor === null || valor === undefined) continue;
    (keys[separado.categoria] ??= {})[separado.id] = revive(valor);
  }

  return { creds, keys };
}

/**
 * Importa UMA sessão da Baileys para o store da zapo.
 *
 * @param {string} sessionId  apikey da sessão.
 * @param {import("zapo-js").WaStore} store
 * @param {{ simular?: boolean }} [opcoes]  simular=true converte sem gravar nada.
 * @returns {Promise<{ importado: boolean, simulado?: boolean, motivo?: string, resumo?: object, perdas?: unknown[] }>}
 */
export async function importarSessaoBaileys(sessionId, store, { simular = false } = {}) {
  const sessaoZapo = simular ? null : store.session(sessionId);

  // Já existe sessão na zapo? Então não sobrescreve.
  if (sessaoZapo) {
    const jaExiste = await sessaoZapo.auth.load();
    if (jaExiste) return { importado: false, motivo: "sessão já existe na zapo" };
  }

  const snapshot = await lerSnapshotBaileys(sessionId);
  if (!snapshot) return { importado: false, motivo: "sem credenciais da Baileys" };
  if (!snapshot.creds?.me?.id) return { importado: false, motivo: "sessão da Baileys nunca foi pareada" };

  const { data, losses } = migrate({ from: "baileys", to: "zapo", data: snapshot });

  // Modo simulação (--simular): converte e mostra o resumo, sem gravar nada.
  if (simular) {
    return {
      importado: false,
      simulado: true,
      motivo: "simulação (nada foi gravado)",
      resumo: {
        preKeys: data.preKeys?.length ?? 0,
        sessions: data.sessions?.length ?? 0,
        senderKeys: data.senderKeys?.length ?? 0,
        appStateKeys: data.appState?.keys?.length ?? 0,
      },
      perdas: losses,
    };
  }

  try {
    // As credenciais são gravadas por ÚLTIMO: se algo falhar no meio, a sessão
    // continua "sem credenciais" na zapo e a importação pode ser repetida.
    for (const preKey of data.preKeys ?? []) await sessaoZapo.preKey.putPreKey(preKey);

    if (data.identities?.length) {
      await sessaoZapo.identity.setRemoteIdentities(
        data.identities.map((i) => ({ address: i.address, identityKey: i.identityKey })),
      );
    }
    if (data.sessions?.length) {
      await sessaoZapo.session.setSessionsBatch(data.sessions.map((s) => ({ address: s.address, session: s.record })));
    }
    for (const senderKey of data.senderKeys ?? []) await sessaoZapo.senderKey.upsertSenderKey(senderKey.record);

    if (data.appState?.keys?.length) await sessaoZapo.appState.upsertSyncKeys(data.appState.keys);

    await sessaoZapo.auth.save(data.credentials);
  } catch (erro) {
    // Desfaz o que foi gravado para a próxima tentativa começar limpa.
    for (const dominio of ["preKey", "identity", "session", "senderKey", "appState", "auth"]) {
      try {
        await sessaoZapo[dominio]?.clear?.();
      } catch {
        // melhor esforço
      }
    }
    throw erro;
  }

  logger.info(
    `Sessão ${sessionId} importada da Baileys para a zapo: ` +
      `${data.preKeys?.length ?? 0} pre-keys, ${data.sessions?.length ?? 0} sessões, ` +
      `${data.senderKeys?.length ?? 0} sender-keys, ${losses?.length ?? 0} avisos de conversão`,
  );
  return { importado: true, perdas: losses };
}
