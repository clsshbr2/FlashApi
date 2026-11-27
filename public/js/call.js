/**
 * Painel de chamadas ao vivo: o atendente liga ou atende e fala pelo microfone do navegador.
 * Conversa com a API pelo WebSocket /ws/call (autenticado pelo login do painel):
 *  - texto JSON para comandos e estados;
 *  - binário com PCM Int16 16 kHz mono nos dois sentidos.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    sessao: $("sessao"), ponto: $("conexaoPonto"), conexao: $("conexaoTexto"),
    recebendo: $("recebendo"), recebendoDe: $("recebendoDe"), atender: $("atender"), recusar: $("recusar"),
    form: $("formLigar"), numero: $("numero"), ligar: $("ligar"),
    emChamada: $("emChamada"), com: $("chamadaCom"), estado: $("chamadaEstado"), tempo: $("chamadaTempo"),
    nivel: $("nivelMic"), mudo: $("mudo"), desligar: $("desligar"), mensagem: $("mensagem"),
  };

  const ESTADOS = {
    initiating: "Iniciando…", ringing: "Chamando…", connecting: "Conectando…",
    active: "Em chamada", on_hold: "Em espera", ended: "Encerrada", incoming_ringing: "Tocando…",
  };
  const MOTIVOS = {
    user_ended: "Ligação encerrada", declined: "O contato recusou", timeout: "Ninguém atendeu",
    busy: "Ocupado", cancelled: "Cancelada", failed: "A ligação falhou", relay_lost: "A conexão caiu",
    setup_failed: "Não foi possível conectar", accepted_elsewhere: "Atendida em outro aparelho",
  };

  let ws = null;
  let reconectar = null;
  let audio = null; // { contexto, microfone, captura, reproducao }
  let chamada = null; // resumo da chamada em andamento
  let recebida = null; // ligação tocando à espera de atender
  let cronometro = null;
  let mudo = false;

  if (!window.isSecureContext) $("avisoHttps").hidden = false;

  // ------------------------------------------------------------------ Mensagens

  function mostrar(texto, erro = false) {
    el.mensagem.textContent = texto || "";
    el.mensagem.classList.toggle("erro", erro);
  }

  const numeroDe = (jid) => (jid || "").split("@")[0].split(":")[0];

  // ------------------------------------------------------------------ WebSocket

  function conectar() {
    clearTimeout(reconectar);
    const url = new URL("/ws/call", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    if (el.sessao) url.searchParams.set("sessao", el.sessao.value);
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    estadoConexao("Conectando…");

    ws.onopen = () => estadoConexao("Conectado", "ok");
    ws.onclose = (e) => {
      estadoConexao(e.reason ? `Desconectado: ${e.reason}` : "Desconectado — tentando de novo…", "erro");
      encerrarLocal();
      // 1008 = sem permissão/sessão indisponível: não insiste
      if (e.code !== 1008) reconectar = setTimeout(conectar, 3000);
    };
    ws.onmessage = ({ data }) => {
      if (data instanceof ArrayBuffer) return tocar(data);
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      tratar(msg);
    };
  }

  function estadoConexao(texto, tipo = "") {
    el.conexao.textContent = texto;
    el.ponto.className = "call-dot " + tipo;
  }

  const enviar = (dados) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(dados));

  function tratar(msg) {
    switch (msg.type) {
      case "pronto": {
        const tocando = (msg.chamadas || []).find((c) => c.direction === "incoming" && c.state === "incoming_ringing");
        if (tocando) mostrarRecebida(tocando);
        break;
      }
      case "recebendo":
        if (!chamada) mostrarRecebida(msg.call);
        break;
      case "recebida-encerrada":
        if (recebida?.callId === msg.call?.callId) {
          esconderRecebida();
          if (!chamada) mostrar("A ligação recebida foi encerrada antes de ser atendida.");
        }
        break;
      case "estado":
        atualizarChamada(msg.call);
        break;
      case "erro":
        mostrar(msg.mensagem, true);
        if (chamada && chamada.state !== "active") encerrarLocal();
        break;
    }
  }

  // ------------------------------------------------------------------ Áudio

  async function iniciarAudio() {
    if (audio) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não libera o microfone nesta página (use HTTPS).");
    const microfone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const contexto = new AudioContext({ latencyHint: "interactive" });
    await contexto.audioWorklet.addModule("/js/call-audio-worklet.js");

    const captura = new AudioWorkletNode(contexto, "captura-chamada");
    captura.port.onmessage = ({ data }) => {
      el.nivel.style.width = `${Math.min(100, Math.round(data.nivel * 140))}%`;
      if (mudo || chamada?.state !== "active" || ws?.readyState !== WebSocket.OPEN) return;
      ws.send(paraInt16(data.pcm));
    };
    contexto.createMediaStreamSource(microfone).connect(captura);

    const reproducao = new AudioWorkletNode(contexto, "reproducao-chamada", { outputChannelCount: [2] });
    reproducao.connect(contexto.destination);

    audio = { contexto, microfone, captura, reproducao };
  }

  function pararAudio() {
    if (!audio) return;
    audio.microfone.getTracks().forEach((t) => t.stop());
    audio.contexto.close();
    audio = null;
    el.nivel.style.width = "0";
  }

  function paraInt16(f32) {
    const saida = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const v = Math.max(-1, Math.min(1, f32[i]));
      saida[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    return saida.buffer;
  }

  function tocar(buffer) {
    if (!audio) return;
    const amostras = new Int16Array(buffer);
    const f32 = new Float32Array(amostras.length);
    for (let i = 0; i < amostras.length; i++) f32[i] = amostras[i] / 0x8000;
    audio.reproducao.port.postMessage(f32, [f32.buffer]);
  }

  // ------------------------------------------------------------------ Chamada

  function mostrarRecebida(call) {
    recebida = call;
    el.recebendoDe.textContent = numeroDe(call.peerJid);
    el.recebendo.hidden = false;
    document.title = "📞 Ligação recebida | Flash API";
  }

  function esconderRecebida() {
    recebida = null;
    el.recebendo.hidden = true;
    document.title = "Chamadas | Flash API";
  }

  function atualizarChamada(call) {
    if (!call) return;
    // ignora outra chamada; a ligação que o painel acabou de pedir ainda não tem callId
    if (chamada?.callId && call.callId !== chamada.callId) return;
    chamada = call;
    el.form.hidden = true;
    el.emChamada.hidden = false;
    el.com.textContent = numeroDe(call.peerJid);
    el.estado.textContent = ESTADOS[call.state] || call.state;

    if (call.state === "active" && !cronometro) {
      const inicio = call.connectedAt ? new Date(call.connectedAt).getTime() : Date.now();
      const passo = () => {
        const s = Math.max(0, Math.floor((Date.now() - inicio) / 1000));
        el.tempo.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      };
      passo();
      cronometro = setInterval(passo, 1000);
      mostrar("");
    }
    if (call.state === "ended") {
      mostrar(MOTIVOS[call.endReason] || "Ligação encerrada", ["failed", "relay_lost", "setup_failed"].includes(call.endReason));
      encerrarLocal();
    }
  }

  function encerrarLocal() {
    chamada = null;
    clearInterval(cronometro);
    cronometro = null;
    el.tempo.textContent = "";
    el.emChamada.hidden = true;
    el.form.hidden = false;
    el.ligar.disabled = false;
    definirMudo(false);
    audio?.reproducao.port.postMessage("limpar");
    pararAudio();
  }

  function definirMudo(valor) {
    mudo = valor;
    el.mudo.setAttribute("aria-pressed", String(valor));
    el.mudo.innerHTML = valor ? '<i class="bi bi-mic-mute-fill me-1"></i> Mudo ativado' : '<i class="bi bi-mic-fill me-1"></i> Mudo';
  }

  // ------------------------------------------------------------------ Botões

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const numero = el.numero.value.replace(/[^\d@.a-z]/gi, "");
    if (!numero) return;
    el.ligar.disabled = true;
    mostrar("");
    try {
      await iniciarAudio(); // pede o microfone no clique (exigência do navegador)
      chamada = { callId: null, peerJid: numero, state: "initiating" };
      atualizarChamada(chamada);
      enviar({ type: "ligar", jid: numero });
      try { localStorage.setItem("chamadas.numero", numero); } catch { }
    } catch (erro) {
      mostrar(erro.name === "NotAllowedError" ? "Permita o uso do microfone para ligar." : erro.message, true);
      encerrarLocal();
    }
  });

  el.atender.addEventListener("click", async () => {
    if (!recebida) return;
    const alvo = recebida;
    try {
      await iniciarAudio();
      esconderRecebida();
      chamada = alvo;
      atualizarChamada({ ...alvo, state: "connecting" });
      enviar({ type: "atender", callId: alvo.callId });
    } catch (erro) {
      mostrar(erro.name === "NotAllowedError" ? "Permita o uso do microfone para atender." : erro.message, true);
    }
  });

  el.recusar.addEventListener("click", () => {
    if (!recebida) return;
    enviar({ type: "recusar", callId: recebida.callId });
    esconderRecebida();
  });

  el.desligar.addEventListener("click", () => {
    enviar({ type: "desligar" });
    if (!chamada?.callId) encerrarLocal(); // ainda nem começou a chamar
  });

  el.mudo.addEventListener("click", () => {
    definirMudo(!mudo);
    enviar({ type: "mudo", mudo });
  });

  el.sessao?.addEventListener("change", () => {
    try { localStorage.setItem("chamadas.sessao", el.sessao.value); } catch { }
    ws?.close();
  });

  try {
    el.numero.value = localStorage.getItem("chamadas.numero") || "";
    const salva = localStorage.getItem("chamadas.sessao");
    if (el.sessao && salva && [...el.sessao.options].some((o) => o.value === salva)) el.sessao.value = salva;
  } catch { /* sem localStorage */ }

  conectar();
})();
