"""Vigia — roda dentro do serviço, no laço de eventos do macOS.

1. Atalho global ⌥⌘V (RegisterEventHotKey/Carbon): o sistema avisa só quando ESSA combinação é apertada;
   o app não vê nenhuma outra tecla, por isso não precisa de permissão.
2. App em primeiro plano (NSWorkspace): se for um app gatilho (configurado em Ajustes), abre a "Pausa";
   se for um app da lista do não perturbe automático (jogos, chamadas…), liga o não perturbe enquanto ele estiver na frente.
3. Navegador (opcional, desligado por padrão): com o navegador na frente, lê SÓ o endereço da aba ativa
   e compara o domínio com os sites gatilho configurados. Nada é guardado.
4. Ícone na barra de menus com o modo não perturbe (30 min, 1 h, 2 h, até desligar, até amanhã).
"""
import ctypes
import os
import subprocess
from datetime import datetime, timedelta
from urllib.parse import urlparse

import objc
from AppKit import (NSApplication, NSImage, NSMenu, NSMenuItem, NSStatusBar, NSVariableStatusItemLength,
                    NSWorkspace)
from Foundation import NSAppleScript, NSObject, NSTimer
from PyObjCTools import AppHelper

from comum import (ESTADO_NP_AUTO, PASTA, abrir_popup, carregar_config, definir_nao_perturbe, ler_json,
                   nao_perturbe_info, salvar_json, texto_nao_perturbe)

PAUSA = os.path.join(PASTA, "pausa.py")
ESTADO_VIGIA = os.path.join(PASTA, "vigia.json")
# navegadores e o AppleScript que devolve o endereço da aba ativa
NAVEGADORES = {
    "com.apple.Safari": "URL of current tab of front window",
    "com.google.Chrome": "URL of active tab of front window",
    "com.brave.Browser": "URL of active tab of front window",
    "com.microsoft.edgemac": "URL of active tab of front window",
    "company.thebrowser.Browser": "URL of active tab of front window",   # Arc
    "com.vivaldi.Vivaldi": "URL of active tab of front window",
}
INTERVALO_NAVEGADOR_S = 2.5

# ---------- atalho global (Carbon) ----------
_carbon = ctypes.CDLL("/System/Library/Frameworks/Carbon.framework/Carbon")


def _fourcc(s):
    return int.from_bytes(s.encode("ascii"), "big")


class _EventHotKeyID(ctypes.Structure):
    _fields_ = [("signature", ctypes.c_uint32), ("id", ctypes.c_uint32)]


class _EventTypeSpec(ctypes.Structure):
    _fields_ = [("eventClass", ctypes.c_uint32), ("eventKind", ctypes.c_uint32)]


_HandlerProc = ctypes.CFUNCTYPE(ctypes.c_int32, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
_carbon.GetApplicationEventTarget.restype = ctypes.c_void_p
_carbon.InstallEventHandler.argtypes = [ctypes.c_void_p, _HandlerProc, ctypes.c_uint32,
                                        ctypes.POINTER(_EventTypeSpec), ctypes.c_void_p, ctypes.c_void_p]
_carbon.RegisterEventHotKey.argtypes = [ctypes.c_uint32, ctypes.c_uint32, _EventHotKeyID, ctypes.c_void_p,
                                        ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p)]

TECLA_V = 9                    # kVK_ANSI_V
CMD, OPCAO = 1 << 8, 1 << 11   # cmdKey, optionKey


def registrar_atalho(ao_apertar):
    """Registra ⌥⌘V. Devolve o código do macOS (0 = deu certo)."""
    def tratador(_chamada, _evento, _dados):
        try:
            ao_apertar()
        except Exception as e:
            print("Erro no atalho:", e, flush=True)
        return 0
    registrar_atalho._tratador = _HandlerProc(tratador)  # guarda a referência (senão o Python a recolhe)
    alvo = _carbon.GetApplicationEventTarget()
    tipo = _EventTypeSpec(_fourcc("keyb"), 5)            # kEventClassKeyboard, kEventHotKeyPressed
    _carbon.InstallEventHandler(alvo, registrar_atalho._tratador, 1, ctypes.byref(tipo), None, None)
    registrar_atalho._ref = ctypes.c_void_p()
    return _carbon.RegisterEventHotKey(TECLA_V, CMD | OPCAO, _EventHotKeyID(_fourcc("LMBR"), 1),
                                       alvo, 0, ctypes.byref(registrar_atalho._ref))


