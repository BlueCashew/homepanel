# Wifi na een stroomstoring

Het Homebridge-image start `wifi-connect` als de Pi bij het opstarten niet binnen 20 seconden wifi heeft.
Dat zet een hotspot (192.168.4.1) aan die blijft staan tot iemand het wifi instelt. Na een korte
stroomstoring, als de router trager opstart dan de Pi, is de Pi dan dagenlang onbereikbaar.

Twee aanvullingen, zonder `wifi-connect` zelf te wijzigen:

- `wacht-op-wifi.sh` + `wifi-connect-wacht.conf`: wacht tot 3 minuten op het eigen wifi voordat de hotspot start.
- `wifi-waakhond.sh` + `.service` + `.timer`: elke 5 minuten. Draait de hotspot 10 minuten zonder gebruikers,
  dan stopt hij en probeert de Pi het eigen wifi (NetworkManager-verbinding `preconfigured`). Lukt dat niet en
  is er ook geen hotspot, dan komt de hotspot terug zodat je het wifi kunt instellen.

Installeren op de Pi:

```sh
sudo install -m 755 wacht-op-wifi.sh wifi-waakhond.sh /usr/local/sbin/
sudo mkdir -p /etc/systemd/system/wifi-connect.service.d
sudo install -m 644 wifi-connect-wacht.conf /etc/systemd/system/wifi-connect.service.d/huispaneel-wacht.conf
sudo install -m 644 wifi-waakhond.service wifi-waakhond.timer /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now wifi-waakhond.timer
```

Logboek: `journalctl -u wifi-waakhond -u wifi-connect`.
