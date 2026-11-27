/**
 * Privacidade da conta conectada: visto por último, online, foto, recado, confirmação de leitura,
 * quem pode adicionar em grupos / ligar, listas de exceção e contatos bloqueados.
 * Montado em /api/privacy. Todas as rotas usam o header `apikey` da sessão.
 */
import express from "express";
import { WA_PRIVACY_CATEGORY_TO_SETTING, WA_PRIVACY_DISALLOWED_LIST_CATEGORIES, WA_PRIVACY_SETTING_VALUES } from "zapo-js";
import authenticateApiKey from "../middleware/auth.js";
import { rotaSessao } from "./rotaSessao.js";

const router = express.Router();

/** Categorias que aceitam lista de exceções ("meus contatos, exceto..."): lastSeen, profilePicture, about... */
const CATEGORIAS_COM_EXCECAO = Object.values(WA_PRIVACY_DISALLOWED_LIST_CATEGORIES).map((categoria) => WA_PRIVACY_CATEGORY_TO_SETTING[categoria]);

const opcoesValidas = () =>
  Object.entries(WA_PRIVACY_SETTING_VALUES).map(([configuracao, valores]) => `${configuracao}: ${valores.join(" | ")}`).join("; ");

// Configurações atuais + valores aceitos por cada uma
router.get("/", authenticateApiKey, rotaSessao(async ({ sock }) => {
  const settings = await sock.fetchPrivacySettings();
  return { settings, options: WA_PRIVACY_SETTING_VALUES };
}, "Erro ao buscar as configurações de privacidade"));

// Altera uma ou várias configurações: { "lastSeen": "contacts", "online": "match_last_seen", ... }
router.put("/", authenticateApiKey, rotaSessao(async ({ req, sock, erroValidacao }) => {
  const alteracoes = Object.entries(req.body || {});
  if (alteracoes.length === 0) return erroValidacao(`Informe ao menos uma configuração. Opções: ${opcoesValidas()}`);

  for (const [configuracao, valor] of alteracoes) {
    const aceitos = WA_PRIVACY_SETTING_VALUES[configuracao];
    if (!aceitos) return erroValidacao(`Configuração desconhecida: ${configuracao}. Opções: ${Object.keys(WA_PRIVACY_SETTING_VALUES).join(", ")}`);
    if (!aceitos.includes(valor)) return erroValidacao(`Valor inválido para ${configuracao}: use ${aceitos.join(" | ")}`);
  }

  // Uma por vez: o servidor versiona cada categoria separadamente.
  const atualizadas = {};
  for (const [configuracao, valor] of alteracoes) {
    await sock.updatePrivacySetting(configuracao, valor);
    atualizadas[configuracao] = valor;
  }
  return { message: "Privacidade atualizada", updated: atualizadas };
}, "Erro ao atualizar a privacidade"));

// Lista de exceções de uma categoria ("meus contatos, exceto...")
router.get("/disallowed/:setting", authenticateApiKey, rotaSessao(async ({ req, sock, erroValidacao }) => {
  const { setting } = req.params;
  if (!CATEGORIAS_COM_EXCECAO.includes(setting)) return erroValidacao(`setting deve ser um destes: ${CATEGORIAS_COM_EXCECAO.join(", ")}`);
  const { jids } = await sock.fetchPrivacyDisallowedList(setting);
  return { setting, total: jids.length, jids };
}, "Erro ao buscar a lista de exceções"));

// Adiciona/remove contatos da lista de exceções. A categoria passa para "contact_blacklist".
router.put("/disallowed", authenticateApiKey, rotaSessao(async ({ req, sock, erroValidacao }) => {
  const { setting, add = [], remove = [] } = req.body || {};
  if (!CATEGORIAS_COM_EXCECAO.includes(setting)) return erroValidacao(`setting deve ser um destes: ${CATEGORIAS_COM_EXCECAO.join(", ")}`);
  if (!Array.isArray(add) || !Array.isArray(remove)) return erroValidacao("add e remove devem ser arrays de números/jids");
  if (add.length === 0 && remove.length === 0) return erroValidacao("Informe ao menos um número em add ou remove");
  await sock.updatePrivacyDisallowedList(setting, { add, remove });
  return { message: `Lista de exceções de ${setting} atualizada (categoria agora em contact_blacklist)` };
}, "Erro ao atualizar a lista de exceções"));

// Contatos bloqueados (para bloquear/desbloquear use POST /api/contact/block)
router.get("/blocklist", authenticateApiKey, rotaSessao(async ({ sock }) => {
  const { jids } = await sock.fetchBlocklist();
  return { total: jids.length, jids };
}, "Erro ao buscar os contatos bloqueados"));

export default router;
