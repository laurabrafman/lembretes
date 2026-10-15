"""Janela "Pausa": um momento para respirar antes de agir por impulso.

Passos: nota do impulso → frase → respiração com timer + espaço para escrever → nota de novo e decisão.
Uso: python3 pausa.py --origem atalho|botao|gatilho [--detalhe "nome do app ou site"]

O que você escreve fica só no seu computador (notas_pausa.json). Os botões finais só anotam no diário.
"""
import random
import sys
import threading
from datetime import datetime

import webview

from comum import (HABILIDADES, MENU_PT, SOM_SUAVE, Tocador, arquivo, carregar_config, carregar_mantras,
                   ler_json, novo_id, pagina, registrar_no_diario, salvar_json)

ORIGENS = {"atalho": "Pausa (atalho)", "botao": "Pausa", "gatilho": "Gatilho aberto"}


class Api:
    def __init__(self, origem, detalhe=""):
        self._origem = origem if origem in ORIGENS else "botao"
        self._detalhe = detalhe
        self._janela = None
        self._id = novo_id()
        mantras = carregar_mantras()
        self._mantra = random.choice(mantras)["texto"] if mantras else "Respira. Você está aqui."
        self._registrado = False

    def dados(self):
        cfg = carregar_config()
        return {"origem": self._origem, "detalhe": self._detalhe, "origem_txt": ORIGENS[self._origem], "mantra": self._mantra,
                "timer_min": int(cfg.get("timer_min", 10)), "habilidades": HABILIDADES}

    def outro_mantra(self):
        mantras = [m["texto"] for m in carregar_mantras() if m["texto"] != self._mantra]
        if mantras:
            self._mantra = random.choice(mantras)
        return self._mantra

    def salvar_nota(self, texto):
        """Guarda (ou atualiza) o que foi escrito nesta pausa. Só no computador."""
        lista = ler_json(arquivo("notas_pausa.json"), [])
        lista = [r for r in lista if r.get("id") != self._id]
        if texto.strip():
            lista.append({"id": self._id, "quando": datetime.now().isoformat(timespec="seconds"),
                          "origem": self._origem, "texto": texto})
        salvar_json(arquivo("notas_pausa.json"), lista)
        return True

    def tocar_fim(self):
        """Sino baixinho quando o timer termina."""
        Tocador(SOM_SUAVE, 45, repetir=False).tocar()

    def concluir(self, registro):
        """registro: nota_antes, nota_depois, decisao, nota, completou_timer."""
        self._registrar(registro)
        threading.Timer(3.2, self._janela.destroy).start()

    def fechar(self, registro=None):
        """Fechar a qualquer momento é sempre permitido. Registra o que deu tempo de fazer."""
        if registro and registro.get("nota_antes") is not None:
            self._registrar({**registro, "decisao": registro.get("decisao") or "fechou antes do fim"})
        self._janela.destroy()

    def _registrar(self, r):
        if self._registrado:
            return
        self._registrado = True
        registrar_no_diario(origem=self._origem, detalhe=self._detalhe, tipo="pausa", mantra=self._mantra,
                            nota_antes=r.get("nota_antes"), nota_depois=r.get("nota_depois"),
                            decisao=r.get("decisao"), nota=(r.get("nota") or "").strip(),
                            completou_timer=bool(r.get("completou_timer")))


def main():
    origem = sys.argv[sys.argv.index("--origem") + 1] if "--origem" in sys.argv else "botao"
    detalhe = sys.argv[sys.argv.index("--detalhe") + 1] if "--detalhe" in sys.argv else ""
    api = Api(origem, detalhe)
    janela = webview.create_window("Pausa", url=pagina("pausa.html"), js_api=api,
                                   width=560, height=800, resizable=False, on_top=True,
                                   frameless=True, easy_drag=False, transparent=True, focus=True)
    api._janela = janela

    def comecar():
        from AppKit import NSApplication
        from PyObjCTools import AppHelper

        def frente():
            if janela.native:
                janela.native.setCollectionBehavior_((1 << 0) | (1 << 8))
                janela.native.makeKeyAndOrderFront_(None)
            NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
        AppHelper.callAfter(frente)

    webview.start(comecar, localization=MENU_PT)


if __name__ == "__main__":
    main()
