#!/bin/bash
# Remove o app e o serviço. Seus dados (pasta data/) ficam onde estão.
PLIST="$HOME/Library/LaunchAgents/com.lembretes.app.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
rm -rf "/Applications/Lembretes.app"
echo "✓ Lembretes removido. Seus dados continuam na pasta data/ do projeto."
