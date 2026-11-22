#!/bin/sh
# Huispaneel: na een stroomstoring de router de tijd geven.
# wifi-connect wacht zelf maar 20 seconden en start dan een hotspot die blijft hangen.
# Dit script draait vóór wifi-connect en wacht tot 3 minuten op het eigen wifi.
i=0
while [ "$i" -lt "${WACHT:-180}" ]; do
  nmcli -t -f STATE general 2>/dev/null | grep -q '^connected' && exit 0
  sleep 2
  i=$((i + 2))
done
echo "Na ${WACHT:-180} s nog geen wifi; wifi-connect mag de hotspot starten."
exit 0
