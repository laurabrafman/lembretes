/* Pop-up de alarme — lógica da página.
   A página de cada aparência só precisa ter os elementos com estes ids:
   #card #data #hora #msg #det #mantra #tarefa #foot #pular #feito #feito-t #feito-p (e, opcional, #personagem). */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = () => window.pywebview.api;
const ico = (n) => (window.icone ? window.icone(n) : '');

let D = null;
// "igualzinho", mas sem ligar para maiúsculas, acentos e espaços repetidos
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const igual = (a, b) => a.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() === b.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const bloquearColar = (el) => { el.addEventListener('paste', e => e.preventDefault()); el.addEventListener('drop', e => e.preventDefault()); };
const tremer = (el) => { el.classList.remove('treme'); void el.offsetWidth; el.classList.add('treme'); };

function personagem(estado) {
  const p = $('#personagem');
  if (p) p.dataset.estado = estado;
}

function rodape(rotuloPrincipal) {
  const l = D.lembrete;
  $('#foot').innerHTML =
    (l.adiar ? `<button class="b b-ghost" id="b-adiar">${ico('pausa')}Adiar</button>` : '') +
    (rotuloPrincipal ? `<button class="b b-main" id="b-ok">${ico('check')}${esc(rotuloPrincipal)}</button>` : '');
  if (l.adiar) $('#b-adiar').onclick = escolherAdiar;
  if (rotuloPrincipal) $('#b-ok').onclick = () => concluir();
}

function escolherAdiar() {
  const atual = $('#foot').innerHTML;
  $('#foot').innerHTML = `<div class="adiar-opcoes"><span class="adiar-t">Adiar por</span>
    ${[5, 10, 30].map(m => `<button class="b b-ghost" data-min="${m}">${m} min</button>`).join('')}
    <button class="b b-link" id="adiar-volta">voltar</button></div>`;
  document.querySelectorAll('[data-min]').forEach(b => b.onclick = () => api().adiar(+b.dataset.min));
  $('#adiar-volta').onclick = () => {
    $('#foot').innerHTML = atual;
    if ($('#b-adiar')) $('#b-adiar').onclick = escolherAdiar;
    if ($('#b-ok')) $('#b-ok').onclick = D.lembrete.tarefa.tipo === 'pergunta' ? () => concluir($('#r').value.trim()) : () => concluir();
  };
}

/* ---------- tarefas ---------- */
function gerarConta(dif) {
  const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  if (dif === 'facil') { const a = r(2, 20), b = r(2, 20); return [`${a} + ${b}`, a + b]; }
  if (dif === 'medio') { const a = r(3, 9), b = r(3, 12), c = r(2, 30); return [`${a} × ${b} + ${c}`, a * b + c]; }
  const a = r(12, 25), b = r(4, 12), c = r(10, 99); return [`${a} × ${b} − ${c}`, a * b - c];
}

function tarefaConta(t) {
  const total = Math.max(1, t.quantidade);
  let feitas = 0, resp = 0;
  $('#tarefa').innerHTML = `<div class="hint">Resolva para desligar</div>
    <div class="dots">${'<i></i>'.repeat(total)}</div>
    <div class="expr num" id="expr"></div>
    <input class="inp num" id="r" inputmode="numeric" autocomplete="off" placeholder="?" aria-label="Resposta">
    <div class="aviso" id="av">Digite a resposta e aperte Enter</div>`;
  const nova = () => {
    const [txt, v] = gerarConta(t.dificuldade); resp = v;
    $('#expr').textContent = txt + ' = ?';
    document.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < feitas));
    $('#r').value = '';
  };
  $('#r').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    if (parseInt($('#r').value.trim(), 10) === resp) {
      feitas++;
      if (feitas >= total) { document.querySelectorAll('.dots i').forEach(d => d.classList.add('on')); concluir(); }
      else { nova(); $('#av').className = 'aviso'; $('#av').textContent = 'Isso! Próxima…'; }
    } else {
      $('#av').className = 'aviso erro'; $('#av').textContent = 'Não é isso — tenta de novo';
      tremer($('#r')); $('#r').value = '';
    }
  };
  nova();
  setTimeout(() => $('#r').focus(), 200);
}

function tarefaFrase(t, texto) {
  const frase = texto.replace(/\s+/g, ' ').trim();
  $('#tarefa').innerHTML = `<div class="hint">${t.frase_fonte === 'mantra' ? 'Copie o mantra' : 'Digite a frase abaixo'}</div>
    <div class="frase" id="fr">${[...frase].map(c => `<span>${esc(c)}</span>`).join('')}</div>
    <input class="inp" id="r" autocomplete="off" spellcheck="false" aria-label="Digite aqui">
    <div class="aviso" id="av">Maiúsculas e acentos não importam. Colar não vale.</div>`;
  const spans = [...document.querySelectorAll('#fr span')];
  bloquearColar($('#r'));
  $('#r').oninput = () => {
    const dig = $('#r').value.replace(/\s+/g, ' ');
    let erro = false;
    spans.forEach((s, i) => {
      s.className = i < dig.length ? (igual(dig[i], frase[i]) ? 'ok' : (erro = true, 'no')) : '';
      if (i === dig.length) s.classList.add('cur');
    });
    $('#av').className = 'aviso' + (erro ? ' erro' : '');
    $('#av').textContent = erro ? 'Tem uma letrinha diferente…' : `${Math.min(dig.length, frase.length)} de ${frase.length}`;
    if (norm(dig) === norm(frase)) concluir();
  };
  setTimeout(() => $('#r').focus(), 200);
}

