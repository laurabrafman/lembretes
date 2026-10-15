/* "Pausa" — um momento para respirar antes de agir por impulso.
   A página só precisa ter: #card #passo #fechar #habilidades (e a pele cuida do resto). */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => window.pywebview.api;
const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const INSPIRA = 4000, SOLTA = 7000, CICLO = INSPIRA + SOLTA; // ritmo 4-7
let D = null;
const R = { nota_antes: null, nota_depois: null, decisao: null, nota: '', completou_timer: false };

function mostrar(html) {
  $('#passo').innerHTML = html;
  $('#passo').classList.remove('entra'); void $('#passo').offsetWidth; $('#passo').classList.add('entra');
}

function slider(id, valor) {
  return `<div class="nota"><span class="nota-n num" id="${id}-n">${valor}</span><span class="nota-de">/10</span></div>
    <input type="range" min="0" max="10" step="1" value="${valor}" id="${id}" aria-label="Nota de 0 a 10">
    <div class="nota-escala"><span>0 · quase nada</span><span>10 · muito forte</span></div>`;
}
function ligarSlider(id, ao) {
  const el = $('#' + id);
  const pinta = () => { $('#' + id + '-n').textContent = el.value; el.style.setProperty('--p', el.value * 10 + '%'); ao(+el.value); };
  el.oninput = pinta; pinta();
  setTimeout(() => el.focus(), 100);
}

/* ---------- 1. nota antes ---------- */
function passoNota() {
  const abriu = D.origem === 'gatilho' && D.detalhe ? D.detalhe : '';
  mostrar(`<div class="eyebrow">${abriu ? 'Você abriu ' + esc(abriu) : 'Pausa'}</div>
    <h1>Tudo bem sentir isso.</h1>
    <p class="lead">Vamos com calma, um passo de cada vez. Você não precisa resolver nada agora.</p>
    <div class="bloco"><div class="rotulo">Quanto está o impulso agora?</div>${slider('r1', 5)}</div>
    <div class="acoes"><button class="b b-main" id="seg">Continuar</button></div>`);
  ligarSlider('r1', v => R.nota_antes = v);
  $('#seg').onclick = passoMantra;
}

/* ---------- 2. mantra ---------- */
function passoMantra() {
  mostrar(`<div class="eyebrow">Você recebeu um mantra.</div>
    <div class="mantra-grande" id="mantra">${esc(D.mantra)}</div>
    <div class="acoes"><button class="b-link" id="outro">outro mantra</button><span class="sp"></span><button class="b b-main" id="seg">Respirar comigo</button></div>`);
  $('#outro').onclick = async () => { D.mantra = await api().outro_mantra(); $('#mantra').textContent = D.mantra; };
  $('#seg').onclick = passoRespira;
  setTimeout(() => $('#seg').focus(), 100);
}

/* ---------- 3. respiração + timer + anotação ---------- */
let rafResp = null, fimTimer = 0, salvarRasc = null;
function passoRespira() {
  const total = D.timer_min * 60 * 1000;
  mostrar(`<div class="respira-topo">
      <div class="respira" aria-hidden="true"><div class="bolha" id="bolha"></div><div class="palco"><div class="sprite" id="personagem" data-estado="respirando" data-quadro="1"></div></div></div>
      <div class="respira-info">
        <div class="fase" id="fase" aria-live="polite">inspira</div>
        <div class="conta num" id="conta">4</div>
        <div class="timer"><span class="num" id="timer">${String(D.timer_min).padStart(2, '0')}:00</span> para o impulso passar</div>
      </div>
    </div>
    <div class="bloco">
      <label class="rotulo" for="rasc">Escreva o que está pensando</label>
      <textarea class="inp" id="rasc" placeholder="Colocar em palavras já ajuda a desacelerar."></textarea>
      <div class="nunca"><span>🔒 Fica só aqui no seu computador.</span><span id="salvo"></span></div>
    </div>
    <div class="acoes">
      <button class="b-link" id="hab">técnicas rápidas</button>
      <button class="b-link" id="pular">já estou melhor, ir para o fim</button>
      <span class="sp"></span>
      <button class="b b-main" id="seg" disabled>Seguir</button>
    </div>`);
  const inicio = performance.now();
  fimTimer = inicio + total;
  let acabou = false;
  const passo = (agora) => {
    const t = (agora - inicio) % CICLO;
    const inspirando = t < INSPIRA;
    const p = inspirando ? t / INSPIRA : (t - INSPIRA) / SOLTA;
    $('#fase').textContent = inspirando ? 'inspira' : 'solta';
    $('#conta').textContent = Math.ceil(inspirando ? (INSPIRA - t) / 1000 : (CICLO - t) / 1000);
    if (!calmo) {
      const escala = inspirando ? 0.55 + 0.45 * p : 1 - 0.45 * p;
      $('#bolha').style.transform = `scale(${escala.toFixed(3)})`;
      // quadros da personagem: 1 → 2 → 3 (cheia) inspirando; 3 → 4 → 1 soltando
      $('#personagem').dataset.quadro = inspirando ? (p < 1 / 3 ? 1 : p < 2 / 3 ? 2 : 3) : (p < 1 / 3 ? 3 : p < 2 / 3 ? 4 : 1);
    }
    const resta = Math.max(0, fimTimer - agora);
    $('#timer').textContent = `${String(Math.floor(resta / 60000)).padStart(2, '0')}:${String(Math.floor(resta / 1000) % 60).padStart(2, '0')}`;
    if (resta === 0 && !acabou) {
      acabou = true; R.completou_timer = true;
      $('#seg').disabled = false; $('#seg').classList.add('pronto');
      document.querySelector('.timer').innerHTML = '<b>Pronto.</b> Você atravessou.';
      api().tocar_fim();
    }
    rafResp = requestAnimationFrame(passo);
  };
  rafResp = requestAnimationFrame(passo);

  $('#rasc').value = R.nota;
  $('#rasc').oninput = () => {
    R.nota = $('#rasc').value;
    $('#salvo').textContent = '';
    clearTimeout(salvarRasc);
    salvarRasc = setTimeout(async () => { await api().salvar_nota(R.nota); $('#salvo').textContent = 'guardado ✓'; }, 600);
  };
  $('#hab').onclick = abrirHabilidades;
  const seguir = () => { cancelAnimationFrame(rafResp); clearTimeout(salvarRasc); api().salvar_nota(R.nota); passoFinal(); };
  $('#pular').onclick = seguir;
  $('#seg').onclick = seguir;
  setTimeout(() => $('#rasc').focus(), 150);
}

