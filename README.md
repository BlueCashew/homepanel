# Huispaneel

Dashboard voor een oude iPad (getest op de afmetingen van de iPad mini 1, 1024×768 liggend) als frontend voor Homebridge en Sonos.

- `server.js` draait op de Pi naast Homebridge. Geen npm-pakketten nodig, alleen Node.js.
- `public/` is de pagina die de iPad in Safari opent. Geschreven in ES5, zodat Safari op iOS 9 het aankan.

De server praat met drie dingen:

| Wat | Hoe |
| --- | --- |
| Homebridge | REST API van de Homebridge UI (`/api/accessories`, `/api/accessories/layout`) |
| Sonos | Lokaal via UPnP op poort 1400, zonder cloud of account |
| Weer | Open-Meteo, alleen als je coördinaten invult |

## Installeren op de Pi

**Vooraf:** zet in de Homebridge UI onder Settings de accessoirebediening ("Insecure mode") aan en herstart Homebridge. Zonder dit geeft Homebridge geen accessoires door.

### In één keer, vanaf je Mac

Download deze repo (Code → Download ZIP), pak hem uit, open Terminal en voer uit:

```
cd ~/Downloads/homepanel-main
sh install.sh pi@homebridge.local
```

Gebruik het adres en de gebruikersnaam van jouw Pi. Het script kopieert de bestanden via SSH, maakt de dienst aan en start hem. Je wordt één keer om het wachtwoord van de Pi gevraagd.

Open daarna `http://<adres-van-de-pi>:8600/setup` en vul daar in:

- de login van de Homebridge-webinterface (wordt alleen bewaard als Homebridge hem accepteert);
- de plaats waarvoor je het weer wilt zien.

### Met de hand

1. Kopieer de map naar de Pi: `scp -r huispaneel pi@<adres>:~/`
2. Op de Pi: `cd ~/huispaneel && cp config.example.json config.json`
3. Proefdraaien: `/opt/homebridge/bin/node start.js` (of `node start.js`) en open `http://<adres>:8600/setup`.
4. Automatisch starten: pas zo nodig gebruiker en paden aan in `huispaneel.service` en dan:
   ```
   sudo cp huispaneel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now huispaneel
   ```
   Logboek: `journalctl -u huispaneel -f`.

Instellingen staan in `config.json` op de Pi. Naast wat `/setup` invult kun je daar zetten:

- `sonos.host`: IP-adres van de soundbar, alleen nodig als de Sonos niet vanzelf gevonden wordt.
- `hide`: namen van accessoires die je niet op het paneel wilt, bijvoorbeeld `["Dummy schakelaar"]`.
- `homebridge.url`: alleen aanpassen als de Homebridge UI niet op dezelfde Pi op poort 8581 draait.

## Philips Hue rechtstreeks koppelen

Op `/setup` staat de knop **Koppel Hue**. Druk erop en druk daarna binnen een minuut op de ronde knop bovenop de Hue Bridge. Het paneel zoekt de bridge zelf; lukt dat niet, vul dan het IP-adres in.

Na het koppelen:

- komen de lampen rechtstreeks uit de bridge in plaats van via Homebridge (geen dubbele tegels);
- krijg je per Hue-kamer een tabblad met een tegel "Alle lampen", de lampen en de scènes uit de Hue-app;
- heeft lang indrukken op een lamp met instelbaar wit ook een schuif voor kleurtemperatuur.

Schakelaars, de thermostaat en andere Homebridge-accessoires blijven via Homebridge lopen. Met **Hue ontkoppelen** gaan de lampen weer via Homebridge.

De Hue Bridge gebruikt een eigen certificaat; het paneel controleert dat certificaat daarom niet. Dat is gebruikelijk voor lokale Hue-koppelingen.

## Apple TV

