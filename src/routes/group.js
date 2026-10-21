import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import logger from "../utils/logger.js";
import redis, { KEYS } from "../services/redis.js";

const router = express.Router();
const GROUP_LIST_CACHE_TTL_SECONDS = 6 * 60;

async function getignorarGrupo(req, res, next) {
  const sessionId = req.headers["apikey"];
  const getsessao = await WhatsAppService.redis.get(`sessao:${sessionId}`);
  if (getsessao && getsessao.ignorar_grupos) {
    return res.status(400).json({ success: false, message: "A sessão está configurada para ignorar grupos" });
  }
  next();
}

router.get("/list", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;

    const cacheGrupos = await redis.get(KEYS().grupos_cache(sessao.apikey));
    if (cacheGrupos) {
      return res.json({
        success: true,
        total: cacheGrupos.length,
        cache: true,
        groups: cacheGrupos,

      });
    }
    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }

    const groups = await sock.groupFetchAllParticipating();
    const arr = Object.values(groups);

    await redis.set(KEYS().grupos_cache(sessao.apikey), arr, GROUP_LIST_CACHE_TTL_SECONDS);

    return res.json({
      success: true,
      total: arr.length,
      groups: arr,
      cache: false,
    });
  } catch (error) {
    logger.error("Erro ao listar grupos:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

router.post("/info", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid é obrigatório",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    const groupInfo = await sock.groupMetadata(groupJid)
    res.json({
      success: true,
      data: groupInfo,
    });
  } catch (error) {
    logger.error("Erro ao obter informações do grupo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/create", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { subject, participants } = req.body;

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: "Digite o nome do grupo",
      });
    }

    if (!Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: "participants e obrigatorio e deve ser array",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    const participantes = participants.map(p => !p.includes("@") ? `${p}@s.whatsapp.net` : p)
    const result = await sock.groupCreate(subject, participantes);
    if (!result.id) {
      return res.status(400).json({
        success: false,
        message: "Erro ao criar grupo",
      });
    }
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    return res.json({
      success: true,
      message: "Grupo criado com sucesso",
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao criar grupo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/update-description", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid, description } = req.body;

    if (!groupJid || !description) {
      return res.status(400).json({
        success: false,
        message: "groupJid e description são obrigatórios",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }

    await sock.groupUpdateDescription(groupJid, description)
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    return res.json({
      success: true,
      message: "Descrição do grupo atualizada com sucesso",
      data: { groupJid, description },
    });
  } catch (error) {
    logger.error("Erro ao atualizar descrição do grupo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/ParticipantsUpdate", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid, participants, action } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid e obrigatórios",
      });
    }

    if (!Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        message: "participants deve ser array",
      });
    }

    if (action != "add" && action != "remove" && action != "promote" && action != "demote") {
      return res.status(400).json({
        success: false,
        message: "action invalido",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    const participantes = participants.map(p => !p.includes("@") ? `${p}@s.whatsapp.net` : p)
    const result = await sock.groupParticipantsUpdate(groupJid, participantes, action);
    const sucesso = result.filter(r => r.status === "200");
    const erros = result
      .filter(r => r.status !== "200")
      .map(r => ({
        jid: r.jid,
        status: Number(r.status),
        erro: r.content?.attrs?.error ?? null
      }));
    const msgErro = (
      action == "add" ?
        "Erro ao adicionar membro(s) ao grupo" :
        (action == 'remove' ? "Erro ao remover membro(s) do grupo" :
          action == 'promote' ? "Erro ao promover membro(s) a admin" :
            (action == 'demote' ? "Erro ao remover membro(s) como admin" :
              "Erro desconhecido"
            )
        )
    )
    const msgSucesso = (
      action == "add" ?
        "Membro(s) adicionado ao grupo com sucesso" :
        (action == 'remove' ? "Membro(s) removidos do grupo com sucesso" :
          action == 'promote' ? "Membro adicionado como admin com sucesso" :
            (action == 'demote' ? "Membro foi removido da lista de admin com sucesso" :
              "Operação bem sucedida"
            )
        )
    )

    if (erros.length > 0) {
      return res.status(400).json({
        success: false,
        message: msgErro,
        sucesso,
        erros: erros
      });
    }
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    return res.json({
      success: true,
      message: msgSucesso,
      participantes: sucesso
    });
  } catch (error) {
    logger.error("Erro ao adicionar participantes:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/leave", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid é obrigatório",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }

    const result = await sock.groupLeave(groupJid)
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    res.json({
      success: true,
      message: "Saiu do grupo com sucesso",
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao sair do grupo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/update-subject", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid, subject } = req.body;

    if (!groupJid || !subject) {
      return res.status(400).json({
        success: false,
        message: "groupJid e subject são obrigatórios",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }

    const result = await sock.groupUpdateSubject(groupJid, subject)
    await redis.del(KEYS().grupos_cache(sessao.apikey));
    res.json({
      success: true,
      message: "Nome do grupo atualizado com sucesso",
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao atualizar nome do grupo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/up-setting", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid, subject, setting } = req.body;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid e obrigatórios",
      });
    }

    if (setting !== "announcement" && setting !== "not_announcement" && setting !== "locked" && setting !== "unlocked") {
      return res.status(400).json({
        success: false,
        message: "setting permitidos => ('announcement' | 'not_announcement' | 'locked' | 'unlocked')",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    const result = await sock.groupSettingUpdate(groupJid, setting)
    console.log(result)
    await redis.del(KEYS().grupos_cache(sessao.apikey));

    res.json({
      success: true,
      message: "setting atualizado com sucesso",
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao Frecar grupos:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.get("/group-Invite/:groupJid", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid } = req.params;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid e obrigatório",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    const result = await sock.groupInviteCode(groupJid)
    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Erro ao gerar link de convite",
      });
    }
    const link = `https://chat.whatsapp.com/${result}`;

    res.json({
      success: true,
      message: "Link de grupo gerado com suceso",
      link,
    });
  } catch (error) {
    logger.error("Erro ao Frecar grupos:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.get("/group-Invite-revogar/:groupJid", authenticateApiKey, getignorarGrupo, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { groupJid } = req.params;

    if (!groupJid) {
      return res.status(400).json({
        success: false,
        message: "groupJid e obrigatório",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não foi iniciada ainda",
      });
    }
    const result = await sock.groupRevokeInvite(groupJid)
    if (!result) {
      return res.status(400).json({
        success: false,
        message: "Erro ao mudar link de convite",
      });
    }
    const link = `https://chat.whatsapp.com/${result}`;

    res.json({
      success: true,
      message: "Link de grupo gerado com suceso",
      link,
    });
  } catch (error) {
    logger.error("Erro ao Frecar grupos:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

export default router;