/* ---------- 4. nota depois + decisão ---------- */
function passoFinal() {
  mostrar(`<div class="eyebrow">Quase lá</div>
    <h1>E agora?</h1>
    <div class="bloco"><div class="rotulo">Quanto está o impulso agora?</div>${slider('r2', R.nota_antes ?? 5)}</div>
    <div class="bloco"><div class="rotulo">O que você decide?</div>
      <div class="decisoes">
        <button class="b b-main" data-d="nao">Passou, vou deixar pra lá</button>
        <button class="b" data-d="amanha">Vou pensar com calma amanhã</button>
        <button class="b" data-d="sim">Vou seguir em frente</button>
      </div>
      <p class="nota-rodape">Os botões só anotam no seu diário.</p>
    </div>`);
  ligarSlider('r2', v => R.nota_depois = v);
  document.querySelectorAll('[data-d]').forEach(b => b.onclick = () => decidir(b.dataset.d));
}

const FINAIS = {
  nao: ['Que bom.', 'Você cuidou de si agora. Isso conta muito.'],
  amanha: ['Combinado.', 'Amanhã você decide com mais calma.'],
  sim: ['Tudo bem.', 'A decisão é sua. Só respira antes.'],
};
const DECISOES = { nao: 'passou', amanha: 'pensar amanhã', sim: 'seguiu em frente' };
async function decidir(d) {
  R.decisao = DECISOES[d];
  const [t, p] = FINAIS[d];
  mostrar(`<div class="final"><div class="palco"><div class="sprite" data-estado="sorrindo"></div></div>
    <h1>${t}</h1><p class="lead">${p}</p>
    <p class="nota-rodape">Anotado no seu diário: impulso ${R.nota_antes} → ${R.nota_depois}.</p></div>`);
  $('#fechar').style.visibility = 'hidden';
  await api().concluir(R);
}

/* ---------- cartões de habilidades ---------- */
function abrirHabilidades() {
  const h = $('#habilidades');
  h.innerHTML = `<div class="hab-janela"><div class="hab-topo"><b>Técnicas rápidas</b><button class="x" id="hab-x" aria-label="Fechar">×</button></div>
    <div class="hab-lista">${D.habilidades.map(c => `<div class="hab"><div class="hab-t">${esc(c.titulo)}</div><div class="hab-s">${esc(c.subtitulo)}</div>
      ${c.itens.map(([a, b]) => `<div class="hab-i"><b>${esc(a)}</b><span>${esc(b)}</span></div>`).join('')}</div>`).join('')}</div></div>`;
  h.classList.add('on');
  $('#hab-x').onclick = () => h.classList.remove('on');
  $('#hab-x').focus();
}

/* ---------- início ---------- */
window.addEventListener('pywebviewready', async () => {
  D = await api().dados();
  $('#fechar').onclick = () => { cancelAnimationFrame(rafResp); api().fechar(R); };
  passoNota();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#habilidades').classList.contains('on')) $('#habilidades').classList.remove('on');
  if (e.metaKey && (e.key === 'w' || e.key === 'q')) e.preventDefault();
});
