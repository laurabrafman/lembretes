/* Aviso de lembretes que não tocaram.
   modo "perdidos": o Mac estava dormindo. modo "nao_perturbe": ficaram na fila do modo não perturbe. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (s) => document.querySelector(s);
let D = null;

function render() {
  const n = D.itens.length;
  const hoje = new Date().toDateString();
  if (D.modo === 'nao_perturbe') {
    document.body.classList.add('modo-np');
    if ($('.winbar-t')) $('.winbar-t').textContent = 'Não perturbe';
    $('#t').textContent = n === 1 ? 'Enquanto o não perturbe estava ligado: 1 lembrete' : `Enquanto o não perturbe estava ligado: ${n} lembretes`;
    $('#sub').textContent = 'Eles esperaram você. Faz agora o que fizer sentido, e pula o resto sem culpa.';
    $('#foot').innerHTML = `<button class="b b-ghost" id="todos">Pular todos</button><button class="b b-main" id="ok">Fechar</button>`;
    $('#todos').onclick = async () => { for (const p of [...D.itens]) await pywebview.api.pular(p.id, p.mensagem); pywebview.api.fechar(); };
  } else {
    $('#t').textContent = n === 1 ? 'Você perdeu 1 lembrete' : `Você perdeu ${n} lembretes`;
  }
  $('#lista').innerHTML = D.itens.map((p, i) => {
    const d = new Date(p.quando);
    const dia = d.toDateString() === hoje ? 'hoje' : d.toLocaleDateString('pt-BR', { weekday: 'long' });
    const acoes = D.modo === 'nao_perturbe'
      ? `<span class="acoes-it"><button class="mini-b" data-fazer="${i}">fazer agora</button><button class="mini-b" data-pular="${i}">pular</button></span>` : '';
    return `<div class="it"><span class="h num">${p.quando.slice(11, 16)}</span><span class="m">${esc(p.mensagem)}</span><span class="d">${dia}</span>${acoes}</div>`;
  }).join('');
  const tira = (i) => { D.itens.splice(i, 1); if (!D.itens.length) pywebview.api.fechar(); else render(); };
  document.querySelectorAll('[data-fazer]').forEach(b => b.onclick = async () => { const i = +b.dataset.fazer; await pywebview.api.fazer_agora(D.itens[i].id); tira(i); });
  document.querySelectorAll('[data-pular]').forEach(b => b.onclick = async () => { const i = +b.dataset.pular; await pywebview.api.pular(D.itens[i].id, D.itens[i].mensagem); tira(i); });
  $('#ok').onclick = () => pywebview.api.fechar();
  $('#ok').focus();
}

window.addEventListener('pywebviewready', async () => { D = await pywebview.api.dados(); render(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pywebview.api.fechar(); });
