import WhatsAppService from "../services/WhatsAppService.js";
import logger from "../utils/logger.js";

/**
 * Monta o handler de uma rota que usa a sessão conectada (req.sessao vem do authenticateApiKey).
 *
 * `acao({ req, sock, erroValidacao })` pode:
 *  - devolver um objeto            -> 200 { success: true, ...objeto }
 *  - devolver { success: false }   -> 409 (recusa sem erro, ex.: username indisponível)
 *  - chamar erroValidacao(mensagem) e devolver o resultado -> 400
 *  - lançar um erro com `imagemInvalida` -> 400; qualquer outro erro -> 500
 */
export function rotaSessao(acao, mensagemErro) {
  return async (req, res) => {
    try {
      const sock = WhatsAppService.sockets.get(req.sessao.apikey);
      if (!sock) {
        return res.status(400).json({ success: false, message: "Sessão não foi iniciada ainda" });
      }
      const erroValidacao = (message) => res.status(400).json({ success: false, message });
      const resultado = await acao({ req, sock, erroValidacao });
      if (resultado === res) return;
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
