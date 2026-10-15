"""Coisas compartilhadas entre a janela principal, o serviço e os pop-ups."""
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import unicodedata
import uuid
from datetime import date, datetime

PASTA = os.path.dirname(os.path.abspath(__file__))
ALARME = os.path.join(PASTA, "alarme.py")
ESTADO = os.path.join(PASTA, "estado.json")          # controle interno do serviço
MUSICAS = os.path.join(PASTA, "musicas")
SONS = os.path.join(PASTA, "sons")
SOM_SUAVE = os.path.join(SONS, "suave.wav")
UI = os.path.join(PASTA, "ui")
ICONE = os.path.join(UI, "icone.icns")
PLIST = os.path.expanduser("~/Library/LaunchAgents/com.lembretes.app.plist")
SERVICO = "com.lembretes.app"
# fora da pasta do app de propósito: se ~/Lembretes for apagada, os backups sobrevivem
BACKUPS = os.path.expanduser("~/Library/Application Support/Lembretes/backups")
MAX_BACKUPS = 30

# Onde ficam os dados. Padrão: <pasta do app>/data.
# Para mudar (ex.: iCloud Drive), grave {"pasta": "..."} em onde_ficam_os_dados.json.
PONTEIRO_DADOS = os.path.join(PASTA, "onde_ficam_os_dados.json")
PASTA_ICLOUD = os.path.expanduser("~/Library/Mobile Documents/com~apple~CloudDocs/Lembretes")


def pasta_dados():
    try:
        with open(PONTEIRO_DADOS, encoding="utf-8") as f:
            return os.path.expanduser(json.load(f)["pasta"])
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return os.path.join(PASTA, "data")


def arquivo(nome):
    return os.path.join(pasta_dados(), nome)


DIAS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
EXTENSOES = (".mp3", ".m4a", ".wav", ".aiff", ".aif", ".aac", ".flac", ".caf")
DIFICULDADES = {"facil": "Fácil", "medio": "Médio", "dificil": "Difícil"}

# ---------- conteúdo inicial ----------

# frases curtas de bem-estar (editáveis no app)
MANTRAS_INICIAIS = [
    "Um passo de cada vez.",
    "Respira. Você está aqui agora.",
    "Cuidar de si também é prioridade.",
    "Está tudo bem descansar.",
    "Pequenos progressos ainda são progresso.",
]

PERGUNTAS_INICIAIS = [
    "Como você está se sentindo agora, de verdade?",
    "Do que você precisa neste momento?",
    "Qual é a coisa mais importante para as próximas horas?",
    "O que dá para simplificar hoje?",
    "O que deu certo hoje, mesmo que pequeno?",
]

CONFIG_PADRAO = {
    "versao_dados": 2,
    "musica_padrao": "musiquinha.wav",
    # modo não perturbe: nada abre nem toca; os lembretes vão para uma fila
    "nao_perturbe": {"ate": None, "indefinido": False, "pausa_excecao": True,
                     "auto": {"ativo": False, "apps": ["Steam", "Zoom"]}},
    # apps e sites que abrem a "Pausa" sozinha (nenhum por padrão; configure em Ajustes)
    "gatilhos": {"apps": [], "sites": [], "ler_navegador": False},
    "deteccao": {"ativo": True, "intervalo_min": 20},
    "timer_min": 10,
    # visitantes (só na pele pixel). ativo None = automático: desligado se o Mac pede "reduzir movimento"
    "visitantes": {"ativo": None, "frequencia": "normal"},
}


# ---------- arquivos ----------

