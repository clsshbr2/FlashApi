import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import Store from "../models/Store.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";
import Session from "../models/Session.js";
import axios from "axios";

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
