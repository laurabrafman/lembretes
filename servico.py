"""Serviço em segundo plano: confere os horários e abre o pop-up de alarme na hora certa.

Roda sozinho pelo launchd (inicia junto com o Mac). Não precisa abrir na mão.
Também avisa dos alarmes perdidos (Mac dormindo/desligado), respeita a pausa e faz backup uma vez por dia.
"""
import json
import os
import threading
import time
from datetime import datetime, timedelta

from comum import (ESTADO, PASTA, abrir_alarme, abrir_popup, carregar_config, carregar_lembretes, fazer_backup,
                   ler_json, migrar, nao_perturbe_ativo, ocorre_em, salvar_json)

# se o Mac estava ocupado na hora exata, ainda toca o alarme até X minutos depois
TOLERANCIA_MIN = 3
# o que passou disso (e até X horas atrás) vira "alarme perdido"
LIMITE_PERDIDOS_H = 12


def carregar_estado():
    estado = ler_json(ESTADO, {})
    if "disparados" not in estado:  # formato antigo: só o dicionário de disparados
        estado = {"disparados": estado}
    estado.setdefault("ultima", None)
    estado.setdefault("ultimo_backup", None)
    estado.setdefault("fila_np", [])          # lembretes que caíram durante o não perturbe
    estado.setdefault("np_estava_ativo", False)
    return estado


def procurar_perdidos(lembretes, de, ate, disparados, em_pausa=lambda m: False, fila=None):
    """Ocorrências entre `de` (exclusivo) e `ate` (exclusivo) que não tocaram.
    As que caíram durante o não perturbe vão para a `fila` (não contam como perdidas)."""
    perdidos = []
    momento = de + timedelta(minutes=1)
    while momento < ate:
        for l in lembretes:
            chave = f"{l['id']}@{momento:%Y-%m-%d %H:%M}"
            if l["ativo"] and chave not in disparados and ocorre_em(l, momento):
                disparados[chave] = momento.isoformat()
                item = {"id": l["id"], "mensagem": l["mensagem"], "quando": momento.isoformat(timespec="minutes")}
                if not em_pausa(momento):
                    perdidos.append(item)
                elif fila is not None:
                    fila.append(item)
        momento += timedelta(minutes=1)
    return perdidos


def avisar_perdidos(perdidos):
    abrir_popup(f"{PASTA}/perdidos.py", json.dumps(perdidos, ensure_ascii=False))


def avisar_fim_nao_perturbe(fila):
    """Saiu do não perturbe: "Enquanto o não perturbe estava ligado: N lembretes", com fazer agora / pular."""
    abrir_popup(f"{PASTA}/perdidos.py", json.dumps({"modo": "nao_perturbe", "itens": fila}, ensure_ascii=False))


def laco_dos_alarmes():
    estado = carregar_estado()
    disparados = estado["disparados"]
    while True:
        agora = datetime.now().replace(second=0, microsecond=0)
        try:
            lembretes = carregar_lembretes()
            cfg = carregar_config()
        except Exception as e:
            print("Erro lendo os dados:", e, flush=True)
            lembretes, cfg = [], {}

        # 1) Ficou muito tempo sem conferir (Mac dormindo/desligado)? Junta o que foi perdido.
        inicio_normal = agora - timedelta(minutes=TOLERANCIA_MIN)
        if estado["ultima"]:
            ultima = max(datetime.fromisoformat(estado["ultima"]), agora - timedelta(hours=LIMITE_PERDIDOS_H))
            if ultima < inicio_normal:
                perdidos = procurar_perdidos(lembretes, ultima, inicio_normal, disparados,
                                             lambda m: nao_perturbe_ativo(cfg, m), estado["fila_np"])
                if perdidos:
                    avisar_perdidos(perdidos)

        # 2) Alarmes de agora (com uma pequena tolerância). No não perturbe: vai para a fila, sem tocar.
        em_pausa = nao_perturbe_ativo(cfg, datetime.now())
        for l in lembretes:
            if not l["ativo"]:
                continue
            for atraso in range(TOLERANCIA_MIN + 1):
                momento = agora - timedelta(minutes=atraso)
                chave = f"{l['id']}@{momento:%Y-%m-%d %H:%M}"
                if ocorre_em(l, momento) and chave not in disparados:
                    disparados[chave] = agora.isoformat()
                    if not em_pausa:
                        abrir_alarme(l)
                    else:
                        estado["fila_np"].append({"id": l["id"], "mensagem": l["mensagem"],
                                                  "quando": momento.isoformat(timespec="minutes")})

        # 2b) Acabou o não perturbe? Mostra o que ficou na fila.
        if estado["np_estava_ativo"] and not em_pausa and estado["fila_np"]:
            avisar_fim_nao_perturbe(estado["fila_np"])
            estado["fila_np"] = []
        estado["np_estava_ativo"] = em_pausa

        # 3) Backup uma vez por dia
        hoje = agora.date().isoformat()
        if estado["ultimo_backup"] != hoje:
            try:
                fazer_backup()
                estado["ultimo_backup"] = hoje
            except Exception as e:
                print("Erro no backup:", e, flush=True)

        # esquece o histórico com mais de 2 dias
        limite = (agora - timedelta(days=2)).isoformat()
        for k in [k for k, v in disparados.items() if v < limite]:
            del disparados[k]
        estado["ultima"] = agora.isoformat()
        salvar_json(ESTADO, estado)

        time.sleep(10)


def laco_seguro():
    """Se algo der errado no laço, encerra o serviço inteiro: o launchd (KeepAlive) reinicia na hora."""
    try:
        laco_dos_alarmes()
    except Exception as e:
        print("Erro no laço dos alarmes:", repr(e), flush=True)
    os._exit(1)


def main():
    migrar()
    threading.Thread(target=laco_seguro, daemon=True).start()
    import vigia  # atalho ⌥⌘V, apps/sites gatilho e barra de menus (precisa da thread principal)
    vigia.rodar()


if __name__ == "__main__":
    main()
