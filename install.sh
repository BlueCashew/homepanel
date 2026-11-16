#!/bin/sh
# Installeert het huispaneel op de Pi via SSH, vanaf je Mac.
# Gebruik:  sh install.sh gebruiker@adres-van-de-pi    (bijvoorbeeld pi@homebridge.local)
set -e
TARGET="${1:-pi@homebridge.local}"
cd "$(dirname "$0")"
echo "Kopieren en installeren op $TARGET. Je wordt een keer om het wachtwoord van de Pi gevraagd."
tar czf - server.js start.js public huispaneel.service config.example.json README.md | ssh "$TARGET" '
  set -e
  mkdir -p "$HOME/huispaneel"
  tar xzf - -C "$HOME/huispaneel"
  cd "$HOME/huispaneel"
  [ -f config.json ] || cp config.example.json config.json
  chmod 600 config.json
  NODE=/opt/homebridge/bin/node
  [ -x "$NODE" ] || NODE=$(command -v node)
  sed -e "s|^User=.*|User=$USER|" \
      -e "s|^WorkingDirectory=.*|WorkingDirectory=$HOME/huispaneel|" \
      -e "s|^ExecStart=.*|ExecStart=$NODE --max-old-space-size=64 $HOME/huispaneel/start.js|" \
      huispaneel.service | sudo tee /etc/systemd/system/huispaneel.service >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable huispaneel >/dev/null 2>&1
  sudo systemctl restart huispaneel
  sleep 4
  echo "Dienst: $(systemctl is-active huispaneel)"
  curl -s -o /dev/null -w "Paneel antwoordt met HTTP %{http_code}\n" http://127.0.0.1:8600/ || echo "Paneel antwoordt nog niet; kijk met: journalctl -u huispaneel -n 30"
'
HOST="${TARGET#*@}"
echo
echo "Klaar. Open nu http://$HOST:8600/setup om de Homebridge-login en je plaats in te vullen."
echo "Het paneel zelf staat op http://$HOST:8600"
