"""Pop-up de alarme: fica por cima de tudo, toca o som e só fecha quando a tarefa é cumprida.

Uso: python3 alarme.py --json '<lembrete em JSON>'   (ou)   python3 alarme.py <id do lembrete>
"""
import json
import random
import sys
import threading
from datetime import datetime

import webview

from comum import (MENU_PT, Tocador, carregar_config, carregar_lembretes, carregar_perguntas,
                   escolher_mantra, normalizar, pagina, registrar_no_diario, som_do_lembrete)

# depois disso o som para sozinho (o pop-up continua aberto)
MAX_TOCANDO_MIN = 10


class Api:
    def __init__(self, lembrete, cfg):
        self._l = lembrete
        self._cfg = cfg
        self._janela = None
        self._tocador = None
        self._timer_silencio = None
        self._liberado = False
        self._mostrado = False
        self._tocando = False
        self._sortear()

    def _sortear(self):
        self._mantra = escolher_mantra(self._l)
        perguntas = [p["texto"] for p in carregar_perguntas()] or ["Como você está agora?"]
        self._pergunta = self._l["tarefa"].get("pergunta", "").strip() or random.choice(perguntas)

    # ---- chamado pela página ----
    def dados(self):
        return {"lembrete": self._l, "pergunta": self._pergunta, "mantra": self._mantra,
                "hora": datetime.now().strftime("%H:%M")}

    def ajustar_altura(self, altura):
        """A página mede o próprio conteúdo e pede a altura certa (nada de espaço vazio). Na 1ª vez, mostra a janela."""
        from PyObjCTools import AppHelper
        altura = max(300, min(int(altura), 920))

        def fazer():
            w = self._janela.native
            if w:
                f = w.frame()
                f.origin.y += f.size.height - altura
                f.size.height = altura
                w.setFrame_display_(f, True)
                w.center()
            if not self._mostrado:
                self._mostrar()
        AppHelper.callAfter(fazer)
        return True

    def _mostrar(self):
        if self._mostrado:
            return
        self._mostrado = True
        self._janela.show()
        self._trazer_para_frente()
        if not self._tocando:
            self._tocar()

    def concluir(self, resposta=None):
        if resposta:
            registrar_no_diario(origem="lembrete", lembrete=self._l["mensagem"], pergunta=self._pergunta,
                                resposta=resposta, mantra=self._mantra)
        self._fechar_depois()

    def pular(self):
        """'Pular desta vez': só registra o pulo, sem culpa."""
        registrar_no_diario(origem="lembrete", lembrete=self._l["mensagem"], decisao="pulou")
        self._fechar_depois(0.3)

    def adiar(self, minutos=None):
        self._silenciar()
        self._janela.hide()
        threading.Timer(int(minutos or self._l["adiar_minutos"]) * 60, self._voltar).start()

    # ---- interno ----
    def _fechar_depois(self, segundos=1.6):
        self._silenciar()
        self._liberado = True
        threading.Timer(segundos, self._janela.destroy).start()

    def _trazer_para_frente(self):
        """Pede ao macOS o foco do teclado (o pop-up já fica por cima com on_top)."""
        from AppKit import NSApplication
        from PyObjCTools import AppHelper

        def ativar():
            w = self._janela.native
            if w:
                # aparece em qualquer mesa (Space), inclusive por cima de apps em tela cheia
                w.setCollectionBehavior_((1 << 0) | (1 << 8))  # CanJoinAllSpaces | FullScreenAuxiliary
                w.setLevel_(101)                               # nível de pop-up: acima das janelas normais
                w.makeKeyAndOrderFront_(None)
            # o macOS só entrega o foco do teclado se você não estiver usando outro app (proteção do sistema)
            NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
        AppHelper.callAfter(ativar)

    def _comecar(self):
        # a janela nasce escondida e aparece quando a página disser a altura; se algo falhar, aparece mesmo assim
        threading.Timer(2.5, self._mostrar).start()

    def _tocar(self):
        self._tocando = True
        caminho, pausa = som_do_lembrete(self._l, self._cfg)
        self._tocador = Tocador(caminho, self._l.get("volume", 80), pausa=pausa)
        self._tocador.tocar()
        self._timer_silencio = threading.Timer(MAX_TOCANDO_MIN * 60, self._silenciar_por_tempo)
        self._timer_silencio.start()

    def _silenciar(self):
        if self._tocador:
            self._tocador.parar()
        if self._timer_silencio:
            self._timer_silencio.cancel()

    def _silenciar_por_tempo(self):
        self._silenciar()
        self._janela.evaluate_js("silenciou()")

    def _voltar(self):
        self._sortear()
        self._janela.show()
        self._trazer_para_frente()
        self._janela.evaluate_js("reiniciar()")
        self._tocar()

    def _ao_fechar(self):
        return self._liberado  # False cancela o fechamento


def main():
    cfg = carregar_config()
    if len(sys.argv) >= 3 and sys.argv[1] == "--json":
        lembrete = normalizar(json.loads(sys.argv[2]))
    elif len(sys.argv) >= 2:
        achados = [l for l in carregar_lembretes() if l["id"] == sys.argv[1]]
        if not achados:
            sys.exit(f"Lembrete {sys.argv[1]} não encontrado")
        lembrete = achados[0]
    else:
        sys.exit(__doc__)

    api = Api(lembrete, cfg)
    altura = 780 if lembrete["tarefa"]["tipo"] == "pergunta" else 720
    janela = webview.create_window("Lembrete", url=pagina("alarme.html", cfg), js_api=api,
                                   width=500, height=altura, resizable=False, on_top=True,
                                   frameless=True, easy_drag=False, transparent=True, focus=True, hidden=True)
    api._janela = janela
    janela.events.closing += api._ao_fechar
    try:
        webview.start(api._comecar, localization=MENU_PT)
    finally:
        api._silenciar()


if __name__ == "__main__":
    main()
