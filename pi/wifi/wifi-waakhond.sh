#!/bin/sh
# Huispaneel: laat de hotspot van wifi-connect niet dagenlang hangen.
# Elke 5 minuten (wifi-waakhond.timer):
#  - verbonden met het eigen wifi: niets doen;
#  - hotspot draait al 10 minuten en niemand is ermee verbonden: hotspot stoppen en het eigen wifi proberen;
#  - geen wifi en geen hotspot: het eigen wifi proberen, en lukt dat niet, de hotspot weer aanbieden.
VERBINDING="${VERBINDING:-preconfigured}"
verbonden() { nmcli -t -f STATE general 2>/dev/null | grep -q '^connected'; }

verbonden && exit 0

pid=$(pgrep -xo hostapd)
if [ -n "$pid" ]; then
  leeftijd=$(ps -o etimes= -p "$pid" | tr -d ' ')
  gasten=$(iw dev wlan0 station dump 2>/dev/null | grep -c '^Station')
  if [ "${leeftijd:-0}" -ge 600 ] && [ "${gasten:-0}" -eq 0 ]; then
    echo "Hotspot draait al ${leeftijd} s zonder gebruikers: stoppen en '$VERBINDING' opnieuw proberen."
    systemctl stop wifi-connect
    sleep 3
    nmcli device set wlan0 managed yes 2>/dev/null
    nmcli connection up "$VERBINDING" >/dev/null 2>&1
    if verbonden; then echo "Weer verbonden met het eigen wifi."; else echo "Nog geen wifi; volgende ronde opnieuw."; fi
  fi
  exit 0
fi

echo "Geen wifi en geen hotspot: '$VERBINDING' opnieuw proberen."
nmcli connection up "$VERBINDING" >/dev/null 2>&1
if verbonden; then
  echo "Weer verbonden met het eigen wifi."
else
  echo "Lukt niet; de hotspot wordt weer aangeboden zodat je het wifi kunt instellen."
  systemctl restart --no-block wifi-connect
fi