def ler_json(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def salvar_json(caminho, dados):
    # grava num temporário e troca (atômico): nunca deixa um JSON pela metade
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(caminho), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    os.replace(tmp, caminho)


def novo_id():
    return uuid.uuid4().hex[:8]


# ---------- lembretes ----------

def novo_lembrete():
    return {
        "id": novo_id(),
        "ativo": True,
        "mensagem": "",
        "detalhes": "",
        "tipo": "habito",                  # habito (rotina do dia) | compromisso (agenda)
        "horas": ["08:00"],                # um ou mais horários no dia
        "repeticao": "todo_dia",           # uma_vez | todo_dia | dias_uteis | dias_semana
        "data": date.today().isoformat(),  # usada quando repeticao == uma_vez
        "dias": [0, 1, 2, 3, 4],           # usada quando dias_semana (0 = segunda)
        # "a cada N horas": do primeiro horário até "ate"
        "intervalo": {"ativo": False, "minutos": 60, "ate": "18:00"},
        "som": "musica",                   # suave | musica | silencioso
        "musica": "",                      # vazio = música padrão (só quando som == musica)
        "volume": 80,
        "mantra": {"modo": "nenhum", "id": ""},  # nenhum | fixo | aleatorio
        "tarefa": {"tipo": "nenhuma", "quantidade": 3, "dificuldade": "facil",
                   "frase": "Eu vou fazer isso agora", "frase_fonte": "livre",  # livre | mantra
                   "segundos": 5, "pergunta": "", "min_palavras": 5},
        "adiar": True,
        "adiar_minutos": 10,               # 5 | 10 | 30
    }


def normalizar(lembrete):
    base = novo_lembrete()
    for chave, valor in lembrete.items():
        if isinstance(base.get(chave), dict) and isinstance(valor, dict):
            base[chave].update(valor)
        else:
            base[chave] = valor
    if "tipo" not in lembrete:  # antes não existia: "uma vez" vira compromisso, o resto é hábito
        base["tipo"] = "compromisso" if base["repeticao"] == "uma_vez" else "habito"
    if "hora" in base:  # formato antigo (um horário só)
        base["horas"] = [base.pop("hora")]
    base["horas"] = sorted({h for h in base["horas"] if h}) or ["08:00"]
    return base


def carregar_lembretes():
    return [normalizar(l) for l in ler_json(arquivo("lembretes.json"), [])]


def salvar_lembretes(lembretes):
    salvar_json(arquivo("lembretes.json"), lembretes)


def carregar_config():
    cfg = json.loads(json.dumps(CONFIG_PADRAO))
    for k, v in ler_json(arquivo("config.json"), {}).items():
        if isinstance(cfg.get(k), dict) and isinstance(v, dict):
            for k2, v2 in v.items():
                if isinstance(cfg[k].get(k2), dict) and isinstance(v2, dict):
                    cfg[k][k2].update(v2)
                else:
                    cfg[k][k2] = v2
        else:
            cfg[k] = v
    # a "pausa" antiga virou o não perturbe
    cfg.pop("pausado_ate", None)
    return cfg


def salvar_config(cfg):
    salvar_json(arquivo("config.json"), cfg)


def carregar_mantras():
    return ler_json(arquivo("mantras.json"), [])


def carregar_perguntas():
    return ler_json(arquivo("perguntas.json"), [])


def escolher_mantra(lembrete):
    """Texto do mantra que o lembrete deve mostrar agora (ou "")."""
    m = lembrete["mantra"]
    mantras = carregar_mantras()
    if m["modo"] == "fixo":
        achado = next((x for x in mantras if x["id"] == m["id"]), None)
        if achado:
            return achado["texto"]
    if m["modo"] == "aleatorio" or (lembrete["tarefa"]["tipo"] == "frase"
                                    and lembrete["tarefa"]["frase_fonte"] == "mantra"):
        return random.choice(mantras)["texto"] if mantras else ""
    return ""


# ---------- diário ----------

def registrar_no_diario(**campos):
    """Acrescenta uma entrada ao diário. Campos livres: origem, lembrete, pergunta, resposta, mantra..."""
    lista = ler_json(arquivo("diario.json"), [])
    lista.append({"id": novo_id(), "quando": datetime.now().isoformat(timespec="seconds"), **campos})
    salvar_json(arquivo("diario.json"), lista)


# ---------- dados iniciais ----------

def migrar():
    """Na primeira vez, cria a pasta de dados com exemplos. Idempotente (não mexe se já existir)."""
    if os.path.exists(arquivo("config.json")):
        return False
    os.makedirs(pasta_dados(), exist_ok=True)
    mantras = [{"id": f"m{i + 1}", "texto": t} for i, t in enumerate(MANTRAS_INICIAIS)]

    agua = novo_lembrete()
    agua.update(mensagem="Beber água 💧", horas=["10:00", "14:00", "16:00"], som="suave", volume=60)
    alongar = novo_lembrete()
    alongar.update(mensagem="Levantar e alongar 🧘", horas=["15:30"], repeticao="dias_uteis", som="suave", volume=60)
    alongar["tarefa"].update(tipo="segurar", segundos=5)
    pausa = novo_lembrete()
    pausa.update(mensagem="Uma pausa para respirar", horas=["11:00"], som="suave", volume=60,
                 mantra={"modo": "aleatorio", "id": ""})
    pausa["tarefa"].update(tipo="frase", frase_fonte="mantra")

    salvar_json(arquivo("mantras.json"), mantras)
    salvar_json(arquivo("perguntas.json"), [{"id": f"p{i + 1}", "texto": t} for i, t in enumerate(PERGUNTAS_INICIAIS)])
    for nome in ("diario.json", "notas_pausa.json", "anotacoes.json", "rotina.json"):
        if not os.path.exists(arquivo(nome)):
            salvar_json(arquivo(nome), [])
    salvar_lembretes([agua, alongar, pausa])
    salvar_config(json.loads(json.dumps(CONFIG_PADRAO)))  # por último: marca os dados como prontos
    return True


# ---------- músicas e sons ----------

def listar_musicas():
    os.makedirs(MUSICAS, exist_ok=True)
    return sorted((f for f in os.listdir(MUSICAS) if f.lower().endswith(EXTENSOES)), key=str.lower)


def importar_musica(origem):
    """Copia um arquivo do computador pra dentro do app e devolve o nome dele lá dentro."""
    os.makedirs(MUSICAS, exist_ok=True)
    nome = os.path.basename(origem)
    raiz, ext = os.path.splitext(nome)
    destino = os.path.join(MUSICAS, nome)
    n = 2
    while os.path.exists(destino):
        if os.path.getsize(destino) == os.path.getsize(origem):
            return os.path.basename(destino)  # já importada antes
        destino = os.path.join(MUSICAS, f"{raiz} ({n}){ext}")
        n += 1
    shutil.copy2(origem, destino)
    return os.path.basename(destino)


def caminho_musica(nome, cfg):
    nome = nome or cfg.get("musica_padrao", "")
    if not nome:
        return None
    nome = os.path.expanduser(nome)
    for c in (nome, os.path.join(MUSICAS, nome), os.path.join(PASTA, nome)):
        if os.path.isabs(c) and os.path.isfile(c):
            return c
    return None


def som_do_lembrete(l, cfg):
    """(caminho, pausa entre repetições em segundos) — ou (None, 0) se silencioso."""
    if l["som"] == "silencioso":
        return None, 0
    if l["som"] == "suave":
        return (SOM_SUAVE if os.path.exists(SOM_SUAVE) else None), 6
    return caminho_musica(l.get("musica"), cfg), 0


class Tocador:
    """Toca um arquivo com o afplay do macOS, repetindo (com pausa opcional) até mandarem parar."""

    def __init__(self, caminho, volume=80, repetir=True, pausa=0):
        self.caminho, self.volume, self.repetir, self.pausa = caminho, volume, repetir, pausa
        self.proc = None
        self.parado = threading.Event()

    def tocar(self):
        if not self.caminho:
            return
        self.parado.clear()
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while not self.parado.is_set():
            self.proc = subprocess.Popen(["afplay", "-v", str(self.volume / 100), self.caminho])
            self.proc.wait()
            if not self.repetir or self.parado.wait(self.pausa):
                break

    def parar(self):
        self.parado.set()
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()


# ---------- regras de horário ----------

def _minutos(hhmm):
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def horarios_do_dia(l):
    """Todos os horários (HH:MM) em que o lembrete toca num dia em que ele vale."""
    iv = l["intervalo"]
    if not iv["ativo"]:
        return list(l["horas"])
    inicio = _minutos(l["horas"][0])
    passo = max(5, int(iv["minutos"]))
    fim = max(inicio, _minutos(iv["ate"]))
    return [f"{m // 60:02d}:{m % 60:02d}" for m in range(inicio, fim + 1, passo)]


def vale_no_dia(l, dia):
    rep = l["repeticao"]
    if rep == "todo_dia":
        return True
    if rep == "dias_uteis":
        return dia.weekday() < 5
    if rep == "dias_semana":
        return dia.weekday() in l["dias"]
    return dia.isoformat() == l["data"]


def ocorre_em(lembrete, quando):
    """O lembrete deve tocar neste minuto exato?"""
    return quando.strftime("%H:%M") in horarios_do_dia(lembrete) and vale_no_dia(lembrete, quando.date())


def proxima_ocorrencia(l, agora=None):
    """Próximo datetime em que o lembrete toca (ou None)."""
    if not l["ativo"]:
        return None
    agora = (agora or datetime.now()).replace(second=0, microsecond=0)
    for d in range(0, 9):
        dia = date.fromordinal(agora.date().toordinal() + d)
        if not vale_no_dia(l, dia):
            continue
        for hhmm in sorted(horarios_do_dia(l)):
            h, m = map(int, hhmm.split(":"))
            quando = datetime(dia.year, dia.month, dia.day, h, m)
            if quando > agora:
                return quando
    return None


def fmt_minutos(m):
    m = int(m)
    if m < 60:
        return f"{m} min"
    return f"{m // 60}h{m % 60:02d}" if m % 60 else f"{m // 60}h"


def fmt_hora(hhmm):
    h, m = hhmm.split(":")
    return f"{int(h)}h{m if m != '00' else ''}"


def descrever_quando(l):
    if l["repeticao"] == "todo_dia":
        base = "Diário"
    elif l["repeticao"] == "dias_uteis":
        base = "Dias úteis"
    elif l["repeticao"] == "dias_semana":
        dias = sorted(l["dias"])
        base = "Fim de semana" if dias == [5, 6] else (", ".join(DIAS[d] for d in dias) or "Nenhum dia")
    else:
        try:
            base = "Só em " + datetime.strptime(l["data"], "%Y-%m-%d").strftime("%d/%m")
        except ValueError:
            base = "Data inválida"
    iv = l["intervalo"]
    if iv["ativo"]:
        return f"{base} · a cada {fmt_minutos(iv['minutos'])} até {fmt_hora(iv['ate'])}"
    if len(l["horas"]) > 1:
        return f"{base} · {', '.join(fmt_hora(h) for h in l['horas'])}"
    return base


def descrever_som(l):
    return {"suave": "Suave", "silencioso": "Silencioso"}.get(l["som"], "Música")


def descrever_tarefa(l):
    """Rótulo curto da tarefa, para o chip do cartão."""
    t = l["tarefa"]
    return {
        "nenhuma": "Ler",
        "conta": "Contas",
        "frase": "Copiar mantra" if t["frase_fonte"] == "mantra" else "Frase",
        "pergunta": "Pergunta",
        "segurar": "Segurar",
        "nota": "Nota",
    }.get(t["tipo"], "Ler")


# ---------- modo não perturbe ----------

# ligado sozinho porque um app da lista "automático" está na frente (escrito pelo vigia)
ESTADO_NP_AUTO = os.path.join(PASTA, "nao_perturbe_auto.json")


def nao_perturbe_info(cfg=None, agora=None):
    """Situação do não perturbe: ativo, por quê e até quando."""
    cfg = cfg or carregar_config()
    agora = agora or datetime.now()
    np = cfg["nao_perturbe"]
    if np.get("indefinido"):
        return {"ativo": True, "motivo": "manual", "indefinido": True, "ate": None, "resta_min": None, "app": None}
    if np.get("ate") and datetime.fromisoformat(np["ate"]) > agora:
        resta = int((datetime.fromisoformat(np["ate"]) - agora).total_seconds() // 60) + 1
        return {"ativo": True, "motivo": "manual", "indefinido": False, "ate": np["ate"], "resta_min": resta, "app": None}
    auto = ler_json(ESTADO_NP_AUTO, {})
    if np["auto"].get("ativo") and auto.get("app"):
        return {"ativo": True, "motivo": "auto", "indefinido": False, "ate": None, "resta_min": None, "app": auto["app"]}
    return {"ativo": False, "motivo": None, "indefinido": False, "ate": None, "resta_min": None, "app": None}


def nao_perturbe_ativo(cfg=None, agora=None):
    return nao_perturbe_info(cfg, agora)["ativo"]


# compatibilidade com o nome antigo
pausado = nao_perturbe_ativo


def definir_nao_perturbe(como):
    """como: '30', '60', '120' (minutos), 'indefinido', 'amanha' ou 'desligar'."""
    cfg = carregar_config()
    np = cfg["nao_perturbe"]
    agora = datetime.now()
    np["indefinido"] = como == "indefinido"
    if como == "amanha":
        amanha = date.fromordinal(agora.date().toordinal() + 1)
        np["ate"] = datetime(amanha.year, amanha.month, amanha.day, 6, 0).isoformat(timespec="minutes")
    elif como.isdigit():
        from datetime import timedelta
        np["ate"] = (agora + timedelta(minutes=int(como))).isoformat(timespec="minutes")
    else:
        np["ate"] = None
    if como == "desligar" and ler_json(ESTADO_NP_AUTO, {}).get("app"):
        # desligado na mão: o automático só volta quando o app sair e entrar de novo na frente
        estado = ler_json(ESTADO_NP_AUTO, {})
        salvar_json(ESTADO_NP_AUTO, {"app": None, "ignorar": estado.get("app")})
    salvar_config(cfg)
    return nao_perturbe_info(cfg)


def texto_nao_perturbe(info):
    if not info["ativo"]:
        return ""
    if info["motivo"] == "auto":
        return f"enquanto {info['app']} estiver na frente"
    if info["indefinido"]:
        return "até você desligar"
    m = info["resta_min"]
    if m >= 600:
        return "até amanhã, " + info["ate"][11:16]
    return f"faltam {m} min" if m < 60 else f"faltam {m // 60}h{m % 60:02d}"


# ---------- texto ----------

def sem_acentos(s):
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn").lower()


# ---------- processos ----------

def python_do_app():
    """O Python de dentro do Lembretes.app (assim o macOS mostra "Lembretes", não "Python")."""
    embutido = "/Applications/Lembretes.app/Contents/MacOS/lembretes-python"
    return embutido if os.path.exists(embutido) else sys.executable


AJUDANTE_POPUP = "/Applications/Lembretes.app/Contents/Helpers/Lembretes.app"


def abrir_popup(script, *args):
    """Abre um pop-up (alarme, aviso) em outro processo.

    Vai pelo `open` (LaunchServices) usando o mini-app de dentro do Lembretes.app: é o jeito que o macOS
    permite um pop-up aberto pelo serviço em segundo plano ganhar o foco do teclado."""
    if os.path.isdir(AJUDANTE_POPUP):
        return subprocess.Popen(["open", "-n", "-a", AJUDANTE_POPUP, "--args", script, *args])
    return subprocess.Popen([python_do_app(), script, *args])


def abrir_alarme(lembrete):
    return abrir_popup(ALARME, "--json", json.dumps(lembrete, ensure_ascii=False))


def servico_rodando():
    r = subprocess.run(["launchctl", "list", SERVICO], capture_output=True, text=True)
    return r.returncode == 0 and '"PID"' in r.stdout


def tela_principal(cfg=None):
    return os.path.join(UI, "app.html")


def pagina(nome, cfg=None):
    """Caminho de uma página da interface (ui/)."""
    return os.path.join(UI, nome)


# ---------- backup ----------

ARQUIVOS_DADOS = ("lembretes.json", "config.json", "mantras.json", "perguntas.json", "diario.json",
                  "notas_pausa.json", "anotacoes.json", "rotina.json")


def fazer_backup(motivo="auto"):
    """Guarda todos os arquivos de dados num JSON só e mantém as músicas espelhadas."""
    os.makedirs(os.path.join(BACKUPS, "musicas"), exist_ok=True)
    for nome in listar_musicas():
        destino = os.path.join(BACKUPS, "musicas", nome)
        if not os.path.exists(destino):
            shutil.copy2(os.path.join(MUSICAS, nome), destino)
    agora = datetime.now()
    dados = {"versao": 2, "criado_em": agora.isoformat(timespec="seconds"), "motivo": motivo,
             "arquivos": {n: ler_json(arquivo(n), None) for n in ARQUIVOS_DADOS}}
    caminho = os.path.join(BACKUPS, f"backup {agora:%Y-%m-%d %Hh%Mm%Ss}.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    for velho in listar_backups()[MAX_BACKUPS:]:
        os.remove(os.path.join(BACKUPS, velho))
    return caminho


def listar_backups():
    if not os.path.isdir(BACKUPS):
        return []
    return sorted((f for f in os.listdir(BACKUPS) if f.startswith("backup ") and f.endswith(".json")), reverse=True)


def ler_backup(caminho):
    dados = ler_json(caminho, None)
    if not isinstance(dados, dict) or "arquivos" not in dados:
        raise ValueError("Esse arquivo não é um backup da versão atual do Lembretes.")
    return dados


def restaurar_backup(caminho):
    dados = ler_backup(caminho)
    fazer_backup("antes de restaurar")
    pasta_musicas = os.path.join(os.path.dirname(caminho), "musicas")
    if os.path.isdir(pasta_musicas):
        os.makedirs(MUSICAS, exist_ok=True)
        for nome in os.listdir(pasta_musicas):
            if not os.path.exists(os.path.join(MUSICAS, nome)):
                shutil.copy2(os.path.join(pasta_musicas, nome), os.path.join(MUSICAS, nome))
    for nome, conteudo in dados["arquivos"].items():
        if nome in ARQUIVOS_DADOS and conteudo is not None:
            salvar_json(arquivo(nome), conteudo)


# ---------- menus da janela ----------

MENU_PT = {
    "cocoa.menu.about": "Sobre", "cocoa.menu.services": "Serviços", "cocoa.menu.view": "Visualizar",
    "cocoa.menu.edit": "Editar", "cocoa.menu.hide": "Ocultar", "cocoa.menu.hideOthers": "Ocultar Outros",
    "cocoa.menu.showAll": "Mostrar Tudo", "cocoa.menu.quit": "Encerrar",
    "cocoa.menu.fullscreen": "Tela Cheia", "cocoa.menu.cut": "Recortar", "cocoa.menu.copy": "Copiar",
    "cocoa.menu.paste": "Colar", "cocoa.menu.selectAll": "Selecionar Tudo",
}


# ---------- técnicas rápidas (aparecem dentro da Pausa) ----------

HABILIDADES = [
    {"id": "intensidade", "titulo": "Baixar a intensidade", "subtitulo": "Quando a emoção está alta", "itens": [
        ["Água fria", "Lavar o rosto com água gelada por alguns segundos."],
        ["Mexer o corpo", "Um minuto de movimento forte: polichinelos, subir escada."],
        ["Respiração longa", "Soltar o ar mais devagar do que puxa (4 entrando, 7 saindo)."],
        ["Tensionar e soltar", "Contrair um grupo de músculos, segurar e relaxar devagar."],
    ]},
    {"id": "antes", "titulo": "Antes de agir", "subtitulo": "Para não decidir no impulso", "itens": [
        ["Parar", "Não faz nada ainda."],
        ["Dar um passo atrás", "Levanta, sai da tela, respira."],
        ["Observar", "O que estou sentindo? O que está acontecendo de fato?"],
        ["Seguir com calma", "O que me aproxima de quem eu quero ser?"],
    ]},
    {"id": "aceitar", "titulo": "Aceitar o que é", "subtitulo": "Para o que não dá para mudar agora", "itens": [
        ["Aceitar não é aprovar", "Reconhecer um fato não quer dizer concordar com ele."],
        ["Menos briga", "Parte do cansaço vem de lutar contra o que já aconteceu."],
    ]},
]
