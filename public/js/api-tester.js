/**
 * Testador de endpoints (estilo Postman).
 *
 * A lista de requisições vem de /manager/api-tester/collection.json, que é o
 * postman_collection.json do projeto sem os valores das variáveis. Assim, toda rota
 * adicionada ao Postman aparece aqui sem mexer neste arquivo.
 *
 * Variáveis da coleção: {{baseUrl}}, {{apikey}} (sessão escolhida), {{apikeyGlobal}}
 * (só no modo admin) e {{RemoteJid}} (número de teste).
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const cfg = $("testerConfig").dataset;
  const modoAdmin = cfg.modo === "admin";
  const BASE = window.location.origin + "/api";

  const el = {
    arvore: $("arvore"), filtro: $("filtro"), contagem: $("contagem"),
    nome: $("nomeRequisicao"), metodo: $("metodo"), caminho: $("caminho"),
    corpo: $("corpo"), erroJson: $("erroJson"), params: $("params"), qtdParams: $("qtdParams"),
    headerApikey: $("headerApikey"), avisoAdmin: $("avisoAdmin"), enviar: $("enviar"),
    status: $("status"), tempo: $("tempo"), resposta: $("resposta"), imagem: $("respostaImagem"),
    sessao: $("varSessao"), numero: $("varNumero"),
  };

  let requisicoes = []; // { id, pasta[], nome, metodo, caminho, corpo, params[{chave, valor}], exigeGlobal }
  let atual = null;
  let urlImagem = null;

  // ------------------------------------------------------------------ Variáveis

  const apikeySessao = () => (modoAdmin ? el.sessao?.value || "" : cfg.apikey);

  function jidDoNumero(texto) {
    const t = (texto || "").trim();
    if (!t) return "";
    return t.includes("@") ? t : t.replace(/\D/g, "") + "@s.whatsapp.net";
  }

  function valoresVariaveis() {
    return {
      baseUrl: BASE,
      apikey: apikeySessao(),
      apikeyGlobal: modoAdmin ? cfg.apikeyGlobal : "",
      RemoteJid: jidDoNumero(el.numero.value),
    };
  }

  /** Troca {{variavel}}; devolve também as que ficaram sem valor. */
  function aplicarVariaveis(texto) {
    const valores = valoresVariaveis();
    const faltando = new Set();
    const resultado = (texto || "").replace(/{{\s*(\w+)\s*}}/g, (trecho, nome) => {
      if (valores[nome]) return valores[nome];
      faltando.add(nome);
      return trecho;
    });
    return { resultado, faltando };
  }

  // ------------------------------------------------------------------ Coleção

  function extrairCaminho(url) {
    const bruto = typeof url === "string" ? url : url?.raw || "";
    return bruto.replace(/^{{\s*baseUrl\s*}}/, "") || "/";
  }

  function lerColecao(itens, pasta = []) {
    const lista = [];
    for (const item of itens || []) {
      if (item.item) {
        lista.push(...lerColecao(item.item, [...pasta, item.name]));
        continue;
      }
      const req = item.request || {};
      const auth = (req.auth?.apikey || []).find((a) => a.key === "value")?.value || "";
      lista.push({
        id: [...pasta, item.name].join(" / "),
        pasta,
        nome: item.name,
        metodo: (req.method || "GET").toUpperCase(),
        caminho: extrairCaminho(req.url),
        corpo: req.body?.mode === "raw" ? req.body.raw || "" : "",
        params: (req.url?.variable || []).map((v) => ({ chave: v.key, valor: v.value ?? "" })),
        exigeGlobal: auth.includes("apikeyGlobal"),
      });
    }
    return lista;
  }

  function criarItem(req) {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "tester-item";
    botao.dataset.id = req.id;
    botao.title = `${req.metodo} /api${req.caminho}`;

    const metodo = document.createElement("span");
    metodo.className = `metodo metodo-${req.metodo}`;
    metodo.textContent = req.metodo;
    const nome = document.createElement("span");
    nome.className = "tester-item-nome";
    nome.textContent = req.nome;
    botao.append(metodo, nome);

    if (req.exigeGlobal) {
      const cadeado = document.createElement("i");
      cadeado.className = "bi bi-shield-lock";
      cadeado.title = "Exige a apikey global (administrador)";
      botao.append(cadeado);
    }
    botao.addEventListener("click", () => selecionar(req.id));
    return botao;
  }

  /** Monta a árvore de pastas; com filtro, mostra só o que casa e abre as pastas. */
  function desenharArvore() {
    const termo = el.filtro.value.trim().toLowerCase();
    const visiveis = requisicoes.filter((r) =>
      !termo || `${r.nome} ${r.metodo} ${r.caminho} ${r.pasta.join(" ")}`.toLowerCase().includes(termo),
    );

    const raiz = { filhos: new Map(), itens: [] };
    for (const req of visiveis) {
      let no = raiz;
      for (const pasta of req.pasta) {
        if (!no.filhos.has(pasta)) no.filhos.set(pasta, { filhos: new Map(), itens: [] });
        no = no.filhos.get(pasta);
      }
      no.itens.push(req);
    }

    const contar = (no) => no.itens.length + [...no.filhos.values()].reduce((s, f) => s + contar(f), 0);
    const montar = (no, destino) => {
      for (const [nomePasta, filho] of no.filhos) {
        const pasta = document.createElement("details");
        pasta.className = "tester-folder";
        pasta.open = Boolean(termo) || filho.itens.some((r) => r.id === atual?.id) || contemAtual(filho);
        const titulo = document.createElement("summary");
        titulo.textContent = nomePasta;
        const qtd = document.createElement("span");
        qtd.className = "tester-folder-count";
        qtd.textContent = contar(filho);
        titulo.append(qtd);
        pasta.append(titulo);
        montar(filho, pasta);
        destino.append(pasta);
      }
      no.itens.forEach((req) => destino.append(criarItem(req)));
    };
    const contemAtual = (no) => no.itens.some((r) => r.id === atual?.id) || [...no.filhos.values()].some(contemAtual);

    el.arvore.replaceChildren();
    montar(raiz, el.arvore);
    marcarAtivo();
    el.contagem.textContent = termo
      ? `${visiveis.length} de ${requisicoes.length} requisições`
      : `${requisicoes.length} requisições`;
  }

  function marcarAtivo() {
    el.arvore.querySelectorAll(".tester-item").forEach((b) => {
      const ativo = b.dataset.id === atual?.id;
      b.classList.toggle("ativo", ativo);
      if (!ativo) return;
      // abre as pastas acima da requisição escolhida
      for (let pai = b.parentElement; pai && pai !== el.arvore; pai = pai.parentElement) {
        if (pai.tagName === "DETAILS") pai.open = true;
      }
    });
  }

  // ------------------------------------------------------------------ Requisição

  function selecionar(id) {
    const req = requisicoes.find((r) => r.id === id);
    if (!req) return;
    atual = req;
    el.nome.textContent = req.nome;
    el.metodo.value = req.metodo;
    el.caminho.value = req.caminho;
    el.corpo.value = formatarSePuder(req.corpo);
    el.erroJson.textContent = "";
    desenharParams(req.params);
    atualizarAvisos();
    marcarAtivo();
    history.replaceState(null, "", "#" + encodeURIComponent(id));
  }

  function formatarSePuder(texto) {
    if (!texto.trim()) return "";
    try { return JSON.stringify(JSON.parse(texto), null, 2); } catch { return texto; }
  }

  function desenharParams(params) {
    el.params.replaceChildren();
    el.qtdParams.textContent = params.length || "";
    if (params.length === 0) {
      const vazio = document.createElement("p");
      vazio.className = "text-muted small mb-0";
      vazio.textContent = "Esta rota não tem parâmetros no caminho.";
      el.params.append(vazio);
      return;
    }
    for (const p of params) {
      const linha = document.createElement("label");
      linha.className = "tester-param";
      const chave = document.createElement("code");
      chave.textContent = ":" + p.chave;
      const entrada = document.createElement("input");
      entrada.className = "form-control form-control-sm";
      entrada.value = p.valor;
      entrada.dataset.chave = p.chave;
      linha.append(chave, entrada);
      el.params.append(linha);
    }
  }

  function atualizarAvisos() {
    const global = Boolean(atual?.exigeGlobal);
    el.avisoAdmin.hidden = !(global && !modoAdmin);
    const chave = global ? (modoAdmin ? "apikey global" : "(sem acesso: só administrador)") : apikeySessao() ? "apikey da sessão" : "nenhuma sessão escolhida";
    el.headerApikey.textContent = chave;
  }

  /** Monta método, URL, headers e corpo prontos para enviar (ou um erro para mostrar). */
  function montarEnvio() {
    const metodo = el.metodo.value;
    let caminho = el.caminho.value.trim();
    if (!caminho.startsWith("/")) caminho = "/" + caminho;

    el.params.querySelectorAll("input[data-chave]").forEach((entrada) => {
      caminho = caminho.replace(new RegExp(":" + entrada.dataset.chave + "(?=/|\\?|$)"), encodeURIComponent(entrada.value));
    });

    const rota = aplicarVariaveis(caminho);
    const corpo = metodo === "GET" ? { resultado: "", faltando: new Set() } : aplicarVariaveis(el.corpo.value);
    const faltando = new Set([...rota.faltando, ...corpo.faltando]);
    if (faltando.has("RemoteJid")) return { erro: "Preencha o número de teste ({{RemoteJid}}) no topo da página." };
    if (faltando.size) return { erro: `Sem valor para: ${[...faltando].map((v) => `{{${v}}}`).join(", ")}` };

    const headers = {};
    const chave = atual?.exigeGlobal && modoAdmin ? cfg.apikeyGlobal : apikeySessao();
    if (chave) headers.apikey = chave;

    let body;
    if (corpo.resultado.trim()) {
      try { JSON.parse(corpo.resultado); } catch (e) { return { erro: `JSON inválido no corpo: ${e.message}` }; }
      headers["Content-Type"] = "application/json";
      body = corpo.resultado;
    }
    return { metodo, url: BASE + rota.resultado, headers, body };
  }

  function mostrarStatus(texto, tipo) {
    el.status.className = `badge bg-${tipo}`;
    el.status.textContent = texto;
  }

  function limparImagem() {
    if (urlImagem) URL.revokeObjectURL(urlImagem);
    urlImagem = null;
    el.imagem.hidden = true;
    el.imagem.removeAttribute("src");
  }

  async function enviar() {
    const envio = montarEnvio();
    limparImagem();
    if (envio.erro) {
      mostrarStatus("não enviado", "warning");
      el.tempo.textContent = "";
      el.resposta.textContent = envio.erro;
      return;
    }

    el.enviar.disabled = true;
    mostrarStatus("enviando…", "secondary");
    el.tempo.textContent = "";
    const inicio = performance.now();
    try {
      const r = await fetch(envio.url, { method: envio.metodo, headers: envio.headers, body: envio.body });
      const tipo = r.headers.get("content-type") || "";
      const ms = Math.round(performance.now() - inicio);

      if (tipo.startsWith("image/")) {
        const blob = await r.blob();
        urlImagem = URL.createObjectURL(blob);
        el.imagem.src = urlImagem;
        el.imagem.hidden = false;
        el.resposta.textContent = `(imagem ${tipo}, ${formatarTamanho(blob.size)})`;
        el.tempo.textContent = `${ms} ms · ${formatarTamanho(blob.size)}`;
      } else {
        const texto = await r.text();
        el.resposta.textContent = formatarSePuder(texto) || "(resposta vazia)";
        el.tempo.textContent = `${ms} ms · ${formatarTamanho(new Blob([texto]).size)}`;
      }
      mostrarStatus(`${r.status} ${r.statusText}`.trim(), r.ok ? "success" : r.status < 500 ? "warning" : "danger");
    } catch (e) {
      mostrarStatus("falhou", "danger");
      el.resposta.textContent = `Não foi possível chamar a API: ${e.message}`;
    } finally {
      el.enviar.disabled = false;
    }
  }

  function formatarTamanho(bytes) {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
  }

  function copiarTexto(texto, botao) {
    navigator.clipboard?.writeText(texto).then(() => {
      const original = botao.innerHTML;
      botao.innerHTML = '<i class="bi bi-check2 me-1"></i> Copiado';
      setTimeout(() => (botao.innerHTML = original), 1200);
    });
  }

  function comandoCurl() {
    const envio = montarEnvio();
    if (envio.erro) return `# ${envio.erro}`;
    const aspas = (t) => `'${String(t).replace(/'/g, "'\\''")}'`;
    const partes = [`curl -X ${envio.metodo} ${aspas(envio.url)}`];
    for (const [k, v] of Object.entries(envio.headers)) partes.push(`-H ${aspas(`${k}: ${v}`)}`);
    if (envio.body) partes.push(`--data ${aspas(JSON.stringify(JSON.parse(envio.body)))}`);
    return partes.join(" \\\n  ");
  }

  // ------------------------------------------------------------------ Eventos

  el.filtro.addEventListener("input", desenharArvore);
  el.enviar.addEventListener("click", enviar);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); enviar(); }
  });
  $("formatar").addEventListener("click", () => {
    if (!el.corpo.value.trim()) return;
    try {
      el.corpo.value = JSON.stringify(JSON.parse(el.corpo.value), null, 2);
      el.erroJson.textContent = "";
    } catch (e) {
      el.erroJson.textContent = `JSON inválido: ${e.message}`;
    }
  });
  $("copiar").addEventListener("click", (e) => copiarTexto(el.resposta.textContent, e.currentTarget));
  $("copiarCurl").addEventListener("click", (e) => copiarTexto(comandoCurl(), e.currentTarget));
  el.sessao?.addEventListener("change", atualizarAvisos);

  document.querySelectorAll(".tester-tabs [data-aba]").forEach((aba) => {
    aba.addEventListener("click", () => {
      document.querySelectorAll(".tester-tabs [data-aba]").forEach((a) => a.classList.toggle("active", a === aba));
      document.querySelectorAll("[data-painel]").forEach((p) => (p.hidden = p.dataset.painel !== aba.dataset.aba));
    });
  });

  // Lembra o número de teste e a sessão escolhida
  try {
    el.numero.value = localStorage.getItem("apiTester.numero") || "";
    const sessaoSalva = localStorage.getItem("apiTester.sessao");
    if (el.sessao && sessaoSalva && [...el.sessao.options].some((o) => o.value === sessaoSalva)) el.sessao.value = sessaoSalva;
  } catch { /* localStorage indisponível */ }
  el.numero.addEventListener("input", () => { try { localStorage.setItem("apiTester.numero", el.numero.value); } catch { } });
  el.sessao?.addEventListener("change", () => { try { localStorage.setItem("apiTester.sessao", el.sessao.value); } catch { } });

  // ------------------------------------------------------------------ Início

  fetch("/manager/api-tester/collection.json", { credentials: "same-origin" })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((colecao) => {
      requisicoes = lerColecao(colecao.item);
      const doEndereco = decodeURIComponent(location.hash.slice(1));
      atual = requisicoes.find((r) => r.id === doEndereco) || null;
      desenharArvore();
      selecionar((atual || requisicoes.find((r) => r.caminho.startsWith("/session/status")) || requisicoes[0])?.id);
    })
    .catch((e) => {
      el.contagem.textContent = `Não foi possível carregar a coleção (${e.message}).`;
    });
})();
