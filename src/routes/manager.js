const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const BaileysService = require('../services/BaileysService');
const Store = require('../models/Store');
const logger = require('../utils/logger');
const { authenticateGlobalApiKey } = require('../middleware/globalAuth');
const config = require('../config/env');
const Session = require('../models/Session');


const router = express.Router();

// Página de login (GET)
router.get('/login', (req, res) => {
    const error = req.session.error;
    delete req.session.error;
    res.render('index', { error });
});

// Rota para processar o login (POST)
router.post('/login', async (req, res) => {
    const { apikey = null } = req.body;

    let modo = null
    if (config.globalApiKey === apikey) {
        modo = 'admin'
        req.session.userId = apikey
        req.session.modo = modo;
        return res.redirect('/manager/dashboard');
    } else {
        const getsession = await Session.findById(apikey)
        if (!getsession) {
            req.session.error = { message: 'Apikey invalido.', icon: 'danger' };
            return res.redirect('/manager/login');
        }
        modo = 'user'
        req.session.userId = apikey;
        req.session.modo = modo;
        return res.redirect('/manager/dashboard');

    }
});

// Página protegida - só acessa se estiver logado
router.get('/dashboard', checkAuth, async (req, res) => {
    const userId = req.session.userId;
    const modo = req.session.modo;
    if (modo == 'admin') {
        const instances = await Session.findByApiKey()
        res.render('dashboard', { instances, userId, error: null });
    } else if (modo == 'user') {
        const getintacias = await Session.findByApiKey();
        const instances = getintacias.filter(i => i.apikey == userId);
        if (!instances) {
            req.session.error = { message: 'Apikey invalida.', icon: 'danger' };
            res.redirect('/manager/login');
            return
        }

        res.render('user', { instances, userId, error: null });
    }

});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/dashboard');
        }
        res.clearCookie('connect.sid');
        res.redirect('/manager/login');
    });
});


//Verificar se ta logado
function checkAuth(req, res, next) {
    if (req.session && req.session.userId && req.session.modo) {
        next();
    } else {
        req.session.error = { message: 'Você precisa estar logado para acessar essa página.', icon: 'danger' };
        res.redirect('/manager/login');
    }
}
module.exports = router;