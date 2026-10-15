"""Lembretes — janela principal (interface em HTML numa janela nativa do Mac)."""
import os
import subprocess
import threading
from datetime import date, datetime, timedelta

import webview

from comum import (BACKUPS, PASTA, tela_principal, definir_nao_perturbe, nao_perturbe_info, texto_nao_perturbe, EXTENSOES, MENU_PT, PLIST, Tocador, abrir_alarme, carregar_config,
                   carregar_lembretes, carregar_mantras, carregar_perguntas, descrever_quando, descrever_som,
                   descrever_tarefa, fazer_backup, horarios_do_dia, importar_musica, ler_backup, ler_json,
                   listar_backups, listar_musicas, migrar, normalizar, novo_lembrete, pagina, pasta_dados,
                   pausado, proxima_ocorrencia, restaurar_backup, salvar_config, salvar_json,
                   salvar_lembretes, servico_rodando, som_do_lembrete, vale_no_dia, arquivo)

CAMPOS = set(novo_lembrete())


def limpar(l):
    """Normaliza o que veio da interface e descarta campos só de exibição."""
    l = normalizar({k: v for k, v in l.items() if k in CAMPOS})
    if not l.get("id"):
        l["id"] = novo_lembrete()["id"]
    l["mensagem"] = l["mensagem"].strip()
    l["detalhes"] = l["detalhes"].strip()
    return l


def agenda_de_hoje(lembretes, agora):
    """Ocorrências de hoje em ordem cronológica, marcando as que já passaram."""
    itens = []
    for l in lembretes:
        if not l["ativo"] or not vale_no_dia(l, agora.date()):
            continue
        for hhmm in horarios_do_dia(l):
            h, m = map(int, hhmm.split(":"))
            quando = agora.replace(hour=h, minute=m, second=0, microsecond=0)
            itens.append({"id": l["id"], "hora": hhmm, "mensagem": l["mensagem"], "passou": quando <= agora, "tipo": l["tipo"],
                          "som_txt": descrever_som(l), "tarefa_txt": descrever_tarefa(l)})
    return sorted(itens, key=lambda i: i["hora"])


def ajustar_barra_de_titulo(janela, pixel):
    """Barra de título nativa transparente: mantém os botões do macOS e esconde o título duplicado."""
    from PyObjCTools import AppHelper

    def aplicar():
        w = janela.native
        if w is None:
            return
        tela_cheia = 1 << 15  # NSWindowStyleMaskFullSizeContentView
        w.setTitlebarAppearsTransparent_(pixel)
        w.setTitleVisibility_(1 if pixel else 0)  # 1 = NSWindowTitleHidden
        w.setStyleMask_((w.styleMask() | tela_cheia) if pixel else (w.styleMask() & ~tela_cheia))
    AppHelper.callAfter(aplicar)


