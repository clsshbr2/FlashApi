import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";
import Session from "../models/Session.js";
import axios from "axios";
import fs from "fs";
import path from "path";

const router = express.Router();

function checkStatusManager(req, res, next) {
  if (!config.manager_status) {
    return res.status(403).json({
      success: false,
      message: "O painel de gerenciamento está desativado.",
    });
  }
  next();
}

router.use(checkStatusManager);
// Página de login (GET)
router.get("/login", async (req, res) => {
  const { token = null, redirect = null } = req.query
  if (token) {
    if (config.manager_senha_admin === token) {

      req.session.userId = config.globalApiKey;
      req.session.modo = "admin";

      return res.redirect(`/manager/dashboard?redirect=${redirect}`);
    } else {

      const getsession = await Session.findById(token);
      if (getsession) {
        req.session.userId = token;
        req.session.modo = "user";
        return res.redirect(`/manager/dashboard?redirect=${redirect}`);
      }

    }
  }
  const error = req.session.error;
  delete req.session.error;
  res.render("index", { error });
});

// Rota para processar o login (POST)
router.post("/login", async (req, res) => {
  const { senha = null, login = null } = req.body;

  if (config.login_manager_admin === login && config.manager_senha_admin === senha) {

    req.session.userId = senha;
    req.session.modo = "admin";

    return res.redirect("/manager/dashboard");
  } else {

    if (login !== config.login_manager_user) {
      req.session.error = { message: "Senha ou login invalido.", icon: "danger" };
      return res.redirect("/manager/login");
    }

    const getsession = await Session.findById(senha);
    if (!getsession) {
      req.session.error = { message: "Apikey invalido.", icon: "danger" };
      return res.redirect("/manager/login");
    }
    req.session.userId = senha;
    req.session.modo = "user";
    return res.redirect("/manager/dashboard");
  }
});

// Página protegida - só acessa se estiver logado
router.get("/dashboard", checkAuth, async (req, res) => {
  const userId = req.session.userId;
  const modo = req.session.modo;
  const { redirect = null } = req.query

  if (modo == "admin") {
    const instances = await Session.findAllSessao();

    res.render("dashboard", { instances, userId: config.manager_senha_admin, apikey: config.globalApiKey, error: null });
  } else if (modo == "user") {
    const getinstacia = await Session.findById(userId);

    if (!getinstacia) {
      req.session.error = { message: "Apikey invalida.", icon: "danger" };
      res.redirect("/manager/login");
      return;
    }
    res.render("user", { apikey: userId, error: null, redirect });
  }
});

// Logout
router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.redirect("/dashboard");
    }
    res.clearCookie("connect.sid");
    res.redirect("/manager/login");
  });
});

// ---------------------------------------------------------------- Testador de endpoints

const CAMINHO_COLECAO = path.resolve("postman_collection.json");

// Página estilo Postman. As requisições vêm da coleção do Postman (fonte única).
router.get("/api-tester", checkAuth, async (req, res) => {
  const modo = req.session.modo;
  try {
    if (modo === "admin") {
      const sessoes = (await Session.findAllSessao()).map((s) => ({ apikey: s.apikey, nome: s.nome_sessao || s.apikey }));
      return res.render("api-tester", { modo, apikey: sessoes[0]?.apikey || "", apikeyGlobal: config.globalApiKey, sessoes });
    }
    return res.render("api-tester", { modo, apikey: req.session.userId, apikeyGlobal: "", sessoes: [] });
  } catch (error) {
    logger.error("Erro ao abrir o testador de endpoints:", error);
    return res.status(500).send("Erro ao abrir o testador de endpoints");
  }
});

// Painel de chamadas ao vivo (atendente fala pelo microfone do navegador)
router.get("/call", checkAuth, async (req, res) => {
  try {
    const modo = req.session.modo;
    const sessoes = modo === "admin"
      ? (await Session.findAllSessao()).map((s) => ({ apikey: s.apikey, nome: s.nome_sessao || s.apikey }))
      : [];
    return res.render("call", { modo, sessoes, chamadasAtivas: config.enableCalls });
  } catch (error) {
    logger.error("Erro ao abrir o painel de chamadas:", error);
    return res.status(500).send("Erro ao abrir o painel de chamadas");
  }
});

// Coleção servida SEM os valores das variáveis: o arquivo guarda chaves (ex.: apikey global)
// que um cliente comum logado no painel não pode ver.
router.get("/api-tester/collection.json", checkAuth, async (req, res) => {
  try {
    const colecao = JSON.parse(await fs.promises.readFile(CAMINHO_COLECAO, "utf8"));
    delete colecao.variable;
    delete colecao.auth;
    res.set("Cache-Control", "no-store");
    return res.json(colecao);
  } catch (error) {
    logger.error("Erro ao ler a coleção do Postman:", error);
    return res.status(500).json({ success: false, message: "Não foi possível ler postman_collection.json" });
  }
});

//Verificar se ta logado
function checkAuth(req, res, next) {
  if (req.session && req.session.userId && req.session.modo) {
    next();
  } else {
    req.session.error = {
      message: "Você precisa estar logado para acessar essa página.",
      icon: "danger",
    };
    res.redirect("/manager/login");
  }
}
export default router;
