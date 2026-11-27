/**
 * AudioWorklet das chamadas ao vivo do painel.
 * A chamada usa PCM 16 kHz mono; o navegador roda na taxa dele (normalmente 48 kHz),
 * então a conversão de taxa é feita aqui (interpolação linear, suficiente para voz).
 *
 *  "captura-chamada":    microfone -> blocos de 960 amostras a 16 kHz (60 ms) -> port.postMessage
 *  "reproducao-chamada": port.onmessage (Float32 16 kHz) -> fila com folga contra oscilação da rede -> alto-falante
 */
const TAXA_CHAMADA = 16000;
const AMOSTRAS_POR_BLOCO = 960; // 60 ms

class CapturaChamada extends AudioWorkletProcessor {
  constructor() {
    super();
    this.passo = sampleRate / TAXA_CHAMADA; // amostras do navegador por amostra da chamada
    this.posicao = 0;
    this.anterior = 0;
    this.bloco = new Float32Array(AMOSTRAS_POR_BLOCO);
    this.preenchido = 0;
    this.nivel = 0;
  }

  process(entradas) {
    const canal = entradas[0]?.[0];
    if (!canal) return true;

    for (let i = 0; i < canal.length; i++) this.nivel = Math.max(this.nivel * 0.9995, Math.abs(canal[i]));

    // reamostra: percorre o bloco do navegador em passos de `passo`
    while (this.posicao < canal.length) {
      const i = Math.floor(this.posicao);
      const frac = this.posicao - i;
      const a = i === 0 ? this.anterior : canal[i - 1];
      const b = canal[i];
      this.bloco[this.preenchido++] = a + (b - a) * frac;
      if (this.preenchido === AMOSTRAS_POR_BLOCO) {
        this.port.postMessage({ pcm: this.bloco, nivel: this.nivel }, [this.bloco.buffer]);
        this.bloco = new Float32Array(AMOSTRAS_POR_BLOCO);
        this.preenchido = 0;
      }
      this.posicao += this.passo;
    }
    this.posicao -= canal.length;
    this.anterior = canal[canal.length - 1];
    return true;
  }
}

class ReproducaoChamada extends AudioWorkletProcessor {
  constructor() {
    super();
    this.passo = TAXA_CHAMADA / sampleRate; // amostras da chamada por amostra do navegador
    this.capacidade = TAXA_CHAMADA * 2; // 2 s de fila circular
    this.fila = new Float32Array(this.capacidade);
    this.leitura = 0; // posição fracionária
    this.escrita = 0;
    this.tamanho = 0;
    this.folgaInicial = TAXA_CHAMADA * 0.12; // espera 120 ms antes de tocar
    this.limite = TAXA_CHAMADA * 0.5; // acima de 500 ms de atraso, descarta o mais antigo
    this.tocando = false;

    this.port.onmessage = ({ data }) => {
      if (data === "limpar") {
        this.tamanho = 0;
        this.tocando = false;
        return;
      }
      for (let i = 0; i < data.length; i++) {
        this.fila[this.escrita] = data[i];
        this.escrita = (this.escrita + 1) % this.capacidade;
        if (this.tamanho < this.capacidade) this.tamanho++;
        else this.leitura = (this.leitura + 1) % this.capacidade;
      }
      if (this.tamanho > this.limite) {
        const descartar = this.tamanho - this.folgaInicial;
        this.leitura = (this.leitura + descartar) % this.capacidade;
        this.tamanho -= descartar;
      }
    };
  }

  process(_, saidas) {
    const saida = saidas[0][0];
    if (!this.tocando && this.tamanho >= this.folgaInicial) this.tocando = true;

    for (let i = 0; i < saida.length; i++) {
      if (!this.tocando || this.tamanho < 2) {
        saida[i] = 0;
        this.tocando = false; // acabou a fila: espera juntar folga de novo
        continue;
      }
      const base = Math.floor(this.leitura);
      const frac = this.leitura - base;
      const a = this.fila[base % this.capacidade];
      const b = this.fila[(base + 1) % this.capacidade];
      saida[i] = a + (b - a) * frac;
      const novo = this.leitura + this.passo;
      const avancou = Math.floor(novo) - base;
      this.tamanho -= avancou;
      this.leitura = novo % this.capacidade;
    }
    for (let c = 1; c < saidas[0].length; c++) saidas[0][c].set(saida);
    return true;
  }
}

registerProcessor("captura-chamada", CapturaChamada);
registerProcessor("reproducao-chamada", ReproducaoChamada);
