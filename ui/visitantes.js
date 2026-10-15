/* Visitantes pixelados — só existem na aparência "Jardim em pixel".
   Os visitantes vêm de sprites/visitantes/visitantes.json: dá para criar novos sem mexer aqui. */
(() => {
  const PASTA = 'sprites/visitantes/';
  const FREQUENCIA = { rara: [10, 20], normal: [4, 10], frequente: [2, 5] };   // minutos entre visitas
  const MAX_POR_HORA = 6;
  const PAUSA_DIGITANDO_MS = 8000;
  // botões, campos e toggles. A área lisa de um cartão pode; os botões dele, não.
  const INTERATIVO = 'button, input, select, textarea, label, a, [role="button"], .switch, .seg, .stepper';
  const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let registro = [];
  let cfg = { ativo: !calmo, frequencia: 'normal' };
  let atual = null;
  let agendado = null;
  let ultimaTecla = 0;
  const visitas = [];   // horários das últimas visitas (limite por hora)

  const camada = document.createElement('div');
  camada.id = 'visitantes';
  camada.setAttribute('aria-hidden', 'true');
  document.body.appendChild(camada);
  document.addEventListener('keydown', () => { ultimaTecla = Date.now(); }, true);

  const sorteio = (a, b) => a + Math.random() * (b - a);
  const api = () => window.pywebview && window.pywebview.api;

  /* ---------- quando pode aparecer ---------- */
  function motivoParaNaoAparecer() {
    if (!cfg.ativo) return 'desligado';
    if (window.__naoPerturbe) return 'não perturbe';
    if (document.hidden || !document.hasFocus()) return 'janela fora de uso';
    if (document.querySelector('.overlay.on')) return 'painel aberto';
    if (Date.now() - ultimaTecla < PAUSA_DIGITANDO_MS) return 'digitando';
    const foco = document.activeElement;
    if (foco && /^(INPUT|TEXTAREA|SELECT)$/.test(foco.tagName)) return 'campo em foco';
    return null;
  }
  async function popupAberto() {
    try { return await api().popups_abertos(); } catch { return false; }
  }

  function agendar() {
    clearTimeout(agendado);
    if (!cfg.ativo) return;
    const [min, max] = FREQUENCIA[cfg.frequencia] || FREQUENCIA.normal;
    agendado = setTimeout(tentar, sorteio(min, max) * 60000);
  }

  async function tentar() {
    const agora = Date.now();
    while (visitas.length && agora - visitas[0] > 3600000) visitas.shift();
    if (atual) return agendar();
    if (visitas.length >= MAX_POR_HORA) { agendado = setTimeout(tentar, visitas[0] + 3600000 - agora + 1000); return; }
    if (motivoParaNaoAparecer() || await popupAberto()) { agendado = setTimeout(tentar, 30000); return; }
    const opcoes = registro.filter(v => v.ativo !== false && TRAJETOS[v.trajeto]);
    if (opcoes.length) chamar(opcoes[Math.floor(Math.random() * opcoes.length)]);
    agendar();
  }

  /* ---------- um visitante na tela ---------- */
  class Visita {
    constructor(def, opcoes = {}) {
      this.def = def;
      this.opcoes = opcoes;
      this.esc = Math.max(1, Math.round(def.escala || 3));
      this.w = def.tamanho[0] * this.esc;
      this.h = def.tamanho[1] * this.esc;
      this.el = document.createElement('img');
      this.el.className = 'visitante';
      this.el.alt = '';
      this.el.draggable = false;
      this.el.style.width = this.w + 'px';
      this.el.style.height = this.h + 'px';
      this.el.title = def.titulo || def.nome;
      this.el.addEventListener('click', () => this.reagir());
      camada.appendChild(this.el);
      // pré-carrega os quadros
      Object.values(def.quadros).flat().forEach(q => { const i = new Image(); i.src = PASTA + def.pasta + '/' + q; });
      this.x = 0; this.y = 0; this.dir = 1; this.vivo = true; this.fugindo = false;
    }
    animar(nome, fps = this.def.fps || 6, repetir = true) {
      clearInterval(this.relogio);
      this.estado = nome;
      const quadros = this.def.quadros[nome] || this.def.quadros.parado;
      let i = 0;
      const mostra = () => { this.el.src = PASTA + this.def.pasta + '/' + quadros[i]; };
      mostra();
      return new Promise(fim => {
        this.relogio = setInterval(() => {
          i++;
          if (i >= quadros.length) { if (!repetir) { clearInterval(this.relogio); return fim(); } i = 0; }
          mostra();
        }, 1000 / fps);
      });
    }
    posicionar() {
      // posições em múltiplos inteiros da escala: o pixel fica sempre nítido
      const x = Math.round(this.x / this.esc) * this.esc, y = Math.round(this.y / this.esc) * this.esc;
      this.el.style.transform = `translate(${x}px, ${y}px) scaleX(${this.dir})`;
    }
    andarAte(xFinal, velocidade) {
      // mesmo tipo de relógio dos quadros: se a janela ficar escondida, os dois pausam juntos
      return new Promise(fim => {
        let antes = performance.now();
        clearInterval(this.passos);
        const termina = () => { clearInterval(this.passos); fim(); };
        this.passos = setInterval(() => {
          if (!this.vivo) return termina();
          if (!this.fugindo && document.querySelector('.overlay.on')) { this.embora(); return termina(); }
          const agora = performance.now();
          const dt = Math.min(0.1, (agora - antes) / 1000); antes = agora;
          if (this.ocupado) return;           // fazendo um gesto: espera no lugar
          this.x += this.dir * velocidade * dt;
          if ((this.dir > 0 && this.x >= xFinal) || (this.dir < 0 && this.x <= xFinal)) { this.x = xFinal; this.posicionar(); return termina(); }
          this.posicionar();
        }, 1000 / 30);
      });
    }
    esperar(ms) {
      return new Promise(fim => {
        const t0 = performance.now();
        const vigia = setInterval(() => {
          if (!this.vivo || (!this.fugindo && document.querySelector('.overlay.on'))) { clearInterval(vigia); if (this.vivo && !this.fugindo) this.embora(); return fim(); }
          if (this.ocupado) return;            // o tempo de um gesto não conta
          if (performance.now() - t0 >= ms) { clearInterval(vigia); fim(); }
        }, 120);
      });
    }
    // Clique: um gestinho sorteado, ou (1 em 4) um balão com uma frase curta dos mantras. Sem som.
    async reagir() {
      if (this.ocupado || !this.vivo) return;
      if (Math.random() < (this.def.chance_frase ?? 0)) {
        const frase = await fraseCurta();
        if (frase) return this.falar(frase);
      }
      return this.gesto();
    }
    async gesto(def) {
      const gestos = this.def.gestos || [];
      const g = def || gestos[Math.floor(Math.random() * gestos.length)];
      if (!g || this.ocupado || !this.vivo) return;
      this.ocupado = true;
      const antes = this.estado;
      if (g.extra) this.soltar(g.extra);
      await this.animar(g.quadros, g.fps || this.def.fps || 6, false);
      this.ocupado = false;
      if (this.vivo) this.animar(antes === 'andando' ? 'andando' : 'parado', antes === 'andando' ? undefined : 1);
    }
    async falar(frase) {
      this.ocupado = true;
      const antes = this.estado;
      this.animar('parado', 1);
      const b = document.createElement('div');
      b.className = 'balao-visitante frase';
      b.textContent = frase;
      b.style.left = Math.max(140, Math.min(camada.clientWidth - 140, this.x + this.w / 2)) + 'px';
      b.style.top = (this.y - 10) + 'px';
      camada.appendChild(b);
      await new Promise(f => setTimeout(f, 2600 + frase.length * 45));
      b.remove();
      this.ocupado = false;
      if (this.vivo) this.animar(antes === 'andando' ? 'andando' : 'parado', antes === 'andando' ? undefined : 1);
    }
    soltar(extra) {
      const arq = (this.def.extras || {})[extra];
      if (!arq) return;
      const i = document.createElement('img');
      i.className = 'extra-visitante';
      i.src = PASTA + this.def.pasta + '/' + arq;
      i.style.width = 7 * this.esc + 'px';
      i.style.left = Math.round(this.x + (this.dir > 0 ? this.w * 0.72 : this.w * 0.1)) + 'px';
      i.style.top = Math.round(this.y - 4 * this.esc) + 'px';
      camada.appendChild(i);
      setTimeout(() => i.remove(), 1700);
    }
    limites() {
      return { min: 0, max: camada.clientWidth };   // coordenadas da camada (só a área de conteúdo)
    }
    embora() {
      if (!this.vivo) return;
      this.vivo = false;
      clearInterval(this.relogio); clearInterval(this.passos);
      this.el.remove();
      if (atual === this) atual = null;
    }
  }

  // Um lugar é livre se nada clicável estiver embaixo do visitante. (x, y na camada → coordenadas da página)
  function lugarLivre(x, y, w, h) {
    const r = camada.getBoundingClientRect();
    x += r.left; y += r.top;
    camada.style.display = 'none';
    try {
      for (let i = 0; i <= 3; i++) for (let j = 0; j <= 2; j++) {
        const px = Math.min(innerWidth - 1, Math.max(0, x + (w * i) / 3)), py = Math.min(innerHeight - 1, Math.max(0, y + (h * j) / 2));
        const el = document.elementFromPoint(px, py);
        if (el && el.closest(INTERATIVO)) return false;
      }
      return true;
    } finally { camada.style.display = ''; }
  }

  /* ---------- trajetos ---------- */
  const TRAJETOS = {
    // anda pela base da janela, às vezes para (onde não tem nada clicável), e sai pelo outro lado
    async andar_base(v) {
      const { min, max } = v.limites();
      v.dir = Math.random() < 0.5 ? 1 : -1;
      v.y = camada.clientHeight - v.h;
      v.x = v.dir > 0 ? min - v.w : max;
      const saida = v.dir > 0 ? max + 4 : min - v.w - 4;
      v.posicionar();
      v.animar('andando');
      const parada = v.def.parada || {};
      let pontoParada = null;
      if (v.opcoes.parar ?? Math.random() < (parada.chance ?? 0.8)) {
        for (let k = 0; k < 12 && pontoParada === null; k++) {
          const cand = min + (max - min - v.w) * sorteio(0.2, 0.8);
          if (lugarLivre(cand, v.y, v.w, v.h)) pontoParada = cand;
        }
      }
      if (pontoParada !== null) {
        if ((v.dir > 0 && pontoParada < v.x) || (v.dir < 0 && pontoParada > v.x)) pontoParada = null;
      }
      if (pontoParada !== null) {
        await v.andarAte(pontoParada, v.def.velocidade);
        if (!v.vivo || v.fugindo) return;
        v.animar('parado', 1);
        const [s0, s1] = parada.segundos || [4, 8];
        const fimParada = performance.now() + sorteio(s0, s1) * 1000;
        while (v.vivo && !v.fugindo && performance.now() < fimParada) {
          await v.esperar(sorteio(900, 1800));
          if (!v.vivo || v.fugindo) return;
          const acoes = parada.acoes || [];
          if ((v.def.gestos || []).length && Math.random() < 0.25) {
            await v.gesto();
          } else if (acoes.length && Math.random() < 0.7) {
            await v.animar(acoes[Math.floor(Math.random() * acoes.length)], v.def.fps || 6, false);
            v.animar('parado', 1);
          }
        }
        if (!v.vivo || v.fugindo) return;
        v.animar('andando');
      }
      await v.andarAte(saida, v.def.velocidade);
      if (!v.fugindo) v.embora();
    },
  };

  function chamar(def, opcoes) {
    if (atual) return null;
    const v = new Visita(def, opcoes);
    atual = v;
    visitas.push(Date.now());
    TRAJETOS[def.trajeto](v).catch(() => v.embora());
    return v;
  }

  /* ---------- usado pelo app ---------- */
  // chamarVisitante('gato') — para comemorar (ou testar). forcar ignora a agenda, mas não os bloqueios.
  // frases curtas sorteadas dos mantras (para o balão do gatinho)
  let frases = null;
  async function fraseCurta() {
    if (!frases) { try { frases = await api().frases_curtas(); } catch { frases = []; } }
    return frases.length ? frases[Math.floor(Math.random() * frases.length)] : null;
  }
  window.gestoVisitante = (i) => atual && atual.gesto(i != null ? atual.def.gestos[i] : undefined);
  window.falaVisitante = async () => atual && atual.falar(await fraseCurta());

  window.chamarVisitante = (nome, { forcar = false, parar } = {}) => {
    if (!forcar && motivoParaNaoAparecer()) return null;
    if (!cfg.ativo && !forcar) return null;
    const def = registro.find(v => v.nome === nome);
    return def && TRAJETOS[def.trajeto] ? chamar(def, { parar }) : null;
  };
  window.configurarVisitantes = (novo) => {
    cfg = { ativo: novo.ativo ?? !calmo, frequencia: novo.frequencia || 'normal' };
    if (!cfg.ativo && atual) atual.embora();
    agendar();
  };
  window.visitantesInfo = () => ({ cfg, atual: atual && atual.def.nome, estado: atual && atual.estado, x: atual && Math.round(atual.x),
    visitasNaUltimaHora: visitas.length, motivo: motivoParaNaoAparecer() });

  window.addEventListener('pywebviewready', async () => {
    try {
      const r = await fetch(PASTA + 'visitantes.json', { cache: 'no-store' });
      registro = (await r.json()).visitantes || [];
    } catch (e) { registro = []; }
    try { window.configurarVisitantes(await api().visitantes_cfg()); } catch { agendar(); }
  });
})();
