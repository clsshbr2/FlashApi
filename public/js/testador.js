/**
 * Testador de endpoints do painel do cliente.
 * Escolhe uma requisição pronta, edita o corpo (JSON) e vê a resposta na hora.
 * Usa a apikey da própria sessão (data-apikey de #userInfo).
 */
document.addEventListener("DOMContentLoaded", () => {
	const card = document.getElementById("testador");
	if (!card) return;

	const apikey = document.getElementById("userInfo").getAttribute("data-apikey");
	const base = window.location.origin + "/api";

	const $ = (id) => document.getElementById(id);
	const seletor = $("testador_preset");
	const metodo = $("testador_metodo");
	const caminho = $("testador_caminho");
	const corpo = $("testador_corpo");
	const saida = $("testador_resposta");
	const status = $("testador_status");
	const botaoEnviar = $("testador_enviar");
	const numero = $("testador_numero");

	// {{jid}} no corpo/caminho é trocado pelo número digitado acima.
	const PRESETS = {
		"Mensagens": [
			{ nome: "Enviar texto", m: "POST", p: "/chat/send-text", b: { jid: "{{jid}}", text: "Teste Flash API", delay: 1200 } },
			{ nome: "Enviar imagem", m: "POST", p: "/chat/send-image", b: { jid: "{{jid}}", caption: "Imagem de teste", image: "https://raw.githubusercontent.com/clsshbr2/FlashApi/v1.0.5/public/images/banner.jpg" } },
			{ nome: "Enviar documento", m: "POST", p: "/chat/send-document", b: { jid: "{{jid}}", document: "https://s3.quickgestor.com/dados1921/uploads/PRO.pdf", fileName: "PRO.pdf", mimetype: "application/pdf" } },
			{ nome: "Enviar localização", m: "POST", p: "/chat/send-location", b: { jid: "{{jid}}", location: { degreesLatitude: -23.55052, degreesLongitude: -46.633308, name: "Praça da Sé", address: "São Paulo - SP" } } },
			{ nome: "Enviar contato", m: "POST", p: "/chat/send-contact", b: { jid: "{{jid}}", displayName: "João Silva", contact: { firstName: "João", lastName: "Silva", phone: "5511999999999" } } },
			{ nome: "Enviar enquete", m: "POST", p: "/chat/send-poll", b: { jid: "{{jid}}", poll: { name: "Qual opção?", values: ["A", "B", "C"], selectableCount: 1 } } },
			{ nome: "Enviar reação", m: "POST", p: "/chat/send-reaction", b: { jid: "{{jid}}", react: { emoji: "👍", messageId: "ID_DA_MENSAGEM" } } },
			{ nome: "Digitando…", m: "POST", p: "/chat/typing", b: { jid: "{{jid}}", typing: true, delay: 3000 } },
			{ nome: "Marcar como lida", m: "POST", p: "/chat/mark-read", b: { jid: "{{jid}}", messageId: "ID_DA_MENSAGEM" } },
			{ nome: "Apagar mensagem", m: "DELETE", p: "/chat/delete/ID_DA_MENSAGEM" },
		],
		"Consultas": [
			{ nome: "Listar contatos", m: "GET", p: "/contact/list" },
			{ nome: "Listar chats", m: "GET", p: "/chat/chats?page=1&limit=20" },
			{ nome: "Mensagens de um chat", m: "GET", p: "/chat/messages?jid={{jid}}&limit=20" },
			{ nome: "Verificar número no WhatsApp", m: "POST", p: "/contact/check", b: { number: "{{numero}}" } },
			{ nome: "LID para JID", m: "POST", p: "/contact/lid-to-jid", b: { lid: "123456789@lid" } },
			{ nome: "Status da sessão", m: "GET", p: "/session/status" },
			{ nome: "Configurações e estatísticas", m: "GET", p: "/config/session" },
		],
		"Grupos": [
			{ nome: "Listar grupos", m: "GET", p: "/group/list" },
			{ nome: "Info do grupo", m: "POST", p: "/group/info", b: { groupJid: "ID@g.us" } },
			{ nome: "Criar grupo", m: "POST", p: "/group/create", b: { subject: "Grupo de teste", participants: ["{{numero}}"] } },
			{ nome: "Alterar nome", m: "POST", p: "/group/update-subject", b: { groupJid: "ID@g.us", subject: "Novo nome" } },
			{ nome: "Link de convite", m: "GET", p: "/group/group-Invite/ID@g.us" },
		],
		"Sessão": [
			{ nome: "Reiniciar sessão", m: "PUT", p: "/session/restart" },
			{ nome: "Desconectar", m: "DELETE", p: "/session/desconect/" },
		],
	};

	// Monta o seletor agrupado
	Object.entries(PRESETS).forEach(([grupo, itens]) => {
		const og = document.createElement("optgroup");
		og.label = grupo;
		itens.forEach((item) => {
			const op = document.createElement("option");
			op.value = `${grupo}|${item.nome}`;
			op.textContent = `${item.m}  ${item.nome}`;
			og.appendChild(op);
		});
		seletor.appendChild(og);
	});

	const achar = (valor) => {
		const [grupo, nome] = valor.split("|");
		return PRESETS[grupo]?.find((i) => i.nome === nome);
	};

	const carregar = () => {
		const item = achar(seletor.value);
		if (!item) return;
		metodo.value = item.m;
		caminho.value = item.p;
		corpo.value = item.b ? JSON.stringify(item.b, null, 2) : "";
		corpo.disabled = !item.b && item.m === "GET";
	};
	seletor.addEventListener("change", carregar);
	metodo.addEventListener("change", () => (corpo.disabled = metodo.value === "GET"));
	carregar();

	// Lembra o número entre testes
	try { numero.value = localStorage.getItem("testador_numero") || ""; } catch { }
	numero.addEventListener("input", () => { try { localStorage.setItem("testador_numero", numero.value); } catch { } });

	const jidDe = (n) => {
		const t = (n || "").trim();
		if (!t) return "";
		return t.includes("@") ? t : t.replace(/\D/g, "") + "@s.whatsapp.net";
	};
	const aplicarVariaveis = (texto) =>
		texto.replaceAll("{{jid}}", jidDe(numero.value)).replaceAll("{{numero}}", numero.value.replace(/\D/g, ""));

	botaoEnviar.addEventListener("click", async () => {
		const m = metodo.value;
		const url = base + aplicarVariaveis(caminho.value.trim());
		const opcoes = { method: m, headers: { apikey } };
		if (m !== "GET" && corpo.value.trim()) {
			const texto = aplicarVariaveis(corpo.value);
			try { JSON.parse(texto); } catch (e) {
				status.className = "badge bg-danger";
				status.textContent = "JSON inválido";
				saida.textContent = e.message;
				return;
			}
			opcoes.headers["Content-Type"] = "application/json";
			opcoes.body = texto;
		}

		botaoEnviar.disabled = true;
		status.className = "badge bg-secondary";
		status.textContent = "enviando…";
		const inicio = performance.now();
		try {
			const r = await fetch(url, opcoes);
			const bruto = await r.text();
			let exibir = bruto;
			try { exibir = JSON.stringify(JSON.parse(bruto), null, 2); } catch { }
			status.className = "badge " + (r.ok ? "bg-success" : "bg-danger");
			status.textContent = `${r.status} · ${Math.round(performance.now() - inicio)} ms`;
			saida.textContent = exibir || "(vazio)";
		} catch (e) {
			status.className = "badge bg-danger";
			status.textContent = "falha";
			saida.textContent = e.message;
		} finally {
			botaoEnviar.disabled = false;
		}
	});

	$("testador_copiar").addEventListener("click", () => {
		navigator.clipboard?.writeText(saida.textContent);
	});

	// Expandir/recolher
	const cabecalho = $("card_testador_togget");
	const conteudo = $("card_testador");
	const icone = $("icon-card-testador");
	cabecalho.addEventListener("click", () => {
		const aberto = !conteudo.classList.toggle("d-none");
		icone.className = `bi ${aberto ? "bi-chevron-up" : "bi-chevron-down"} fs-4 text-secondary`;
	});
});
