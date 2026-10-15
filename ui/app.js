/* Lembretes — lógica das telas.
   Cada aparência traz só a própria pele: app.css (estilo) e icones.js (ícones).
   Assim as duas têm sempre a mesma estrutura, os mesmos fluxos e os mesmos textos. */

const TEMA = document.documentElement.dataset.tema || 'pixel';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (n) => window.icone(n);
const semExt = (n) => (n || '').replace(/\.[^.]+$/, '');
const api = () => window.pywebview.api;

const fmtMin = (m) => m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)}h${m % 60}` : `${m / 60}h`;
const aMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const deMin = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
function horariosDoDia(l) {
  if (!l.intervalo.ativo) return [...l.horas];
  const r = [], passo = Math.max(5, +l.intervalo.minutos), fim = Math.max(aMin(l.horas[0]), aMin(l.intervalo.ate));
  for (let t = aMin(l.horas[0]); t <= fim; t += passo) r.push(deMin(t));
  return r;
}

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const TAREFAS = [
  { id: 'nenhuma', nome: 'Nenhuma', desc: 'Só ler', ic: 'ler' },
  { id: 'conta', nome: 'Contas', desc: 'Resolver cálculos', ic: 'calc' },
  { id: 'frase', nome: 'Frase', desc: 'Digitar igualzinho', ic: 'texto' },
  { id: 'pergunta', nome: 'Pergunta', desc: 'Refletir e responder', ic: 'pergunta' },
  { id: 'segurar', nome: 'Segurar', desc: 'Manter pressionado', ic: 'mao' },
];
const ICONE_TAREFA = { 'Ler': 'ler', 'Contas': 'calc', 'Frase': 'texto', 'Copiar mantra': 'brilho', 'Pergunta': 'pergunta', 'Segurar': 'mao', 'Nota': 'nota' };
const ICONE_SOM = { 'Suave': 'sino', 'Música': 'musica', 'Silencioso': 'mudo' };

// navegação
const NAV = [
  { id: 'hoje', nome: 'Hoje', ic: 'sol' },
  { id: 'lembretes', nome: 'Lembretes', ic: 'sino' },
  { id: 'mantras', nome: 'Mantras', ic: 'brilho', fase: 3 },
  { id: 'perguntas', nome: 'Perguntas', ic: 'pergunta', fase: 3 },
  { id: 'diario', nome: 'Diário', ic: 'livro' },
  { id: 'jardim', nome: 'Jardim', ic: 'flor', fase: 3 },
  { id: 'anotacoes', nome: 'Anotações', ic: 'balao', fase: 3 },
  { id: 'rotina', nome: 'Rotina', ic: 'check', fase: 3 },
];

let S = { lembretes: [], hoje: [], musicas: [], perguntas: [], mantras: [] };
let E = null;          // lembrete sendo editado
let tocando = null;    // botão de "ouvir" ativo
let viewAtual = 'hoje';

/* ---------- esqueleto ---------- */
function montar() {
  // acrescenta (não substitui): a página pode trazer coisas próprias, como o filtro do modo escuro da pele pixel
  document.body.insertAdjacentHTML('afterbegin', `
  <div class="arrasta pywebview-drag-region"></div>
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">${icon('logo')}</div>
      <div><div class="brand-name">Lembretes</div><div class="brand-sub">seu dia, no ritmo certo</div></div>
    </div>
    <button class="botao-pausa" id="btn-pausa" title="⌥⌘V">${icon('coracao')}<span>Pausa</span></button>
    <nav id="nav">${NAV.map(n => `<button data-view="${n.id}">${icon(n.ic)}<span>${n.nome}</span><span class="count" id="c-${n.id}"></span></button>`).join('')}</nav>
    <div class="rodape">
      <button class="status" id="status"></button>
      <nav class="nav-baixo"><button data-view="ajustes" title="⌘,">${icon('engrenagem')}<span>Ajustes</span></button></nav>
    </div>
    <div class="menu-pausa" id="menu-pausa"></div>
  </aside>
  <main>
    <section class="view" id="v-hoje">
      <div class="head"><div><div class="eyebrow" id="hoje-data"></div><h1 id="saudacao"></h1></div>
        <button class="btn btn-primary" onclick="abrirEditor()">${icon('mais')}Novo lembrete</button></div>
      <div id="proximo"></div>
      <div class="group-title">Agenda de hoje</div>
      <div id="agenda"></div>
      <div class="group-title">Hábitos do dia</div>
      <div id="habitos"></div>
    </section>
    <section class="view" id="v-lembretes">
      <div class="head"><div><div class="eyebrow">Tudo o que está programado</div><h1>Lembretes</h1></div>
        <button class="btn btn-primary" onclick="abrirEditor()" title="⌘N">${icon('mais')}Novo lembrete</button></div>
      <div id="lista"></div>
    </section>
    <section class="view" id="v-diario">
      <div class="eyebrow">Suas reflexões</div><h1>Diário</h1>
      <p class="lead">Suas respostas, cada pausa feita e os pulos, sem julgamento.</p>
      <div id="diario"></div>
    </section>
    <section class="view" id="v-ajustes">
      <div class="eyebrow">Preferências</div><h1>Ajustes</h1>
      <p class="lead">Aparência, sons, dados e cópias de segurança.</p>
      <div id="ajustes"></div>
    </section>
    <section class="view" id="v-breve"><div id="breve"></div></section>
  </main>
  <div class="overlay" id="editor"></div>
  <div class="overlay" id="confirma"></div>
  <div class="overlay" id="aviso"></div>
  <div class="toast" id="toast"></div>`);

  $$('[data-view]').forEach(b => b.onclick = () => irPara(b.dataset.view));
  $('#btn-pausa').onclick = abrirPausa;
  $('#status').onclick = (e) => { e.stopPropagation(); menuPausa(); };
  document.addEventListener('click', () => $('#menu-pausa').classList.remove('on'));
  $('#editor').addEventListener('mousedown', (e) => { if (e.target.id === 'editor') fecharEditor(); });
}

function irPara(view) {
  viewAtual = view;
  const nav = NAV.find(n => n.id === view);
  $$('[data-view]').forEach(x => x.classList.toggle('on', x.dataset.view === view));
  const alvo = nav && nav.fase ? 'breve' : view;
  $$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + alvo));
  if (alvo === 'breve') renderBreve(nav);
  if (view === 'diario') carregarDiario();
  if (view === 'ajustes') renderAjustes();
  $('main').scrollTop = 0;
}

/* ---------- utilidades de interface ---------- */
function toast(msg, ic = 'check') {
  const t = $('#toast');
  t.innerHTML = icon(ic) + `<span>${esc(msg)}</span>`;
  t.classList.add('on');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('on'), 2400);
}

function janela(titulo, corpo) {
  // "janela retrô": barra de título com listras
  return `<div class="winbar"><span class="winbar-t">${esc(titulo)}</span></div>${corpo}`;
}

function confirmar(titulo, texto, botao = 'Excluir', perigo = true) {
  return new Promise(ok => {
    const c = $('#confirma');
    c.innerHTML = `<div class="mini">${janela(titulo, `<div class="mini-corpo"><h3>${esc(titulo)}</h3><p>${esc(texto)}</p>
      <div class="row fim"><button class="btn btn-ghost" id="cf-n">Cancelar</button><button class="btn ${perigo ? 'btn-danger' : 'btn-primary'}" id="cf-s">${esc(botao)}</button></div></div>`)}</div>`;
    c.classList.add('on');
    const fim = (v) => { c.classList.remove('on'); ok(v); };
    $('#cf-n').onclick = () => fim(false);
    $('#cf-s').onclick = () => fim(true);
    c.onclick = (e) => { if (e.target === c) fim(false); };
    setTimeout(() => $('#cf-s').focus(), 30);
  });
}

function avisar(titulo, texto) {
  const c = $('#aviso');
  c.innerHTML = `<div class="mini">${janela(titulo, `<div class="mini-corpo"><h3>${esc(titulo)}</h3><p>${texto}</p>
    <div class="row fim"><button class="btn btn-primary" id="av-ok">Ok</button></div></div>`)}</div>`;
  c.classList.add('on');
  const fim = () => c.classList.remove('on');
  $('#av-ok').onclick = fim;
  c.onclick = (e) => { if (e.target === c) fim(); };
  setTimeout(() => $('#av-ok').focus(), 30);
}

const emBreveTexto = (fase) => `Essa parte chega na <b>Fase ${fase}</b>. Está sendo preparada com carinho.`;

async function abrirPausa() {
  const abriu = await api().abrir_pausa();
  if (!abriu) toast('A Pausa já está aberta', 'coracao');
}

function renderBreve(nav) {
  $('#breve').innerHTML = `<div class="eyebrow">Em breve</div><h1>${esc(nav.nome)}</h1>
    <div class="empty">${icon(nav.ic)}<div class="big">Em breve</div><div>${emBreveTexto(nav.fase)}</div></div>`;
}

/* ---------- pausa ---------- */
function menuPausa() {
  const m = $('#menu-pausa');
  if (m.classList.contains('on')) { m.classList.remove('on'); return; }
  m.innerHTML = !S.servico
    ? `<button onclick="ligarServico()">${icon('play')}Ligar os alarmes</button>`
    : S.nao_perturbe.ativo
      ? `<button onclick="naoPerturbe('desligar')">${icon('sino')}Desligar o não perturbe</button>`
      : `<div class="menu-t">Não perturbe</div>
         <button onclick="naoPerturbe('30')">${icon('lua')}Por 30 min</button>
         <button onclick="naoPerturbe('60')">${icon('lua')}Por 1 hora</button>
         <button onclick="naoPerturbe('120')">${icon('lua')}Por 2 horas</button>
         <button onclick="naoPerturbe('indefinido')">${icon('lua')}Até eu desligar</button>
         <button onclick="naoPerturbe('amanha')">${icon('lua')}Até amanhã</button>`;
  m.classList.add('on');
}
async function naoPerturbe(como) {
  S = await api().nao_perturbe(como); render();
  toast(como === 'desligar' ? 'Não perturbe desligado' : 'Não perturbe ligado — os lembretes esperam na fila', como === 'desligar' ? 'sino' : 'lua');
}
async function ligarServico() { await api().ligar_servico(); setTimeout(recarregar, 1200); }

/* ---------- dados ---------- */
async function recarregar() {
  S = await api().estado();
  render();
}

function emQuanto(iso) {
  const min = Math.round((new Date(iso) - new Date()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `em ${h}h${m ? ' ' + m + 'min' : ''}`;
  const d = Math.round(h / 24);
  return d === 1 ? 'amanhã' : `em ${d} dias`;
}

function render() {
  const agora = new Date(), h = agora.getHours();
  $('#hoje-data').textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#saudacao').innerHTML = h < 5 ? 'Boa <em>madrugada</em>' : h < 12 ? 'Bom <em>dia</em>' : h < 18 ? 'Boa <em>tarde</em>' : 'Boa <em>noite</em>';
  $('#c-lembretes').textContent = S.lembretes.length || '';
  $('#c-diario').textContent = S.total_diario || '';

  // status / pausa
  const st = $('#status');
  const np = S.nao_perturbe;
  window.__naoPerturbe = !!np.ativo;   // os visitantes respeitam
  st.classList.toggle('off', !S.servico || np.ativo);
  st.classList.toggle('np', !!np.ativo);
  st.innerHTML = !S.servico
    ? `<span class="dot off"></span><span><b>Alarmes desligados</b><small>Clique para ligar</small></span>`
    : np.ativo
      ? `<span class="lua-np">${icon('lua')}</span><span><b>Não perturbe</b><small>${esc(np.texto)}</small></span>`
      : `<span class="dot"></span><span><b>Alarmes ligados</b><small>rodando em segundo plano</small></span>`;

  // próximo
  const prox = S.lembretes.filter(l => l.proxima).sort((a, b) => a.proxima.localeCompare(b.proxima))[0];
  $('#proximo').innerHTML = prox
    ? `<div class="next">${janela('Próximo', `<div class="next-corpo"><div><div class="cap">Próximo</div><div class="t num">${prox.proxima.slice(11, 16)}</div></div>
         <div class="next-info"><div class="cap">${esc(new Date(prox.proxima).toLocaleDateString('pt-BR', { weekday: 'long' }))}</div><div class="msg">${esc(prox.mensagem)}</div></div>
         <div class="em">${emQuanto(prox.proxima)}</div></div>`)}</div>`
    : `<div class="next vazio">${janela('Próximo', '<div class="next-corpo">Nenhum lembrete programado.</div>')}</div>`;

  // hoje: agenda (compromissos) separada dos hábitos do dia
  const linhaHoje = (o) => `<div class="item compacto ${o.passou ? 'passou' : ''}" onclick="abrirEditor('${o.id}')">
        <div class="hora num">${o.hora}</div>
        <div class="info"><div class="titulo">${esc(o.mensagem)}</div>
          <div class="meta">${o.passou ? `<span class="tag">${icon('check')}<span>já passou</span></span>` : ''}${chip(ICONE_SOM[o.som_txt], o.som_txt)}${chip(ICONE_TAREFA[o.tarefa_txt], o.tarefa_txt, true)}</div></div>
      </div>`;
  const agenda = S.hoje.filter(o => o.tipo === 'compromisso'), habitos = S.hoje.filter(o => o.tipo !== 'compromisso');
  $('#agenda').innerHTML = agenda.length
    ? `<div class="list">${agenda.map(linhaHoje).join('')}</div>`
    : `<div class="empty pequeno">Nenhum compromisso hoje. Para marcar um, crie um lembrete do tipo “Compromisso”.</div>`;
  $('#habitos').innerHTML = habitos.length
    ? `<div class="list">${habitos.map(linhaHoje).join('')}</div>`
    : `<div class="empty pequeno">Nenhum hábito para hoje.</div>`;

  // lista completa
  if (!S.lembretes.length) {
    $('#lista').innerHTML = `<div class="empty">${icon('sino')}<div class="big">Nenhum lembrete ainda</div><div>⌘N para criar.</div></div>`;
  } else {
    const ativos = S.lembretes.filter(l => l.ativo), pausados = S.lembretes.filter(l => !l.ativo);
    const grupo = (titulo, ls) => !ls.length ? '' : `<div class="group-title">${titulo}</div><div class="list">${ls.map(itemHTML).join('')}</div>`;
    $('#lista').innerHTML = grupo('Compromissos', ativos.filter(l => l.tipo === 'compromisso'))
      + grupo('Hábitos', ativos.filter(l => l.tipo !== 'compromisso')) + grupo('Pausados', pausados);
  }
}

function fmtPausa(iso) {
  const d = new Date(iso), hoje = new Date();
  const hora = iso.slice(11, 16);
  return d.toDateString() === hoje.toDateString() ? hora : `amanhã, ${hora}`;
}

const chip = (ic, txt, acc = false) => `<span class="tag ${acc ? 'acc' : ''}">${icon(ic)}<span>${esc(txt)}</span></span>`;

function itemHTML(l) {
  const extra = l.intervalo.ativo ? `até ${l.intervalo.ate}` : l.horas.length > 1 ? `+${l.horas.length - 1} horário${l.horas.length > 2 ? 's' : ''}` : '';
  const som = l.som === 'musica' ? (l.musica ? semExt(l.musica) : 'Música') : l.som_txt;
  return `<div class="item ${l.ativo ? '' : 'off'}" onclick="abrirEditor('${l.id}')">
    <div class="hora num">${l.horas[0]}${extra ? `<small>${extra}</small>` : ''}</div>
    <div class="info">
      <div class="titulo">${esc(l.mensagem)}</div>
      <div class="meta">${chip(l.repeticao === 'uma_vez' ? 'calendario' : 'repetir', l.quando_txt)}${chip(ICONE_SOM[l.som_txt], som)}${chip(ICONE_TAREFA[l.tarefa_txt], l.tarefa_txt, true)}</div>
    </div>
    <div class="acoes" onclick="event.stopPropagation()">
      <button class="icon-btn" title="Testar agora" onclick="api().testar(S.lembretes.find(x=>x.id==='${l.id}'))">${icon('sino')}</button>
      <button class="icon-btn" title="Duplicar" onclick="duplicar('${l.id}')">${icon('copiar')}</button>
      <button class="icon-btn danger" title="Excluir" onclick="excluir('${l.id}')">${icon('lixo')}</button>
    </div>
    <label class="switch" onclick="event.stopPropagation()" title="${l.ativo ? 'Pausar' : 'Ativar'}"><input type="checkbox" ${l.ativo ? 'checked' : ''} onchange="alternar('${l.id}')"><span></span></label>
  </div>`;
}

async function alternar(id) { S = await api().alternar(id); render(); }
async function excluir(id) {
  const l = S.lembretes.find(x => x.id === id);
  if (await confirmar('Excluir lembrete?', `“${l.mensagem}” vai sumir pra sempre.`)) {
    S = await api().excluir(id); render(); toast('Lembrete excluído', 'lixo'); return true;
  }
  return false;
}
function duplicar(id) {
  const c = structuredClone(S.lembretes.find(x => x.id === id));
  c.id = null; c.mensagem += ' (cópia)';
  abrirEditor(null, c);
}

/* ---------- editor ---------- */
async function abrirEditor(id, base) {
  E = structuredClone(base || (id ? S.lembretes.find(x => x.id === id) : await api().novo()));
  const novo = !id;
  const opMantras = `<option value="nenhum">Nenhum</option><option value="aleatorio">Um aleatório a cada vez</option>` +
    S.mantras.map(m => `<option value="fixo:${m.id}">${esc(m.texto)}</option>`).join('');
  $('#editor').innerHTML = `<div class="sheet">${janela(novo ? 'Novo lembrete' : 'Editar lembrete', `
    <div class="sheet-head">
      <input class="titulo-input" id="e-msg" placeholder="O que você quer lembrar?" value="${esc(E.mensagem)}">
      <input class="det-input" id="e-det" placeholder="Adicionar detalhes (opcional)" value="${esc(E.detalhes)}">
    </div>
    <div class="sheet-body">
      <div class="sec">
        <div class="sec-t">${icon('repetir')}Tipo</div>
        <div class="row"><div class="seg" id="e-tipo"><button data-v="habito">Hábito do dia</button><button data-v="compromisso">Compromisso da agenda</button></div></div>
        <div class="lbl" style="margin-top:10px" id="e-tipo-txt"></div>
      </div>
      <div class="sec">
        <div class="sec-t">${icon('relogio')}Quando</div>
        <div class="row" id="e-horas"></div>
        <div class="row"><div class="seg" id="e-rep">
          <button data-v="uma_vez">Uma vez</button><button data-v="todo_dia">Diário</button><button data-v="dias_uteis">Dias úteis</button><button data-v="dias_semana">Dias escolhidos</button>
        </div></div>
        <div class="row" id="e-quando-extra"></div>
        <div class="row">
          <label class="switch"><input type="checkbox" id="e-iv" ${E.intervalo.ativo ? 'checked' : ''}><span></span></label>
          <span>Repetir a cada</span>
          <span class="iv-cfg" id="e-iv-cfg">
            <select class="field" id="e-iv-min" style="width:120px">${[15, 20, 30, 45, 60, 90, 120, 180, 240].map(m =>
              `<option value="${m}" ${+E.intervalo.minutos === m ? 'selected' : ''}>${fmtMin(m)}</option>`).join('')}</select>
            <span class="lbl">até</span>
            <input type="time" class="field num" id="e-iv-ate" value="${E.intervalo.ate}" style="width:120px">
          </span>
        </div>
        <div class="lbl resumo" id="e-resumo"></div>
      </div>
      <div class="sec">
        <div class="sec-t">${icon('brilho')}Mantra</div>
        <select class="field" id="e-mantra">${opMantras}</select>
      </div>
      <div class="sec">
        <div class="sec-t">${icon('musica')}Som</div>
        <div class="row"><div class="seg" id="e-som"><button data-v="suave">Suave</button><button data-v="musica">Música</button><button data-v="silencioso">Silencioso</button></div>
          <button class="btn btn-soft" id="e-ouvir">${icon('play')}Ouvir</button></div>
        <div class="row" id="e-mus-row">
          <select class="field" id="e-mus" style="flex:1;min-width:220px"></select>
          <button class="btn btn-ghost" onclick="importar(true)">${icon('importar')}Importar</button>
        </div>
        <div class="row" id="e-vol-row"><div class="vol">${icon('volume')}<input type="range" min="5" max="100" id="e-vol" value="${E.volume}"><span class="num lbl" id="e-vol-n" style="width:40px">${E.volume}%</span></div></div>
      </div>
      <div class="sec">
        <div class="sec-t">${icon('cerebro')}Para desligar o alarme</div>
        <div class="tasks" id="e-tasks">${TAREFAS.map(t => `<button class="task" data-v="${t.id}"><div class="ic">${icon(t.ic)}</div><b>${t.nome}</b><small>${t.desc}</small></button>`).join('')}</div>
        <div class="task-cfg" id="e-task-cfg"></div>
        <div class="row" style="margin-top:16px">
          <label class="switch"><input type="checkbox" id="e-adiar" ${E.adiar ? 'checked' : ''}><span></span></label>
          <span>Permitir adiar por</span>
          <div class="seg" id="e-adiar-min"><button data-v="5">5 min</button><button data-v="10">10 min</button><button data-v="30">30 min</button></div>
        </div>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn btn-ghost" onclick="testarEditor()">${icon('sino')}Testar agora</button>
      <span class="erro" id="e-erro"></span>
      <span class="sp"></span>
      ${novo ? '' : `<button class="btn btn-ghost perigo" onclick="excluirDoEditor()">${icon('lixo')}Excluir</button>`}
      <button class="btn btn-ghost" onclick="fecharEditor()">Cancelar</button>
      <button class="btn btn-primary" onclick="salvarEditor()">${novo ? 'Criar lembrete' : 'Salvar'}</button>
    </div>`)}</div>`;
  $('#editor').classList.add('on');

  $('#e-msg').oninput = (e) => E.mensagem = e.target.value;
  $('#e-det').oninput = (e) => E.detalhes = e.target.value;
  let tipoTocado = !novo;
  const tipoTxt = () => $('#e-tipo-txt').textContent = E.tipo === 'compromisso'
    ? 'Aparece em “Agenda de hoje”. Bom para consultas, aulas, remédio com hora marcada.'
    : 'Aparece em “Hábitos do dia”. Bom para água, mantras, alongar, pausas.';
  segmentado('#e-tipo', () => E.tipo, (v) => { E.tipo = v; tipoTocado = true; tipoTxt(); });
  tipoTxt();
  segmentado('#e-rep', () => E.repeticao, (v) => {
    E.repeticao = v; quandoExtra();
    // enquanto você não escolheu o tipo, "uma vez" sugere compromisso
    if (!tipoTocado) { E.tipo = v === 'uma_vez' ? 'compromisso' : 'habito'; segmentado('#e-tipo', () => E.tipo, (x) => { E.tipo = x; tipoTocado = true; tipoTxt(); }); tipoTxt(); }
  });
  $('#e-iv').onchange = (e) => { E.intervalo.ativo = e.target.checked; pintarHoras(); };
  $('#e-iv-min').onchange = (e) => { E.intervalo.minutos = +e.target.value; resumo(); };
  $('#e-iv-ate').oninput = (e) => { if (/^\d\d:\d\d$/.test(e.target.value)) { E.intervalo.ate = e.target.value; resumo(); } };
  pintarHoras();
  quandoExtra();

  $('#e-mantra').value = E.mantra.modo === 'fixo' ? `fixo:${E.mantra.id}` : E.mantra.modo;
  $('#e-mantra').onchange = (e) => {
    const v = e.target.value;
    E.mantra = v.startsWith('fixo:') ? { modo: 'fixo', id: v.slice(5) } : { modo: v, id: '' };
    if (E.tarefa.tipo === 'frase') tarefaCfg();
  };

  segmentado('#e-som', () => E.som, (v) => { E.som = v; pararSom(); pintarSom(); });
  preencherMusicas();
  $('#e-mus').onchange = (e) => { E.musica = e.target.value; pararSom(); };
  const vol = $('#e-vol');
  const pintaVol = () => { vol.style.setProperty('--p', ((vol.value - 5) / 95 * 100) + '%'); $('#e-vol-n').textContent = vol.value + '%'; };
  vol.oninput = () => { E.volume = +vol.value; pintaVol(); };
  pintaVol();
  pintarSom();
  $('#e-ouvir').onclick = () => ouvir($('#e-ouvir'), E.som, E.musica, E.volume);

  $$('#e-tasks .task').forEach(b => b.onclick = () => { E.tarefa.tipo = b.dataset.v; tarefaCfg(); });
  tarefaCfg();
  $('#e-adiar').onchange = (e) => E.adiar = e.target.checked;
  segmentado('#e-adiar-min', () => String(E.adiar_minutos), (v) => E.adiar_minutos = +v);
  if (novo) setTimeout(() => $('#e-msg').focus(), 50);
}

function pintarHoras() {
  const box = $('#e-horas');
  const iv = E.intervalo.ativo;
  const horas = iv ? [E.horas[0]] : E.horas;
  box.innerHTML = (iv ? '<span class="lbl">Começa às</span>' : '') +
    horas.map((h, i) => `<span class="hora-chip"><input type="time" class="time-input num" data-i="${i}" value="${h}">${!iv && E.horas.length > 1 ? `<button class="x" data-rm="${i}" title="Tirar este horário">${icon('x')}</button>` : ''}</span>`).join('') +
    (iv ? '' : `<button class="btn btn-ghost" id="e-add-hora">${icon('mais')}Horário</button>`);
  box.querySelectorAll('input[type=time]').forEach(inp => inp.oninput = () => {
    if (/^\d\d:\d\d$/.test(inp.value)) { E.horas[+inp.dataset.i] = inp.value; resumo(); }
  });
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { E.horas.splice(+b.dataset.rm, 1); pintarHoras(); });
  const add = $('#e-add-hora');
  if (add) add.onclick = () => {
    const ultimo = aMin(E.horas[E.horas.length - 1]);
    E.horas.push(deMin(Math.min(23 * 60 + 59, ultimo + 120)));
    pintarHoras();
    const ins = box.querySelectorAll('input[type=time]'); ins[ins.length - 1].focus();
  };
  $('#e-iv-cfg').style.display = iv ? '' : 'none';
  resumo();
}

function resumo() {
  const hs = horariosDoDia(E);
  $('#e-resumo').textContent = E.intervalo.ativo
    ? (hs.length > 1 ? `Toca ${hs.length} vezes por dia: ${hs.slice(0, 7).join(' · ')}${hs.length > 7 ? ' …' : ''}` : 'Só cabe um horário — aumente o “até”.')
    : hs.length > 1 ? `Toca ${hs.length} vezes por dia.` : '';
}

function segmentado(sel, get, set) {
  const pinta = () => $$(sel + ' button').forEach(b => b.classList.toggle('on', b.dataset.v === get()));
  $$(sel + ' button').forEach(b => b.onclick = () => { set(b.dataset.v); pinta(); });
  pinta();
}

// stepper: data-k = caminho no objeto E (ex: "tarefa.quantidade")
function stepper(chave, min, max, sufixo = '') {
  const v = chave.split('.').reduce((o, k) => o[k], E);
  return `<span class="stepper" data-k="${chave}" data-min="${min}" data-max="${max}" data-suf="${sufixo}"><button>−</button><span class="num">${v}${sufixo}</span><button>+</button></span>`;
}
function ligarSteppers(raiz) {
  raiz.querySelectorAll('.stepper').forEach(st => {
    const [menos, val, mais] = st.children;
    const ks = st.dataset.k.split('.'), last = ks.pop();
    const alvo = () => ks.reduce((o, k) => o[k], E);
    const muda = (d) => {
      const o = alvo();
      o[last] = Math.min(+st.dataset.max, Math.max(+st.dataset.min, (+o[last] || 0) + d));
      val.textContent = o[last] + st.dataset.suf;
    };
    menos.onclick = () => muda(-1);
    mais.onclick = () => muda(1);
  });
}

function quandoExtra() {
  const box = $('#e-quando-extra');
  if (E.repeticao === 'uma_vez') {
    const hoje = new Date(), amanha = new Date(Date.now() + 864e5);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    box.innerHTML = `<input type="date" class="field" id="e-data" value="${E.data}" style="width:180px">
      <button class="link" data-d="${iso(hoje)}">Hoje</button><button class="link" data-d="${iso(amanha)}">Amanhã</button>`;
    $('#e-data').oninput = (e) => E.data = e.target.value;
    box.querySelectorAll('.link').forEach(b => b.onclick = () => { E.data = b.dataset.d; $('#e-data').value = E.data; });
  } else if (E.repeticao === 'dias_semana') {
    box.innerHTML = `<div class="days">${DIAS.map((d, i) => `<button data-d="${i}" title="${d}">${d[0]}</button>`).join('')}</div>
      <button class="link" data-p="5,6">Fim de semana</button>`;
    const pinta = () => box.querySelectorAll('.days button').forEach(b => b.classList.toggle('on', E.dias.includes(+b.dataset.d)));
    box.querySelectorAll('.days button').forEach(b => b.onclick = () => {
      const d = +b.dataset.d;
      E.dias = E.dias.includes(d) ? E.dias.filter(x => x !== d) : [...E.dias, d].sort();
      pinta();
    });
    box.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { E.dias = b.dataset.p.split(',').map(Number); pinta(); });
    pinta();
  } else {
    box.innerHTML = `<span class="lbl">${E.repeticao === 'dias_uteis' ? 'De segunda a sexta.' : 'Todos os dias.'}</span>`;
  }
}

function pintarSom() {
  $('#e-mus-row').style.display = E.som === 'musica' ? '' : 'none';
  $('#e-vol-row').style.display = E.som === 'silencioso' ? 'none' : '';
  $('#e-ouvir').style.display = E.som === 'silencioso' ? 'none' : '';
}

function tarefaCfg() {
  $$('#e-tasks .task').forEach(b => b.classList.toggle('on', b.dataset.v === E.tarefa.tipo));
  const t = E.tarefa, box = $('#e-task-cfg');
  if (t.tipo === 'conta') {
    box.innerHTML = `<div class="row"><span class="lbl">Quantas contas</span>${stepper('tarefa.quantidade', 1, 10)}
      <span class="lbl" style="margin-left:12px">Dificuldade</span>
      <div class="seg" id="e-dif"><button data-v="facil">Fácil</button><button data-v="medio">Médio</button><button data-v="dificil">Difícil</button></div></div>`;
    segmentado('#e-dif', () => t.dificuldade, (v) => t.dificuldade = v);
  } else if (t.tipo === 'frase') {
    const textoMantra = E.mantra.modo === 'fixo' ? (S.mantras.find(m => m.id === E.mantra.id) || {}).texto : null;
    box.innerHTML = `<div class="row"><div class="seg" id="e-fonte"><button data-v="livre">Frase livre</button><button data-v="mantra">Usar o mantra</button></div></div>
      <div id="e-fonte-cfg" style="margin-top:12px"></div>`;
    const pintaFonte = () => {
      $('#e-fonte-cfg').innerHTML = t.frase_fonte === 'mantra'
        ? `<div class="lbl">${textoMantra ? `Vai digitar: <b>“${esc(textoMantra)}”</b>` : 'Vai digitar um mantra sorteado a cada vez (escolha um mantra fixo acima, se preferir).'}</div>`
        : `<div class="lbl" style="margin-bottom:8px">Frase que você vai ter que digitar (maiúsculas e acentos não importam; colar não vale):</div>
           <input class="field" id="e-frase" value="${esc(t.frase)}" placeholder="Ex: Eu escolho cuidar de mim agora">`;
      const inp = $('#e-frase');
      if (inp) inp.oninput = (e) => t.frase = e.target.value;
    };
    segmentado('#e-fonte', () => t.frase_fonte, (v) => { t.frase_fonte = v; pintaFonte(); });
    pintaFonte();
  } else if (t.tipo === 'pergunta') {
    box.innerHTML = `<div class="lbl" style="margin-bottom:8px">Pergunta que você vai ter que responder:</div>
      <textarea class="field" id="e-perg" rows="2" placeholder="Deixe em branco para sortear uma das suas perguntas a cada vez">${esc(t.pergunta)}</textarea>
      <div class="chips">${S.perguntas.map(p => `<button class="chip">${esc(p)}</button>`).join('')}</div>
      <div class="row" style="margin-top:14px"><span class="lbl">Mínimo de palavras na resposta</span>${stepper('tarefa.min_palavras', 1, 100)}</div>`;
    $('#e-perg').oninput = (e) => t.pergunta = e.target.value;
    box.querySelectorAll('.chip').forEach(c => c.onclick = () => { t.pergunta = c.textContent; $('#e-perg').value = t.pergunta; });
  } else if (t.tipo === 'segurar') {
    box.innerHTML = `<div class="row"><span class="lbl">Segurar o botão por</span>${stepper('tarefa.segundos', 1, 60, 's')}</div>`;
  } else {
    box.innerHTML = `<div class="lbl">O pop-up mostra a mensagem${E.mantra.modo !== 'nenhum' ? ' e o mantra' : ''}, e um botão “Li”.</div>`;
  }
  ligarSteppers(box);
}

function preencherMusicas() {
  const sel = $('#e-mus');
  sel.innerHTML = `<option value="">Música padrão — ${esc(semExt(S.musica_padrao))}</option>` +
    S.musicas.map(m => `<option value="${esc(m)}">${esc(semExt(m))}</option>`).join('');
  sel.value = E.musica || '';
}

function validar() {
  if (!E.mensagem.trim()) return 'Dê um nome ao lembrete.';
  if (!E.horas.length || !E.horas.every(h => /^\d\d:\d\d$/.test(h))) return 'Escolha os horários.';
  if (E.repeticao === 'uma_vez' && !E.data) return 'Escolha a data.';
  if (E.repeticao === 'dias_semana' && !E.dias.length) return 'Marque pelo menos um dia.';
  if (E.intervalo.ativo && aMin(E.intervalo.ate) <= aMin(E.horas[0])) return 'O “até” precisa ser depois do horário inicial.';
  if (E.tarefa.tipo === 'frase' && E.tarefa.frase_fonte === 'livre' && !E.tarefa.frase.trim()) return 'Escreva a frase.';
  return '';
}

async function salvarEditor() {
  const erro = validar();
  $('#e-erro').textContent = erro;
  if (erro) return;
  if (E.repeticao === 'uma_vez' && E.horas.every(h => new Date(`${E.data}T${h}`) < new Date())
      && !await confirmar('Esse horário já passou', 'Ele não vai tocar. Salvar mesmo assim?', 'Salvar', false)) return;
  S = await api().salvar(E);
  fecharEditor();
  render();
  toast('Lembrete salvo');
}
async function excluirDoEditor() {
  if (await excluir(E.id)) fecharEditor();
}
function testarEditor() {
  const erro = validar();
  $('#e-erro').textContent = erro;
  if (!erro) { pararSom(); api().testar(E); }
}
function fecharEditor() { pararSom(); $('#editor').classList.remove('on'); E = null; }

/* ---------- som ---------- */
async function ouvir(btn, som, nome, volume) {
  if (tocando === btn) { pararSom(); return; }
  pararSom();
  if (!await api().ouvir(som, nome || '', volume)) { toast('Não achei esse som', 'musica'); return; }
  tocando = btn;
  btn.innerHTML = icon('stop') + (btn.dataset.curto ? '' : 'Parar');
  const vigia = setInterval(async () => {
    if (tocando !== btn || !(await api().tocando())) { clearInterval(vigia); if (tocando === btn) pararSom(); }
  }, 800);
}
function pararSom() {
  if (tocando) tocando.innerHTML = icon('play') + (tocando.dataset.curto ? '' : 'Ouvir');
  tocando = null;
  api().parar_som();
}

async function importar(noEditor) {
  const nome = await api().importar_musica();
  if (!nome) return;
  S = await api().estado();
  toast('Música importada', 'musica');
  if (noEditor && E) { E.musica = nome; E.som = 'musica'; preencherMusicas(); }
  if (viewAtual === 'ajustes') renderAjustes();
}

/* ---------- ajustes ---------- */
async function renderAjustes() {
  const b = await api().backups();
  const ultimo = b.ultimo ? b.ultimo.replace(/(\d+)-(\d+)-(\d+) (\d+)h(\d+)(m\d+s)?/, '$3/$2 às $4:$5') : null;
  $('#ajustes').innerHTML = `
    <div class="card">${janela('Música padrão', `<div class="card-corpo">
      <div class="row entre"><div><h3>Música padrão</h3><p>Toca nos lembretes com som “Música” que não têm uma música própria.</p></div>
        <button class="btn btn-soft" onclick="importar()">${icon('importar')}Importar música</button></div>
      <div class="songs" id="songs"></div></div>`)}</div>

    <div class="card">${janela('Sons', `<div class="card-corpo">
      <h3>Sons</h3><p>O som “Suave” é um sino baixinho que se repete com calma até a tarefa ser feita.</p>
      <div class="row" style="margin-top:14px"><button class="btn btn-soft" id="ouvir-suave">${icon('play')}Ouvir</button><span class="lbl">Som suave</span></div></div>`)}</div>

    <div class="card">${janela('Não perturbe', `<div class="card-corpo">
      <h3>Não perturbe</h3><p>Liga pelo status da lateral ou pelo ícone na barra de menus. Durante o modo nada abre nem toca; os lembretes ficam na fila e, quando acabar, aparece a lista para fazer agora ou pular.</p>
      <div class="row" style="margin-top:16px">
        <label class="switch"><input type="checkbox" id="aj-np-auto" ${S.nao_perturbe.cfg.auto.ativo ? 'checked' : ''}><span></span></label>
        <span>Ligar sozinho quando estes apps estiverem na frente:</span>
      </div>
      <input class="field" id="aj-np-apps" style="margin-top:10px" value="${esc(S.nao_perturbe.cfg.auto.apps.join(', '))}" placeholder="Steam, Zoom, nome do jogo…">
      <p class="lbl" style="margin-top:6px">Separe por vírgula. Vale parte do nome do app.</p>
      <div class="row" style="margin-top:14px">
        <label class="switch"><input type="checkbox" id="aj-np-exc" ${S.nao_perturbe.cfg.pausa_excecao ? 'checked' : ''}><span></span></label>
        <span>A Pausa aberta por um gatilho continua funcionando no não perturbe</span>
      </div></div>`)}</div>

    <div class="card">${janela('Pausa', `<div class="card-corpo">
      <h3>Pausa</h3><p>Um momento para respirar antes de agir por impulso. Abre pelo botão da lateral, pelo atalho <b>⌥⌘V</b> (de qualquer lugar do Mac) e, se você quiser, sozinha quando um app ou site gatilho vier para a frente. O app só sabe <i>qual</i> app está na frente: não lê nada dele.</p>
      <div class="row" style="margin-top:16px">
        <label class="switch"><input type="checkbox" id="aj-det" ${S.deteccao.ativo ? 'checked' : ''}><span></span></label><span>Abrir sozinha quando um gatilho vier para a frente</span>
      </div>
      <div class="row" style="margin-top:12px">
        <span class="lbl">No máximo uma vez a cada</span>
        <select class="field" id="aj-int" style="width:120px">${[5, 10, 20, 30, 60, 120].map(m => `<option value="${m}" ${+S.deteccao.intervalo_min === m ? 'selected' : ''}>${fmtMin(m)}</option>`).join('')}</select>
        <span class="lbl" style="margin-left:10px">Timer da respiração</span>
        <select class="field" id="aj-timer" style="width:110px">${[3, 5, 10, 15, 20].map(m => `<option value="${m}" ${+S.timer_min === m ? 'selected' : ''}>${m} min</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-top:16px"><span class="lbl" style="min-width:110px">Apps gatilho</span>
        <input class="field" id="aj-g-apps" style="flex:1" value="${esc(S.gatilhos.apps.join(', '))}"></div>
      <div class="row" style="margin-top:10px"><span class="lbl" style="min-width:110px">Sites gatilho</span>
        <input class="field" id="aj-g-sites" style="flex:1" value="${esc(S.gatilhos.sites.join(', '))}"></div>
      <div class="row" style="margin-top:14px">
        <label class="switch"><input type="checkbox" id="aj-g-nav" ${S.gatilhos.ler_navegador ? 'checked' : ''}><span></span></label>
        <span>Olhar o endereço da aba ativa do navegador</span>
      </div>
      <p class="lbl" style="margin-top:6px">Com o navegador na frente, o app lê <b>só o endereço</b> da aba ativa e compara com os sites acima. Nada é guardado nem enviado. Na primeira vez, o macOS pergunta se o Lembretes pode controlar o navegador: é para isso.</p></div>`)}</div>

    ${TEMA === 'pixel' ? `<div class="card">${janela('Visitantes na tela', `<div class="card-corpo">
      <h3>Visitantes na tela</h3><p>De vez em quando um bichinho em pixel passa pela janela. Nunca aparecem com o editor ou um pop-up aberto, nem enquanto você digita.</p>
      <div class="row" style="margin-top:16px">
        <label class="switch"><input type="checkbox" id="aj-vis"><span></span></label><span>Visitantes na tela</span>
        <div class="seg" id="aj-vis-freq" style="margin-left:12px"><button data-v="rara">Rara</button><button data-v="normal">Normal</button><button data-v="frequente">Frequente</button></div>
        <span class="sp"></span>
        <button class="btn btn-ghost" id="aj-vis-gato">Chamar o gatinho agora</button>
      </div></div>`)}</div>` : ''}

    <div class="card">${janela('Pasta de dados', `<div class="card-corpo">
      <div class="row entre"><div style="min-width:0;flex:1"><h3>Pasta de dados</h3><p>Seus lembretes, mantras e diário ficam aqui, em arquivos JSON. Nada sai do computador.</p>
        <p class="caminho">${esc(S.pasta_dados)}</p></div>
        <button class="btn btn-ghost" onclick="api().abrir_pasta_dados()">${icon('pasta')}Abrir pasta</button></div></div>`)}</div>

    <div class="card">${janela('Backup automático', `<div class="card-corpo">
      <div class="row entre"><div style="flex:1;min-width:240px"><h3>Backup automático</h3>
        <p>Todo dia o app guarda uma cópia de todos os dados e das músicas, fora da pasta do app. Ficam as 30 mais recentes.</p></div>
        <span class="tag acc">${ultimo ? icon('check') + `<span>Último: ${esc(ultimo)}</span>` : '<span>Nenhum backup ainda</span>'}</span></div>
      <div class="row" style="margin-top:16px">
        <button class="btn btn-soft" onclick="backupAgora()">${icon('salvar')}Fazer backup agora</button>
        <button class="btn btn-ghost" onclick="api().abrir_backups()">${icon('pasta')}Abrir pasta</button>
        <span class="sp"></span>
        <button class="btn btn-ghost" onclick="restaurar()">${icon('desfazer')}Restaurar um backup…</button>
      </div></div>`)}</div>`;
  $('#ouvir-suave').onclick = () => ouvir($('#ouvir-suave'), 'suave', '', 70);
  const salvaPausa = async () => {
    S = await api().salvar_pausa_ajustes($('#aj-det').checked, +$('#aj-int').value, +$('#aj-timer').value);
    toast('Ajuste salvo', 'check');
  };
  ['#aj-det', '#aj-int', '#aj-timer'].forEach(s => $(s).onchange = salvaPausa);
  const lista = (sel) => $(sel).value.split(',').map(x => x.trim()).filter(Boolean);
  const salvaNp = async () => { S = await api().salvar_nao_perturbe_ajustes($('#aj-np-auto').checked, lista('#aj-np-apps'), $('#aj-np-exc').checked); render(); toast('Ajuste salvo', 'check'); };
  ['#aj-np-auto', '#aj-np-apps', '#aj-np-exc'].forEach(s => $(s).onchange = salvaNp);
  const salvaGat = async () => { S = await api().salvar_gatilhos(lista('#aj-g-apps'), lista('#aj-g-sites'), $('#aj-g-nav').checked); toast('Ajuste salvo', 'check'); };
  ['#aj-g-apps', '#aj-g-sites', '#aj-g-nav'].forEach(s => $(s).onchange = salvaGat);
  if (TEMA === 'pixel' && window.configurarVisitantes) {
    const v = await api().visitantes_cfg();
    const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let freq = v.frequencia || 'normal';
    $('#aj-vis').checked = v.ativo ?? !calmo;
    const salvaVis = async () => { const c = await api().salvar_visitantes($('#aj-vis').checked, freq); window.configurarVisitantes(c); toast('Ajuste salvo', 'check'); };
    segmentado('#aj-vis-freq', () => freq, (x) => { freq = x; salvaVis(); });
    $('#aj-vis').onchange = salvaVis;
    $('#aj-vis-gato').onclick = () => { irPara('hoje'); setTimeout(() => window.chamarVisitante('gato', { forcar: true }), 300); };
  }
  renderMusicas();
}

function renderMusicas() {
  const box = $('#songs');
  if (!box) return;
  box.innerHTML = S.musicas.map((m, i) => `<div class="song ${m === S.musica_padrao ? 'on' : ''}" data-m="${esc(m)}">
      <span class="check">${m === S.musica_padrao ? icon('check') : ''}</span>
      <span class="nome">${esc(semExt(m))}</span>
      <button class="icon-btn" data-curto="1" data-ouvir="${i}" title="Ouvir">${icon('play')}</button></div>`).join('')
    || '<p>Nenhuma música importada ainda.</p>';
  box.querySelectorAll('.song').forEach(el => el.onclick = async () => {
    S = await api().definir_musica_padrao(el.dataset.m); renderMusicas(); render();
    toast('Música padrão alterada', 'musica');
  });
  box.querySelectorAll('[data-ouvir]').forEach(b => b.onclick = (e) => {
    e.stopPropagation(); ouvir(b, 'musica', S.musicas[+b.dataset.ouvir], 80);
  });
}

async function backupAgora() { await api().backup_agora(); renderAjustes(); toast('Backup feito', 'salvar'); }
async function restaurar() {
  const b = await api().escolher_backup();
  if (!b) return;
  if (b.erro) { avisar('Não deu', esc(b.erro)); return; }
  const quando = new Date(b.criado_em).toLocaleString('pt-BR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  if (await confirmar('Restaurar este backup?', `De ${quando}: ${b.lembretes} lembretes e ${b.respostas} entradas do diário. O que está no app agora vai ser substituído (antes eu guardo uma cópia, por segurança).`, 'Restaurar')) {
    S = await api().restaurar(b.caminho);
    render(); renderAjustes();
    toast('Backup restaurado', 'desfazer');
  }
}

/* ---------- diário ---------- */
const ORIGEM_TXT = { atalho: 'Pausa (atalho)', botao: 'Pausa', lembrete: 'Lembrete' };

function entradaHTML(r) {
  const apagar = `<button class="icon-btn danger" title="Apagar" onclick="apagarEntrada('${r.id}')">${icon('lixo')}</button>`;
  const hora = `<span class="num">${r.quando.slice(11, 16)}</span>`;
  if (r.tipo === 'pausa') {
    const notas = r.nota_antes != null ? `<span class="tag acc">${icon('coracao')}<span>impulso ${r.nota_antes}${r.nota_depois != null ? ' → ' + r.nota_depois : ''}</span></span>` : '';
    return `<div class="entry pausa">${apagar}
      <div class="meta">${notas}${r.decisao ? `<span class="tag"><span>${esc(r.decisao)}</span></span>` : ''}${r.completou_timer ? `<span class="tag">${icon('check')}<span>respirou até o fim</span></span>` : ''}</div>
      ${r.mantra ? `<div class="q">${esc(r.mantra)}</div>` : ''}
      ${r.nota ? `<details class="rasc"><summary>ver o que você escreveu</summary><div class="a">${esc(r.nota)}</div></details>` : ''}
      <div class="foot">${hora}·<span>${esc(r.origem === 'gatilho' && r.detalhe ? r.detalhe + ' aberto' : ORIGEM_TXT[r.origem] || 'Pausa')}</span></div></div>`;
  }
  if (r.decisao === 'pulou') {
    return `<div class="entry pulo">${apagar}<div class="foot">${hora}·<span>Pulou “${esc(r.lembrete)}” desta vez. Tudo bem.</span></div></div>`;
  }
  return `<div class="entry">${apagar}
    <div class="q">${esc(r.pergunta)}</div><div class="a">${esc(r.resposta)}</div>
    <div class="foot">${hora}·<span>${esc(r.lembrete)}</span></div></div>`;
}

async function carregarDiario() {
  const lista = (await api().diario()).filter(r => r.resposta || r.tipo === 'pausa' || r.decisao === 'pulou');
  if (!lista.length) {
    $('#diario').innerHTML = `<div class="empty">${icon('caneta')}<div class="big">Seu diário está vazio</div><div>As respostas das perguntas e cada pausa aparecem aqui.</div></div>`;
    return;
  }
  const porDia = {};
  lista.forEach(r => (porDia[r.quando.slice(0, 10)] ??= []).push(r));
  $('#diario').innerHTML = Object.entries(porDia).map(([dia, rs]) => `
    <div class="dia"><div class="group-title">${esc(new Date(dia + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }))}</div>
    ${rs.map(entradaHTML).join('')}</div>`).join('');
}
async function apagarEntrada(id) {
  if (await confirmar('Apagar do diário?', 'Essa anotação vai sair do seu diário.', 'Apagar')) {
    await api().apagar_entrada(id); carregarDiario(); recarregar();
  }
}

/* ---------- atalhos ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#confirma').classList.contains('on') || $('#aviso').classList.contains('on')) { $('#aviso').classList.remove('on'); return; }
    if (E) { fecharEditor(); return; }
    $('#menu-pausa').classList.remove('on');
  }
  if (e.metaKey && !e.altKey && e.key.toLowerCase() === 'n' && !E) { e.preventDefault(); abrirEditor(); }
  if (e.metaKey && e.key === ',') { e.preventDefault(); if (E) fecharEditor(); irPara('ajustes'); }
  if (e.metaKey && e.altKey && (e.key.toLowerCase() === 'v' || e.code === 'KeyV')) { e.preventDefault(); abrirPausa(); }
});

/* ---------- início ---------- */
montar();
irPara('hoje');
window.addEventListener('pywebviewready', async () => {
  await recarregar();
  setInterval(() => { if (!E) recarregar(); }, 30000);
  window.addEventListener('focus', () => { if (!E) recarregar(); });
});
