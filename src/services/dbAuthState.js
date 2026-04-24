import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import Database from "../config/database.js";

const db = new Database();
const isPostgres = process.env.DB_TYPE === "postgres";

/**
 * makeDbAuthState
 *
 * Stores Baileys auth state (creds + signal keys) in the application database
 * (MySQL or PostgreSQL). Redis is NOT used for auth – only for other caches.
 *
 * @param {string} sessionId - The session / apikey identifier.
 * @returns {{ state, saveCreds, loadCreds, clearAuth }}
 */
export const makeDbAuthState = async (sessionId) => {
  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const upsertCredsSQL = isPostgres
    ? `INSERT INTO wa_sessions (session_id, creds_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (session_id) DO UPDATE
       SET creds_json = EXCLUDED.creds_json, updated_at = CURRENT_TIMESTAMP`
    : `INSERT INTO wa_sessions (session_id, creds_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE creds_json = VALUES(creds_json), updated_at = CURRENT_TIMESTAMP`;

  const upsertKeySQL = isPostgres
    ? `INSERT INTO wa_session_keys (session_id, key_type, key_id, value_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (session_id, key_type, key_id) DO UPDATE
       SET value_json = EXCLUDED.value_json, updated_at = CURRENT_TIMESTAMP`
    : `INSERT INTO wa_session_keys (session_id, key_type, key_id, value_json, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = CURRENT_TIMESTAMP`;

  // ------------------------------------------------------------------
  // Load credentials
  // ------------------------------------------------------------------
  const loadCreds = async () => {
    const rows = await db.execute(
      "SELECT creds_json FROM wa_sessions WHERE session_id = ?",
      [sessionId],
    );
    if (rows && rows.length > 0 && rows[0].creds_json) {
      const raw =
        typeof rows[0].creds_json === "string"
          ? rows[0].creds_json
          : JSON.stringify(rows[0].creds_json);
      return JSON.parse(raw, BufferJSON.reviver);
    }
    return initAuthCreds();
  };

  let creds = await loadCreds();

  // ------------------------------------------------------------------
  // Save credentials (called on creds.update event)
  // ------------------------------------------------------------------
  const saveCreds = async () => {
    const credsJson = JSON.stringify(creds, BufferJSON.replacer);
    await db.execute(upsertCredsSQL, [sessionId, credsJson]);
  };

  // ------------------------------------------------------------------
  // Auth state object (compatible with Baileys SocketConfig.auth)
  // ------------------------------------------------------------------
  const state = {
    creds,

    keys: {
      /**
       * Get one or more signal keys of a given type.
       * @param {string} type
       * @param {string[]} ids
       */
      get: async (type, ids) => {
        const results = {};
        for (const id of ids) {
          const rows = await db.execute(
            "SELECT value_json FROM wa_session_keys WHERE session_id = ? AND key_type = ? AND key_id = ?",
            [sessionId, type, id],
          );
          if (rows && rows.length > 0 && rows[0].value_json) {
            const raw =
              typeof rows[0].value_json === "string"
                ? rows[0].value_json
                : JSON.stringify(rows[0].value_json);
            let value = JSON.parse(raw, BufferJSON.reviver);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            results[id] = value;
          } else {
            results[id] = null;
          }
        }
        return results;
      },

      /**
       * Persist a batch of signal keys.
       * @param {Object} updates - { [type]: { [id]: value | null } }
       */
      set: async (updates) => {
        const ops = [];
        for (const type in updates) {
          for (const id in updates[type]) {
            const value = updates[type][id];
            if (!value) {
              ops.push(
                db.execute(
                  "DELETE FROM wa_session_keys WHERE session_id = ? AND key_type = ? AND key_id = ?",
                  [sessionId, type, id],
                ),
              );
            } else {
              const valueJson = JSON.stringify(value, BufferJSON.replacer);
              ops.push(db.execute(upsertKeySQL, [sessionId, type, id, valueJson]));
            }
          }
        }
        await Promise.all(ops);
      },
    },
  };

  return { state, saveCreds, loadCreds };
};

/**
 * clearDbAuth
 *
 * Removes all auth data (creds + keys) for a session from the database.
 * Call this when a session is permanently logged out.
 *
 * @param {string} sessionId
 */
export const clearDbAuth = async (sessionId) => {
  try {
    await db.execute("DELETE FROM wa_sessions WHERE session_id = ?", [sessionId]);
    await db.execute("DELETE FROM wa_session_keys WHERE session_id = ?", [
      sessionId,
    ]);
  } catch (err) {
    console.error("Erro ao limpar auth do banco de dados:", err);
  }
};