Het paneel bedient een Apple TV rechtstreeks, zonder Homebridge, via [pyatv](https://pyatv.dev). Op `/setup` staat de kaart **Apple TV**:

1. **Onderdelen installeren** zet pyatv (met srptools 1.x; versie 2 breekt het koppelen) in een eigen Python-omgeving in `data/pyatv` (op een Pi Zero 2 duurt dat een paar minuten). Nodig: Python 3 met `venv`, een 64-bit systeem.
2. **Zoek Apple TV** en daarna **Koppel**. Op de tv verschijnt een code van 4 cijfers; vul die in.
3. Daarna volgt een tweede code (AirPlay). Daarmee ziet het paneel wat er speelt, met afbeelding. **Overslaan** kan: de bediening werkt dan wel, alleen "nu speelt" niet.

Na het koppelen staat er rechts van het beginscherm een Apple TV-scherm met pijltjes, OK, Terug, Home, afspelen/pauze, volume, aan/uit en een lijst met apps. Vasthouden herhaalt de pijltjes en het volume. In de editor staat ook een Apple TV-tegel voor het beginscherm.

De koppelgegevens staan in `data/atv.json` (alleen leesbaar voor de eigenaar), niet in `config.json`. Het hulpproces `atv.py` houdt de verbinding open; valt die weg, dan probeert het paneel het vanzelf opnieuw.

## Bijwerken

Het paneel werkt zichzelf bij vanaf deze GitHub-repo. Op `/setup` staat onder **Bijwerken** welke versie draait en of er een nieuwere is. Met de knop gaat het zo:

1. De Pi downloadt de nieuwste versie van de `main`-branch.
2. Hij controleert de bestanden en start de nieuwe versie eerst op proef op een andere poort.
3. Werkt die proefstart, dan schakelt hij over en herstart de dienst. Werkt hij niet, dan blijft alles zoals het was.
4. Start de nieuwe versie na het overschakelen toch niet, dan zet `start.js` na drie pogingen automatisch de vorige versie terug uit `.backup/`.

De iPad laadt na een update vanzelf de nieuwe pagina. `config.json` wordt bij een update nooit aangeraakt. Met het vinkje **Elke nacht automatisch bijwerken** gebeurt dit vanzelf tussen 4 en 5 uur.

Een andere repo of branch gebruiken kan in `config.json`:

```json
"update": { "repo": "gebruiker/huispaneel", "branch": "main", "auto": false }
```

Verandert `huispaneel.service` in een update, dan moet je die zelf opnieuw installeren (`sudo cp huispaneel.service /etc/systemd/system/ && sudo systemctl daemon-reload`). De rest gaat vanzelf.

### Testen

```
node test/mock-test.js     # server tegen nagebootste Homebridge, Hue Bridge en Sonos
node test/update-test.js   # bijwerken, weigeren van een kapotte versie en terugdraaien
```

## De iPad instellen

1. Open in Safari `http://<ip-adres-van-de-pi>:8600`. Gebruik het IP-adres en `http://`, geen `https://`.
2. Deel-knop → **Zet op beginscherm**. Start het paneel daarna via dat icoon; dan is het schermvullend.
3. Instellingen → Scherm en helderheid → Automatisch slot → **Nooit**, en de iPad aan de lader.
4. Optioneel: Instellingen → Algemeen → Toegankelijkheid → **Begeleide toegang**, zodat niemand het paneel per ongeluk verlaat.

## Bediening

**Schermen (vegen):** Muziek ← **Beginscherm** → de kamers en zones die je aanzet.

- **Beginscherm:** een raster van 4×3 vakken met tegels van 1×1, 2×1, 1×2 of 2×2. Mogelijk zijn lampen, groepen ("Alle lampen"), scènes, schakelaars, de thermostaat (op 2×2 groot met − en +), een klok (analoog of digitaal), het weer en "Nu speelt".
- **Kamerschermen:** per kamer of zone alle tegels. In de instellingen onder *Schermen* zet je ze aan of uit en kies je de volgorde. Hue-zones staan standaard uit. Een groot klokscherm kan er ook bij.
- **Muziek:** wat er speelt, met bediening en volume, plus je Sonos-favorieten en Sonos-playlists om af te spelen. Zoeken in Apple Music of andere diensten kan niet; bewaar wat je wilt horen als favoriet in de Sonos-app.

**Tikken en vasthouden:**

- Tikken op een tegel schakelt aan/uit; een scène wordt geactiveerd.
- Lang indrukken op een lamp opent helderheid en, als de lamp dat kan, kleurtemperatuur.
- Sloten en garagedeuren vragen eerst om bevestiging.

**Indelen:** het potlood onderaan het beginscherm (of *Beginscherm indelen* in de instellingen) opent de editor:

- tik op een leeg vak om er iets op te zetten;
- tik op een tegel voor de grootte, verplaatsen, wisselen met een andere tegel of weghalen.

**Uiterlijk:** in de instellingen kies je een thema (Warm, Oceaan, Bos of Zand) en, los daarvan, de weergave: Licht, Donker of Automatisch. Automatisch werkt zoals op iOS: standaard donker van zonsondergang tot zonsopgang op je weerlocatie, of op een eigen schema met twee tijden.

## Uitproberen zonder Homebridge

```
node server.js --demo
```
Dit toont nepdata op `http://localhost:8600`.

## Goed om te weten

- Het paneel heeft zelf geen login: iedereen op je thuisnetwerk die het adres kent kan schakelen. Zet poort 8600 niet open naar internet.
- Het wachtwoord van Homebridge staat in `config.json` op de Pi en komt nooit op de iPad.
- `node test/mock-test.js` test de server tegen een nagebootste Homebridge, Hue Bridge en Sonos; `node test/update-test.js` test het bijwerken en terugdraaien.
