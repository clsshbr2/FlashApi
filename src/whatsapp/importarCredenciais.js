/**
 * Importação de uma sessão do WhatsApp Web (enviada pela extensão do navegador)
 * para o store da zapo, via rota POST /api/session/creds.
 *
 * A extensão (pasta `extensao/`) lê as credenciais do WhatsApp Web e envia:
 *   creds: objeto de credenciais (campos binários como { type: "Buffer", data: "<base64>" })
 *   keys:  [{ key_id: "pre-key-12", json: { public, private } }, ...]
 * O pacote `wa-store-migrate` (somente conversão, sem conexão) converte esse
 * formato para o da zapo, e aqui gravamos o resultado no store PostgreSQL.
 */
import { migrate, bufferJsonReviver, coerceBufferJson } from "wa-store-migrate";

/** Converte base64 em Buffer de forma tolerante. */
function paraBuffer(valor) {
  if (!valor || Buffer.isBuffer(valor) || valor instanceof Uint8Array) return valor;
  return typeof valor === "string" ? Buffer.from(valor, "base64") : valor;
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

/** Transforma {"type":"Buffer","data":"<base64>"} em Buffer de verdade. */
const reviver = (valor) => coerceBufferJson(JSON.parse(JSON.stringify(valor), bufferJsonReviver));

/**
 * @param {string} sessionId
 * @param {import("zapo-js").WaStore} store
 * @param {object} creds                      credenciais enviadas pela extensão.
 * @param {{ key_id: string, json: object }[]} [chaves]   pre-keys enviadas pela extensão.
 */
export async function importarCredenciaisExternas(sessionId, store, creds, chaves = []) {
  const credenciais = normalizarCredenciais(reviver(creds));
  if (!credenciais?.me?.id) throw new Error("Credenciais inválidas: sessão não está pareada (campo 'me' ausente)");

  // key_id vem como "pre-key-12": categoria + id.
  const keys = {};
  for (const { key_id: keyId, json } of chaves) {
    const m = /^(pre-key)-(.+)$/.exec(keyId || "");
    if (!m || json == null) continue;
    (keys[m[1]] ??= {})[m[2]] = reviver(json);
  }

  // "baileys" é só o nome do formato de credenciais que a extensão envia (o pacote de conversão o chama assim).
  const { data, losses } = migrate({ from: "baileys", to: "zapo", data: { creds: credenciais, keys } });
  const sessao = store.session(sessionId);

  try {
    // As credenciais são gravadas por ÚLTIMO: se algo falhar, a sessão continua "sem credenciais".
    for (const preKey of data.preKeys ?? []) await sessao.preKey.putPreKey(preKey);
    if (data.identities?.length) {
      await sessao.identity.setRemoteIdentities(data.identities.map((i) => ({ address: i.address, identityKey: i.identityKey })));
    }
    if (data.sessions?.length) {
      await sessao.session.setSessionsBatch(data.sessions.map((s) => ({ address: s.address, session: s.record })));
    }
    for (const senderKey of data.senderKeys ?? []) await sessao.senderKey.upsertSenderKey(senderKey.record);
    if (data.appState?.keys?.length) await sessao.appState.upsertSyncKeys(data.appState.keys);
    await sessao.auth.save(data.credentials);
  } catch (erro) {
    for (const dominio of ["preKey", "identity", "session", "senderKey", "appState", "auth"]) {
      try {
        await sessao[dominio]?.clear?.();
      } catch {
        // melhor esforço
      }
    }
    throw erro;
  }

  return { avisos: losses?.length ?? 0, preKeys: data.preKeys?.length ?? 0 };
}