class Api:
    def __init__(self):
        self._janela = None
        self._tocador = None

    # ---- leitura ----
    def estado(self):
        cfg = carregar_config()
        agora = datetime.now()
        lembretes = carregar_lembretes()
        saida = []
        for l in sorted(lembretes, key=lambda l: (l["horas"][0], l["mensagem"].lower())):
            prox = proxima_ocorrencia(l, agora)
            saida.append({**l, "quando_txt": descrever_quando(l), "som_txt": descrever_som(l),
                          "tarefa_txt": descrever_tarefa(l), "horarios": horarios_do_dia(l),
                          "proxima": prox.isoformat() if prox else None})
        return {"lembretes": saida, "hoje": agenda_de_hoje(lembretes, agora),
                "musicas": listar_musicas(), "musica_padrao": cfg["musica_padrao"],
                "nao_perturbe": {**nao_perturbe_info(cfg), "texto": texto_nao_perturbe(nao_perturbe_info(cfg)),
                                                                "cfg": cfg["nao_perturbe"]},
                "gatilhos": cfg["gatilhos"],
                "servico": servico_rodando(), "perguntas": [p["texto"] for p in carregar_perguntas()],
                "mantras": carregar_mantras(), "pasta_dados": pasta_dados(),
                "deteccao": cfg["deteccao"], "timer_min": cfg["timer_min"],
                "total_diario": len(ler_json(arquivo("diario.json"), []))}

    def novo(self):
        return novo_lembrete()


    # ---- escrita ----
    def salvar(self, lembrete):
        l = limpar(lembrete)
        lembretes = carregar_lembretes()
        for i, x in enumerate(lembretes):
            if x["id"] == l["id"]:
                lembretes[i] = l
                break
        else:
            lembretes.append(l)
        salvar_lembretes(lembretes)
        return self.estado()

    def excluir(self, id):
        salvar_lembretes([l for l in carregar_lembretes() if l["id"] != id])
        return self.estado()

    def alternar(self, id):
        lembretes = carregar_lembretes()
        for l in lembretes:
            if l["id"] == id:
                l["ativo"] = not l["ativo"]
        salvar_lembretes(lembretes)
        return self.estado()

    def testar(self, lembrete):
        self.parar_som()
        abrir_alarme(limpar(lembrete))

    # ---- não perturbe ----
    def nao_perturbe(self, como):
        """como: '30', '60', '120', 'indefinido', 'amanha' ou 'desligar'."""
        definir_nao_perturbe(como)
        return self.estado()

    def salvar_nao_perturbe_ajustes(self, auto_ativo, apps, pausa_excecao):
        cfg = carregar_config()
        cfg["nao_perturbe"]["auto"] = {"ativo": bool(auto_ativo), "apps": [a.strip() for a in apps if a.strip()]}
        cfg["nao_perturbe"]["pausa_excecao"] = bool(pausa_excecao)
        salvar_config(cfg)
        return self.estado()

    def salvar_gatilhos(self, apps, sites, ler_navegador):
        cfg = carregar_config()
        cfg["gatilhos"] = {"apps": [a.strip() for a in apps if a.strip()], "sites": [s.strip() for s in sites if s.strip()],
                           "ler_navegador": bool(ler_navegador)}
        salvar_config(cfg)
        return self.estado()

    # ---- músicas ----
    def importar_musica(self):
        tipos = ("Áudio (" + ";".join("*" + e for e in EXTENSOES) + ")",)
        escolha = self._janela.create_file_dialog(webview.FileDialog.OPEN, directory=os.path.expanduser("~/Downloads"),
                                                  file_types=tipos)
        if not escolha:
            return None
        return importar_musica(escolha[0] if isinstance(escolha, (list, tuple)) else escolha)

    def definir_musica_padrao(self, nome):
        cfg = carregar_config()
        cfg["musica_padrao"] = nome
        salvar_config(cfg)
        return self.estado()

    def ouvir(self, som, nome, volume):
        """Prévia: som = suave | musica | silencioso; nome = arquivo (vazio = padrão)."""
        self.parar_som()
        caminho, _ = som_do_lembrete({"som": som, "musica": nome}, carregar_config())
        if not caminho:
            return False
        self._tocador = Tocador(caminho, volume, repetir=False)
        self._tocador.tocar()
        return True

    def tocando(self):
        t = self._tocador
        return bool(t and not t.parado.is_set() and (t.proc is None or t.proc.poll() is None))

    def parar_som(self):
        if self._tocador:
            self._tocador.parar()
            self._tocador = None

    # ---- "Pausa" ----
    def abrir_pausa(self):
        import vigia
        self.parar_som()
        return vigia.abrir_pausa("botao")

    def salvar_pausa_ajustes(self, ativo, intervalo_min, timer_min):
        cfg = carregar_config()
        cfg["deteccao"] = {"ativo": bool(ativo), "intervalo_min": int(intervalo_min)}
        cfg["timer_min"] = int(timer_min)
        salvar_config(cfg)
        return self.estado()

    # ---- visitantes (pele pixel) ----
    def visitantes_cfg(self):
        return carregar_config()["visitantes"]

    def salvar_visitantes(self, ativo, frequencia):
        cfg = carregar_config()
        cfg["visitantes"] = {"ativo": bool(ativo), "frequencia": frequencia}
        salvar_config(cfg)
        return cfg["visitantes"]

    def frases_curtas(self):
        """Mantras curtos para o balão do gatinho (os longos ficam de fora)."""
        textos = [m["texto"].strip() for m in carregar_mantras()]
        curtas = [t for t in textos if len(t) <= 52]
        return curtas or sorted(textos, key=len)[:3]

    def popups_abertos(self):
        """Algum pop-up (alarme, "Pausa", aviso) aberto agora? Visitantes não aparecem nessa hora."""
        padrao = os.path.join(PASTA, r"(alarme|pausa|perdidos)\.py")
        r = subprocess.run(["pgrep", "-f", padrao], capture_output=True)
        return r.returncode == 0

    # ---- diário ----
    def diario(self):
        """Entradas mais recentes primeiro: respostas, pausas e pulos."""
        return list(reversed(ler_json(arquivo("diario.json"), [])))

    def apagar_entrada(self, id):
        lista = ler_json(arquivo("diario.json"), [])
        salvar_json(arquivo("diario.json"), [r for r in lista if r.get("id") != id])

    # ---- backup ----
    def backups(self):
        lista = listar_backups()
        return {"pasta": BACKUPS, "total": len(lista), "ultimo": lista[0][7:-5] if lista else None}

    def backup_agora(self):
        fazer_backup("manual")
        return self.backups()

    def abrir_backups(self):
        os.makedirs(BACKUPS, exist_ok=True)
        subprocess.Popen(["open", BACKUPS])

    def abrir_pasta_dados(self):
        subprocess.Popen(["open", pasta_dados()])

    def escolher_backup(self):
        escolha = self._janela.create_file_dialog(webview.FileDialog.OPEN, directory=BACKUPS,
                                                  file_types=("Backup do Lembretes (*.json)",))
        if not escolha:
            return None
        caminho = escolha[0] if isinstance(escolha, (list, tuple)) else escolha
        try:
            dados = ler_backup(caminho)
        except ValueError as e:
            return {"erro": str(e)}
        arq = dados["arquivos"]
        return {"caminho": caminho, "criado_em": dados.get("criado_em", ""),
                "lembretes": len(arq.get("lembretes.json") or []), "respostas": len(arq.get("diario.json") or [])}

    def restaurar(self, caminho):
        restaurar_backup(caminho)
        return self.estado()

    # ---- serviço ----
    def ligar_servico(self):
        subprocess.run(["launchctl", "load", "-w", PLIST], capture_output=True)


def main():
    migrar()
    api = Api()
    janela = webview.create_window("Lembretes", url=tela_principal(), js_api=api,
                                   width=1140, height=780, min_size=(900, 620), text_select=False)
    api._janela = janela
    janela.events.closing += api.parar_som
    webview.start(lambda: ajustar_barra_de_titulo(janela, True), localization=MENU_PT)


if __name__ == "__main__":
    main()
