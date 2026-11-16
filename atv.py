#!/usr/bin/env python3
"""Brug tussen het huispaneel (Node) en een Apple TV, via pyatv.

Het paneel start dit proces en praat ermee met één JSON-bericht per regel:
  in:  {"id": 1, "cmd": "key", "key": "up"}
  uit: {"id": 1, "ok": true, "result": ...}   of   {"event": "state", ...}

De verbinding blijft open, zodat een druk op een knop meteen doorkomt.
Koppelgegevens staan in het opslagbestand (eerste argument), niet in config.json.
"""
import asyncio
import base64
import json
import sys

import pyatv
from pyatv.const import DeviceState, OperatingSystem, PowerState, Protocol
from pyatv.interface import DeviceListener, PowerListener, PushListener
from pyatv.storage.file_storage import FileStorage

PROTOCOLS = {"companion": Protocol.Companion, "airplay": Protocol.AirPlay}
KEYS = {
    "up", "down", "left", "right", "select", "menu", "home", "top_menu",
    "play_pause", "play", "pause", "next", "previous", "skip_forward", "skip_backward",
    "volume_up", "volume_down", "control_center",
}
STATES = {
    DeviceState.Idle: "idle", DeviceState.Loading: "loading", DeviceState.Paused: "paused",
    DeviceState.Playing: "playing", DeviceState.Stopped: "stopped", DeviceState.Seeking: "playing",
}


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Bridge(PushListener, PowerListener, DeviceListener):
    def __init__(self, loop, storage_path):
        self.loop = loop
        self.storage = FileStorage(storage_path, loop)
        self.atv = None
        self.target = None          # identifier van de gekoppelde Apple TV
        self.pairing = None
        self.reconnecting = False
        self.state = {"connected": False}

    # ---------------------------------------------------------------- status
    def emit(self, **changes):
        self.state.update(changes)
        send(dict(self.state, event="state"))

    def playstatus_update(self, updater, playstatus):
        app = None
        try:
            a = self.atv.metadata.app if self.atv else None
            app = {"id": a.identifier, "name": a.name} if a else None
        except Exception:  # niet elke tvOS-versie meldt de app
            app = None
        self.emit(
            state=STATES.get(playstatus.device_state, "idle"),
            title=playstatus.title or "",
            artist=playstatus.artist or playstatus.series_name or "",
            album=playstatus.album or "",
            app=app,
            art=playstatus.hash if playstatus.title else "",
        )

    def playstatus_error(self, updater, exception):
        pass

    def powerstate_update(self, old_state, new_state):
        self.emit(power=power_name(new_state))

    def connection_lost(self, exception):
        self.lost()

    def connection_closed(self):
        self.lost()

    def lost(self):
        self.atv = None
        self.emit(connected=False)
        if self.target and not self.reconnecting:
            self.loop.create_task(self.reconnect())

    async def reconnect(self):
        self.reconnecting = True
        try:
            while self.target and not self.atv:
                await asyncio.sleep(10)
                try:
                    await self.connect(self.target)
                except Exception:
                    pass
        finally:
            self.reconnecting = False

    # -------------------------------------------------------------- opdrachten
    async def find(self, identifier=None, timeout=5):
        return await pyatv.scan(self.loop, timeout=timeout, identifier=identifier, storage=self.storage)

    async def cmd_scan(self, msg):
        out = []
        for conf in await self.find(timeout=int(msg.get("timeout", 5))):
            model = conf.device_info.model_str or ""
            if not conf.get_service(Protocol.Companion) or conf.device_info.operating_system != OperatingSystem.TvOS or "HomePod" in model:
                continue  # geen Apple TV (bijvoorbeeld een HomePod, Mac of AirPlay-speaker)
            paired = {}
            for name, proto in PROTOCOLS.items():
                svc = conf.get_service(proto)
                paired[name] = bool(svc and svc.credentials)
            out.append({
                "id": conf.identifier, "name": conf.name, "address": str(conf.address),
                "model": model, "paired": paired,
            })
        return out

    async def cmd_pair_begin(self, msg):
        if self.pairing:
            await self.pairing.close()
            self.pairing = None
        confs = await self.find(identifier=msg["device"])
        if not confs:
            raise RuntimeError("Apple TV niet gevonden")
        self.pairing = await pyatv.pair(confs[0], PROTOCOLS[msg["protocol"]], self.loop, storage=self.storage, name="Huispaneel")
        await self.pairing.begin()
        return {"pin": bool(self.pairing.device_provides_pin)}

    async def cmd_pair_finish(self, msg):
        if not self.pairing:
            raise RuntimeError("Er loopt geen koppeling")
        try:
            self.pairing.pin(str(msg["pin"]).strip())
            await self.pairing.finish()
            ok = self.pairing.has_paired
        finally:
            await self.pairing.close()
            self.pairing = None
        if not ok:
            raise RuntimeError("Koppelen mislukt; controleer de code op de tv")
        await self.storage.save()
        return {"paired": True}

    async def connect(self, identifier):
        confs = await self.find(identifier=identifier)
        if not confs:
            raise RuntimeError("Apple TV niet gevonden")
        atv = await pyatv.connect(confs[0], self.loop, storage=self.storage)
        self.atv = atv
        atv.listener = self
        atv.push_updater.listener = self
        atv.push_updater.start()
        atv.power.listener = self
        apps = []
        try:
            apps = sorted(({"id": a.identifier, "name": a.name} for a in await atv.apps.app_list()), key=lambda a: a["name"].lower())
        except Exception:
            apps = []
        self.emit(connected=True, name=confs[0].name, power=power_name(atv.power.power_state), apps=apps)

    async def cmd_connect(self, msg):
        self.target = msg["device"]
        if self.atv:
            self.atv.close()
            self.atv = None
        await self.connect(self.target)
        return {"connected": True}

    async def cmd_disconnect(self, msg):
        self.target = None
        if self.atv:
            self.atv.close()
            self.atv = None
        self.state = {"connected": False}
        return {}

    async def cmd_forget(self, msg):
        await self.cmd_disconnect(msg)
        for conf in await self.find(identifier=msg["device"]):
            for proto in PROTOCOLS.values():
                svc = conf.get_service(proto)
                if svc:
                    svc.credentials = None
            await self.storage.remove_settings(await self.storage.get_settings(conf))
        await self.storage.save()
        return {}

    def need(self):
        if not self.atv:
            raise RuntimeError("Geen verbinding met de Apple TV")
        return self.atv

    async def cmd_key(self, msg):
        atv, key = self.need(), msg["key"]
        if key == "turn_on":
            await atv.power.turn_on()
        elif key == "turn_off":
            await atv.power.turn_off()
        elif key in KEYS:
            await getattr(atv.remote_control, key)()
        else:
            raise RuntimeError("Onbekende toets")
        return {}

    async def cmd_launch(self, msg):
        await self.need().apps.launch_app(msg["app"])
        return {}

    async def cmd_artwork(self, msg):
        art = await self.need().metadata.artwork(width=int(msg.get("width", 512)))
        if not art or not art.bytes:
            return None
        return {"mime": art.mimetype or "image/jpeg", "data": base64.b64encode(art.bytes).decode("ascii")}

    async def handle(self, msg):
        rid = msg.get("id")
        try:
            fn = getattr(self, "cmd_" + str(msg.get("cmd")), None)
            if not fn:
                raise RuntimeError("Onbekende opdracht")
            send({"id": rid, "ok": True, "result": await fn(msg)})
        except Exception as e:  # elke fout netjes terug naar het paneel
            detail = str(e) or e.__class__.__name__
            if e.__cause__ and str(e.__cause__):
                detail += ": " + str(e.__cause__)
            sys.stderr.write("[atv] %s: %s\n" % (msg.get("cmd"), detail))
            sys.stderr.flush()
            send({"id": rid, "ok": False, "error": detail})

    async def run(self):
        await self.storage.load()
        reader = asyncio.StreamReader()
        await self.loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
        send({"event": "ready", "pyatv": pyatv.const.__version__ if hasattr(pyatv.const, "__version__") else ""})
        while True:
            line = await reader.readline()
            if not line:
                break  # het paneel is gestopt
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            self.loop.create_task(self.handle(msg))
        if self.atv:
            self.atv.close()


def power_name(p):
    return {PowerState.On: "on", PowerState.Off: "off"}.get(p, "unknown")


def main():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(Bridge(loop, sys.argv[1]).run())


if __name__ == "__main__":
    main()
