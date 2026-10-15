"""Avisos de lembretes que não tocaram.

- Perdidos: o Mac estava dormindo/desligado.     python3 perdidos.py '[{"mensagem", "quando"}, ...]'
- Não perturbe: ficaram na fila do modo.         python3 perdidos.py '{"modo": "nao_perturbe", "itens": [...]}'
  Nesse modo cada lembrete tem "fazer agora" (abre o alarme dele) ou "pular" (só anota no diário).
"""
import json
import subprocess
import sys

import webview

from comum import MENU_PT, abrir_alarme, carregar_lembretes, pagina, registrar_no_diario


class Api:
    def __init__(self, modo, itens):
        self._modo = modo
        self._itens = itens
        self._janela = None

    def dados(self):
        return {"modo": self._modo, "itens": self._itens}

    def perdidos(self):  # compatibilidade com a página antiga
        return self._itens

    def fazer_agora(self, id_):
        lembrete = next((l for l in carregar_lembretes() if l["id"] == id_), None)
        if lembrete:
            abrir_alarme(lembrete)
        return bool(lembrete)

    def pular(self, id_, mensagem):
        registrar_no_diario(origem="lembrete", lembrete=mensagem, decisao="pulou")
        return True

    def abrir_app(self):
        subprocess.Popen(["open", "-a", "Lembretes"])
        self._janela.destroy()

    def fechar(self):
        self._janela.destroy()


def main():
    dados = json.loads(sys.argv[1])
    if isinstance(dados, dict):
        modo, itens = dados.get("modo", "perdidos"), dados.get("itens", [])
    else:
        modo, itens = "perdidos", dados
    itens = sorted(itens, key=lambda p: p["quando"])
    api = Api(modo, itens)
    extra = 30 if modo == "nao_perturbe" else 0
    altura = min(660, 340 + (58 + extra) * len(itens))
    api._janela = webview.create_window("Lembretes", url=pagina("perdidos.html"), js_api=api,
                                        width=460, height=altura, resizable=False, on_top=True,
                                        frameless=True, easy_drag=False, transparent=True)
    if modo == "perdidos":
        subprocess.Popen(["afplay", "-v", "0.6", "/System/Library/Sounds/Glass.aiff"])
    webview.start(localization=MENU_PT)


if __name__ == "__main__":
    main()
