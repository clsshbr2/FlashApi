/**
 * Perfil da conta conectada: nome, recado, foto, @username e perfil comercial.
 * Montado em /api/profile. Todas as rotas usam o header `apikey` da sessão.
 */
import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import logger from "../utils/logger.js";
import { imagemParaFotoPerfil, resolverMidia } from "../whatsapp/utils.js";

const router = express.Router();

const LIMITE_NOME = 25; // limite do WhatsApp para o nome exibido
const LIMITE_RECADO = 139; // limite do WhatsApp para o recado ("About")
const CAMPOS_COMERCIAIS = ["address", "description", "email", "websites", "categories", "businessHours", "latitude", "longitude"];

/** Monta a rota com sessão conectada e trata erros num lugar só. */
function rotaPerfil(acao, mensagemErro) {
  return async (req, res) => {
    try {
      const sock = WhatsAppService.sockets.get(req.sessao.apikey);
      if (!sock) {
        return res.status(400).json({ success: false, message: "Sessão não foi iniciada ainda" });
      }
      const erroValidacao = (message) => res.status(400).json({ success: false, message });
      const resultado = await acao({ req, sock, erroValidacao });
      if (resultado === res) return;
      // A ação pode recusar sem erro (ex.: username indisponível): responde 409 com success: false
      return res.status(resultado?.success === false ? 409 : 200).json({ success: true, ...resultado });
    } catch (error) {
      if (error?.imagemInvalida) {
        return res.status(400).json({ success: false, message: error.message });
      }
      logger.error(`${mensagemErro}:`, error);
      return res.status(500).json({ success: false, message: error.message || "Erro interno do servidor" });
    }
  };
}

/** Não deixa uma consulta opcional derrubar a rota inteira (ex.: privacidade, conta sem username). */
async function opcional(promessa) {
  try {
    return await promessa;
  } catch {
    return null;
  }
}

/** Aceita URL, data URI ou base64 puro. */
async function lerImagem(entrada) {
  if (typeof entrada === "string" && !entrada.startsWith("data:") && !/^https?:\/\//i.test(entrada)) {
    const buffer = Buffer.from(entrada, "base64");
    if (buffer.length === 0) throw new Error("Imagem em base64 inválida");
    return buffer;
  }
  return resolverMidia(entrada);
}

const textoValido = (valor) => typeof valor === "string";

// --------------------------------------------------------------- Dados da conta

router.get("/me", authenticateApiKey, rotaPerfil(async ({ sock }) => {
  const user = sock.user;
  if (!user?.id) return { profile: null, message: "Sessão ainda não conectada" };
  const [about, picture, username] = await Promise.all([
    opcional(sock.fetchStatus(user.id)),
    opcional(sock.profilePictureUrl(user.id, "image")),
    opcional(sock.getOwnUsername()),
  ]);
  return {
    profile: {
      id: user.id,
      lid: user.lid,
      name: user.name,
      about,
      picture: picture || null,
      username: username?.username || null,
    },
  };
}, "Erro ao buscar o perfil"));

router.put("/name", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const nome = req.body?.name;
  if (!textoValido(nome) || !nome.trim()) return erroValidacao("name é obrigatório");
  if (nome.length > LIMITE_NOME) return erroValidacao(`name pode ter no máximo ${LIMITE_NOME} caracteres`);
  await sock.updateProfileName(nome.trim());
  return { message: "Nome atualizado" };
}, "Erro ao atualizar o nome"));

router.put("/status", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const recado = req.body?.status;
  if (!textoValido(recado)) return erroValidacao("status é obrigatório (texto)");
  if (recado.length > LIMITE_RECADO) return erroValidacao(`status pode ter no máximo ${LIMITE_RECADO} caracteres`);
  await sock.updateProfileStatus(recado);
  return { message: "Recado atualizado" };
}, "Erro ao atualizar o recado"));

// Foto da conta, ou de um grupo quando groupJid for informado (a conta precisa ser admin)
router.put("/picture", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const { image, groupJid } = req.body || {};
  if (!image) return erroValidacao("image é obrigatório (URL, data URI ou base64)");
  const original = await lerImagem(image);
  const jpeg = await imagemParaFotoPerfil(original);
  const pictureId = await sock.updateProfilePicture(jpeg, groupJid);
  return { message: groupJid ? "Foto do grupo atualizada" : "Foto de perfil atualizada", pictureId };
}, "Erro ao atualizar a foto"));

