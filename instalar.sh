#!/bin/bash
# Instala o Lembretes: cria o app em /Applications e o serviço que dispara os alarmes (LaunchAgent).
# Uso: ./instalar.sh     (rode de dentro da pasta do projeto)
set -euo pipefail

PROJETO="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/Lembretes.app"
AJUDANTE="$APP/Contents/Helpers/Lembretes.app"
PLIST="$HOME/Library/LaunchAgents/com.lembretes.app.plist"

PY="$(command -v python3 || true)"
[ -z "$PY" ] && { echo "Precisa do Python 3 (python.org)."; exit 1; }
echo "→ Instalando dependências (pywebview)…"
"$PY" -m pip install --quiet -r "$PROJETO/requirements.txt"

# O app usa uma cópia do executável do Python dentro do pacote: assim o macOS mostra "Lembretes", não "Python".
PREFIXO="$("$PY" -c 'import sys; print(sys.prefix)')"
BINARIO="$PREFIXO/Resources/Python.app/Contents/MacOS/Python"     # Python do python.org (framework)
[ -x "$BINARIO" ] || BINARIO="$("$PY" -c 'import sys, os; print(os.path.realpath(sys.executable))')"

echo "→ Gerando os sons…"
mkdir -p "$PROJETO/musicas"
"$PY" "$PROJETO/gerar_musica.py" >/dev/null

echo "→ Montando $APP…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$AJUDANTE/Contents/MacOS" "$AJUDANTE/Contents/Resources"
cp "$BINARIO" "$APP/Contents/MacOS/lembretes-python"
cp "$BINARIO" "$AJUDANTE/Contents/MacOS/lembretes-python"
cp "$PROJETO/ui/icone.icns" "$APP/Contents/Resources/Lembretes.icns"
cp "$PROJETO/ui/icone.icns" "$AJUDANTE/Contents/Resources/Lembretes.icns"

cat > "$APP/Contents/MacOS/Lembretes" <<SCRIPT
#!/bin/bash
AQUI="\$(cd "\$(dirname "\$0")" && pwd)"
launchctl list com.lembretes.app >/dev/null 2>&1 || launchctl load -w "\$HOME/Library/LaunchAgents/com.lembretes.app.plist"
exec "\$AQUI/lembretes-python" "$PROJETO/gerenciador.py"
SCRIPT
cat > "$AJUDANTE/Contents/MacOS/Lembrete" <<'SCRIPT'
#!/bin/bash
# Abre os pop-ups (alarme, Pausa, avisos). O serviço chama via `open`, para o macOS dar o foco a eles.
AQUI="$(cd "$(dirname "$0")" && pwd)"
exec "$AQUI/lembretes-python" "$@"
SCRIPT
chmod +x "$APP/Contents/MacOS/Lembretes" "$AJUDANTE/Contents/MacOS/Lembrete"

info() {  # $1 = pasta do pacote, $2 = identificador, $3 = executável
cat > "$1/Contents/Info.plist" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Lembretes</string>
  <key>CFBundleDisplayName</key><string>Lembretes</string>
  <key>CFBundleIdentifier</key><string>$2</string>
  <key>CFBundleExecutable</key><string>$3</string>
  <key>CFBundleIconFile</key><string>Lembretes</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.1</string>
  <key>CFBundleVersion</key><string>2.1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>O Lembretes lê só o endereço da aba ativa para perceber quando você abre um site gatilho e oferecer a Pausa. Nada é guardado nem enviado.</string>
</dict></plist>
PLISTXML
}
info "$APP" "com.lembretes.app.gerenciador" "Lembretes"
info "$AJUDANTE" "com.lembretes.app.popup" "Lembrete"
codesign --force --sign - "$AJUDANTE" >/dev/null 2>&1 || true
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo "→ Ligando o serviço dos alarmes (começa junto com o Mac)…"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.lembretes.app</string>
  <key>ProgramArguments</key><array>
    <string>$AJUDANTE/Contents/MacOS/lembretes-python</string><string>$PROJETO/servico.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PROJETO/servico.log</string>
  <key>StandardErrorPath</key><string>$PROJETO/erros.log</string>
</dict></plist>
PLISTXML
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "✓ Pronto! Abra o Lembretes pela pasta Aplicativos."