# ---------- abrir a "Pausa" ----------

def pausa_aberta():
    return subprocess.run(["pgrep", "-f", PAUSA], capture_output=True).returncode == 0


def abrir_pausa(origem, detalhe=""):
    if pausa_aberta():
        return False
    abrir_popup(PAUSA, "--origem", origem, "--detalhe", detalhe)
    return True


# ---------- regras ----------

def _contem(nome, lista):
    nome = (nome or "").lower()
    return any(x.strip().lower() and x.strip().lower() in nome for x in lista)


def eh_app_gatilho(bundle_id, nome, cfg=None):
    cfg = cfg or carregar_config()
    return _contem(nome, cfg["gatilhos"]["apps"])


def site_gatilho(url, cfg=None):
    """Devolve o site da lista que bate com o endereço (ou None). Compara só o domínio."""
    cfg = cfg or carregar_config()
    host = (urlparse(url or "").hostname or "").lower()
    for site in cfg["gatilhos"]["sites"]:
        s = site.strip().lower().removeprefix("https://").removeprefix("http://").split("/")[0]
        if s and (host == s or host.endswith("." + s)):
            return s
    return None


def gatilho_disparou(detalhe, agora=None, cfg=None):
    """Um gatilho apareceu (app ou site). Abre a "Pausa" se as regras deixarem. Devolve se abriu."""
    cfg = cfg or carregar_config()
    det = cfg["deteccao"]   # liga/desliga e intervalo mínimo
    if not det.get("ativo", True):
        return False
    if nao_perturbe_info(cfg)["ativo"] and not cfg["nao_perturbe"].get("pausa_excecao", True):
        return False
    agora = agora or datetime.now()
    estado = ler_json(ESTADO_VIGIA, {})
    ultimo = estado.get("ultimo_gatilho")
    if ultimo and agora - datetime.fromisoformat(ultimo) < timedelta(minutes=int(det.get("intervalo_min", 20))):
        return False
    estado["ultimo_gatilho"] = agora.isoformat(timespec="seconds")
    salvar_json(ESTADO_VIGIA, estado)
    return abrir_pausa("gatilho", detalhe)


def atualizar_np_auto(bundle_id, nome, cfg=None):
    """Liga o não perturbe automático enquanto um app da lista estiver na frente; desliga quando sair."""
    cfg = cfg or carregar_config()
    auto = cfg["nao_perturbe"]["auto"]
    estado = ler_json(ESTADO_NP_AUTO, {})
    na_lista = auto.get("ativo") and _contem(nome, auto.get("apps", []))
    if na_lista:
        if estado.get("ignorar") == nome:     # desligado na mão enquanto este app estava na frente
            return False
        if estado.get("app") != nome:
            salvar_json(ESTADO_NP_AUTO, {"app": nome, "desde": datetime.now().isoformat(timespec="seconds")})
        return True
    # o app daqui não faz parte da lista: o automático (e o "ignorar") acabam quando o app da lista sai da frente
    if estado.get("app") or estado.get("ignorar"):
        if nome and nome not in ("Lembretes",):
            salvar_json(ESTADO_NP_AUTO, {})
    return False


# ---------- navegador ----------

def endereco_da_aba(bundle_id):
    """Endereço da aba ativa (só ele). Pede ao navegador via Apple Events — o macOS pergunta uma vez."""
    pedido = NAVEGADORES.get(bundle_id)
    if not pedido:
        return None
    script = NSAppleScript.alloc().initWithSource_(f'tell application id "{bundle_id}" to get {pedido}')
    resultado, erro = script.executeAndReturnError_(None)
    if erro or resultado is None:
        return None
    return resultado.stringValue()


# ---------- ponte com o macOS ----------