router.delete("/picture", authenticateApiKey, rotaPerfil(async ({ req, sock }) => {
  const groupJid = req.body?.groupJid || req.query.groupJid;
  await sock.removeProfilePicture(groupJid);
  return { message: groupJid ? "Foto do grupo removida" : "Foto de perfil removida" };
}, "Erro ao remover a foto"));

// Recado ("About") de um contato
router.post("/contact-status", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const { jid } = req.body || {};
  if (!jid) return erroValidacao("jid é obrigatório");
  const status = await sock.fetchStatus(jid);
  return { jid, status, message: status === null ? "Recado oculto pela privacidade do contato ou inexistente" : undefined };
}, "Erro ao buscar o recado do contato"));

// --------------------------------------------------------------- @username

router.get("/username", authenticateApiKey, rotaPerfil(async ({ sock }) => {
  const { username, state } = await sock.getOwnUsername();
  return { username, state };
}, "Erro ao buscar o username"));

router.post("/username/check", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const { username } = req.body || {};
  if (!textoValido(username) || !username.trim()) return erroValidacao("username é obrigatório");
  return await sock.checkUsername(username.trim().replace(/^@/, ""));
}, "Erro ao verificar o username"));

router.put("/username", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const { username } = req.body || {};
  if (!textoValido(username) || !username.trim()) return erroValidacao("username é obrigatório");
  const nome = username.trim().replace(/^@/, "");
  const aceito = await sock.setUsername(nome);
  if (!aceito) {
    const { suggestions } = (await opcional(sock.checkUsername(nome))) || {};
    return { success: false, message: "Username indisponível ou recusado pelo WhatsApp", suggestions: suggestions || [] };
  }
  return { username: nome, message: "Username definido" };
}, "Erro ao definir o username"));

router.delete("/username", authenticateApiKey, rotaPerfil(async ({ sock }) => {
  const removido = await sock.deleteUsername();
  return { success: Boolean(removido), message: removido ? "Username removido" : "Não foi possível remover o username" };
}, "Erro ao remover o username"));

// Descobre a conta de um @username. "key-required" = o dono exige a chave (PIN) para ser encontrado.
router.post("/username/resolve", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const { username, usernameKey } = req.body || {};
  if (!textoValido(username) || !username.trim()) return erroValidacao("username é obrigatório");
  return await sock.resolveUsername(username.trim().replace(/^@/, ""), usernameKey);
}, "Erro ao buscar o username"));

// --------------------------------------------------------------- Perfil comercial

// Perfil comercial de um contato; sem jid, o da própria conta
router.post("/business", authenticateApiKey, rotaPerfil(async ({ req, sock }) => {
  const jid = req.body?.jid || sock.user?.id;
  const business = await sock.getBusinessProfile(jid);
  return { business, message: business ? undefined : "Não é uma conta comercial" };
}, "Erro ao buscar o perfil comercial"));

// Editar o perfil comercial da conta (somente WhatsApp Business)
router.put("/business", authenticateApiKey, rotaPerfil(async ({ req, sock, erroValidacao }) => {
  const corpo = req.body || {};
  const dados = Object.fromEntries(CAMPOS_COMERCIAIS.filter((campo) => corpo[campo] !== undefined).map((campo) => [campo, corpo[campo]]));
  if (Object.keys(dados).length === 0) return erroValidacao(`Informe ao menos um destes campos: ${CAMPOS_COMERCIAIS.join(", ")}`);

  // websites aceita ["https://..."] ou [{ url: "https://..." }]
  if (dados.websites !== undefined) {
    if (!Array.isArray(dados.websites)) return erroValidacao("websites deve ser um array");
    dados.websites = dados.websites.map((site) => (typeof site === "string" ? { url: site } : site));
  }
  if (dados.categories !== undefined) {
    if (!Array.isArray(dados.categories)) return erroValidacao("categories deve ser um array");
    dados.categories = dados.categories.map((categoria) => (typeof categoria === "object" ? categoria : { id: String(categoria) }));
  }
  for (const campo of ["latitude", "longitude"]) {
    if (dados[campo] !== undefined && !Number.isFinite(Number(dados[campo]))) return erroValidacao(`${campo} deve ser um número`);
    if (dados[campo] !== undefined) dados[campo] = Number(dados[campo]);
  }

  await sock.updateBusinessProfile(dados);
  return { message: "Perfil comercial atualizado" };
}, "Erro ao atualizar o perfil comercial"));

export default router;