function tarefaPergunta(t) {
  const min = Math.max(1, t.min_palavras);
  $('#tarefa').innerHTML = `<div class="hint">Pare e reflita</div>
    <div class="pergunta">${esc(D.pergunta)}</div>
    <textarea class="inp" id="r" placeholder="Escreva com sinceridade…" aria-label="Sua resposta"></textarea>
    <div class="contador"><span class="barra"><i id="bar"></i></span><span id="cnt" class="num">0/${min} palavras</span></div>`;
  bloquearColar($('#r'));
  const conta = () => $('#r').value.trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  rodape('Responder');
  $('#b-ok').disabled = true;
  $('#b-ok').onclick = () => concluir($('#r').value.trim());
  $('#r').oninput = () => {
    const n = conta();
    $('#cnt').textContent = `${n}/${min} palavras`;
    $('#bar').style.width = Math.min(100, n / min * 100) + '%';
    $('#b-ok').disabled = n < min;
  };
  $('#r').onkeydown = (e) => { if (e.key === 'Enter' && e.metaKey && !$('#b-ok').disabled) $('#b-ok').click(); };
  setTimeout(() => $('#r').focus(), 200);
}

function tarefaSegurar(t) {
  const ms = Math.max(1, t.segundos) * 1000, C = 427;
  $('#tarefa').innerHTML = `<div class="hint">Segure até completar o círculo</div>
    <div class="anel">
      <svg viewBox="0 0 150 150" aria-hidden="true"><circle class="fundo" cx="75" cy="75" r="68"/><circle class="prog" id="prog" cx="75" cy="75" r="68"/></svg>
      <button class="segura" id="seg">Segure<small>${t.segundos} segundos</small></button>
    </div>`;
  let ini = null, raf = null;
  const prog = $('#prog'), btn = $('#seg');
  const passo = (agora) => {
    const p = Math.min(1, (agora - ini) / ms);
    prog.style.strokeDashoffset = C * (1 - p);
    if (p >= 1) { concluir(); return; }
    raf = requestAnimationFrame(passo);
  };
  const soltar = () => {
    if (!ini) return;
    ini = null; cancelAnimationFrame(raf); btn.classList.remove('on');
    prog.style.transition = 'stroke-dashoffset .35s'; prog.style.strokeDashoffset = C;
  };
  const apertar = () => { prog.style.transition = 'none'; ini = performance.now(); btn.classList.add('on'); raf = requestAnimationFrame(passo); };
  btn.onmousedown = apertar; btn.onmouseup = soltar; btn.onmouseleave = soltar;
  btn.onkeydown = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !ini) { e.preventDefault(); apertar(); } };
  btn.onkeyup = soltar;
}

/* ---------- ciclo ---------- */
let concluido = false;
async function concluir(resposta) {
  if (concluido) return;
  concluido = true;
  personagem('sorrindo');
  $('#feito-t').textContent = resposta ? 'Valeu por refletir' : 'Mandou bem!';
  $('#feito-p').textContent = resposta ? 'Sua resposta foi guardada no Diário.' : 'Alarme desligado.';
  $('#feito').classList.add('on');
  await api().concluir(resposta || null);
}

async function pular() {
  if (concluido) return;
  concluido = true;
  await api().pular();
}

var iniciar = async function () {
  D = await api().dados();
  concluido = false;
  personagem('parada');
  const l = D.lembrete, t = l.tarefa;
  const mantraNaTarefa = t.tipo === 'frase' && t.frase_fonte === 'mantra';
  $('#card').classList.remove('silencio');
  $('#feito').classList.remove('on');
  $('#hora').textContent = D.hora;
  $('#data').textContent = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  // lembrete de mantra cujo título é o próprio mantra: mostra um título gentil no lugar
  const tituloEhMantra = D.mantra && l.mensagem.trim() === D.mantra.trim();
  $('#msg').textContent = tituloEhMantra ? 'Você recebeu um mantra.' : (l.mensagem || 'Lembrete');
  $('#det').textContent = l.detalhes || '';
  $('#det').style.display = l.detalhes ? '' : 'none';
  $('#mantra').textContent = D.mantra && !mantraNaTarefa ? D.mantra : '';
  $('#mantra').style.display = D.mantra && !mantraNaTarefa ? '' : 'none';
  $('#pular').onclick = pular;
  $('#tarefa').innerHTML = '';
  if (t.tipo === 'pergunta') return tarefaPergunta(t);
  rodape(t.tipo === 'nenhuma' ? (D.mantra ? 'Li' : 'Desligar') : null);
  if (t.tipo === 'conta') tarefaConta(t);
  else if (t.tipo === 'frase') tarefaFrase(t, mantraNaTarefa && D.mantra ? D.mantra : t.frase);
  else if (t.tipo === 'segurar') tarefaSegurar(t);
  else setTimeout(() => $('#b-ok') && $('#b-ok').focus(), 200);
}
// janela do tamanho do conteúdo: mede o cartão e pede essa altura ao Python
function ajustarAltura() {
  const c = $('#card'), cs = getComputedStyle(document.body);
  const prev = c.style.height;
  c.style.height = 'auto';
  const h = Math.ceil(c.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
  c.style.height = prev;
  api().ajustar_altura(h);
}
const _iniciar = iniciar;
iniciar = async function () {
  await _iniciar();
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  setTimeout(ajustarAltura, 60);   // (janela ainda escondida: nada de requestAnimationFrame, que não roda nela)
};
window.reiniciar = () => iniciar();
window.silenciou = () => $('#card').classList.add('silencio');
window.addEventListener('pywebviewready', () => iniciar());
document.addEventListener('keydown', (e) => { if (e.metaKey && (e.key === 'w' || e.key === 'q')) e.preventDefault(); });