class _Vigia(NSObject):
    def init(self):
        self = objc.super(_Vigia, self).init()
        self.app_na_frente = (None, None)
        self.timer_navegador = None
        self.site_atual = None
        self.item = None
        return self

    # app veio para a frente
    def appAtivado_(self, nota):
        app = nota.userInfo().get("NSWorkspaceApplicationKey")
        bid = app.bundleIdentifier() if app else None
        nome = app.localizedName() if app else None
        self.app_na_frente = (bid, nome)
        try:
            cfg = carregar_config()
            atualizar_np_auto(bid, nome, cfg)
            if eh_app_gatilho(bid, nome, cfg):
                gatilho_disparou(nome, cfg=cfg)
            self.vigiarNavegador_(bid in NAVEGADORES and cfg["gatilhos"].get("ler_navegador"))
        except Exception as e:
            print("Erro no vigia:", repr(e), flush=True)
        self.atualizarMenu_(None)

    def vigiarNavegador_(self, ligar):
        if self.timer_navegador:
            self.timer_navegador.invalidate()
            self.timer_navegador = None
        self.site_atual = None
        if ligar:
            self.olharAba_(None)
            self.timer_navegador = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
                INTERVALO_NAVEGADOR_S, self, "olharAba:", None, True)

    def olharAba_(self, _timer):
        bid, _ = self.app_na_frente
        try:
            site = site_gatilho(endereco_da_aba(bid))
        except Exception as e:
            print("Erro lendo a aba:", repr(e), flush=True)
            return
        if site and site != self.site_atual:   # só quando ENTRA no site (não fica disparando)
            gatilho_disparou(site)
        self.site_atual = site

    # ---- barra de menus ----
    def montarMenu(self):
        barra = NSStatusBar.systemStatusBar()
        self.item = barra.statusItemWithLength_(NSVariableStatusItemLength)
        self.item.button().setToolTip_("Lembretes")
        self.atualizarMenu_(None)
        NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(20, self, "atualizarMenu:", None, True)

    def atualizarMenu_(self, _timer):
        if not self.item:
            return
        info = nao_perturbe_info()
        simbolo = "moon.fill" if info["ativo"] else "bell"
        img = NSImage.imageWithSystemSymbolName_accessibilityDescription_(simbolo, "Lembretes")
        if img:
            img.setTemplate_(True)
        botao = self.item.button()
        botao.setImage_(img)
        resta = ""
        if info["ativo"] and info["resta_min"] is not None and info["resta_min"] < 600:
            m = info["resta_min"]
            resta = f" {m} min" if m < 60 else f" {m // 60}h{m % 60:02d}"
        botao.setTitle_(resta)
        menu = NSMenu.alloc().init()
        menu.setAutoenablesItems_(False)

        def add(titulo, acao=None, rep=""):
            it = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(titulo, acao, "")
            if acao:
                it.setTarget_(self)
                it.setRepresentedObject_(rep)
            else:
                it.setEnabled_(False)
            menu.addItem_(it)
            return it

        if info["ativo"]:
            add("Não perturbe: " + texto_nao_perturbe(info))
            add("Desligar o não perturbe", "naoPerturbe:", "desligar")
        else:
            add("Alarmes ligados")
            add("Não perturbe por 30 min", "naoPerturbe:", "30")
            add("Não perturbe por 1 hora", "naoPerturbe:", "60")
            add("Não perturbe por 2 horas", "naoPerturbe:", "120")
            add("Não perturbe até eu desligar", "naoPerturbe:", "indefinido")
            add("Não perturbe até amanhã", "naoPerturbe:", "amanha")
        menu.addItem_(NSMenuItem.separatorItem())
        add("Pausa…", "pausa:")
        add("Abrir Lembretes", "abrirApp:")
        self.item.setMenu_(menu)

    def naoPerturbe_(self, item):
        definir_nao_perturbe(item.representedObject())
        self.atualizarMenu_(None)

    def pausa_(self, _item):
        abrir_pausa("atalho")

    def abrirApp_(self, _item):
        subprocess.Popen(["open", "-a", "/Applications/Lembretes.app"])


def rodar():
    """Bloqueia: roda o laço de eventos do macOS (chamar na thread principal)."""
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(1)  # acessório: sem ícone no Dock, mas pode ter ícone na barra de menus
    codigo = registrar_atalho(lambda: abrir_pausa("atalho"))
    print("Atalho ⌥⌘V:", "registrado" if codigo == 0 else f"falhou ({codigo})", flush=True)
    vigia = _Vigia.alloc().init()
    rodar._vigia = vigia
    NSWorkspace.sharedWorkspace().notificationCenter().addObserver_selector_name_object_(
        vigia, "appAtivado:", "NSWorkspaceDidActivateApplicationNotification", None)
    vigia.montarMenu()
    print("Ícone na barra de menus: ok", flush=True)
    AppHelper.runEventLoop(installInterrupt=False)
