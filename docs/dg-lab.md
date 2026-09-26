[← Back to Documentation](index.md)

# DG-Lab Coyote 3.0 (experimental)

The Coyote is not supported by Intiface, so HAPPY can talk to it directly through the official
DG-Lab 4 app. The app keeps full ownership of your safety limits; HAPPY only ever requests a
strength at or below the ceiling the app reports.

The feature is **off by default**. Turn it on with `DGLAB_ENABLED: true` in `settings.yaml` or
`DGLAB_ENABLED=true` in the environment, then restart. While disabled, the WebSocket endpoint
does not exist and the settings section is not rendered at all.

## Pairing

1. Open HAPPY and the settings sidebar, then press **Enable** in the DG-Lab section.
2. On the phone running the DG-Lab 4 app, tap **Open DG-Lab**. If HAPPY is open on a desktop
   browser instead, press **Copy URL** and enter that address in the app by hand.
3. Once the app attaches, the Coyote's two channels appear in Device Assignment and can be
   assigned to any funscript, exactly like an Intiface actuator.

The address field is filled in automatically: it uses the host you loaded HAPPY from, falling
back to a LAN address reported by the server when that is `localhost`. `localhost` is never
usable here, because to the phone it means the phone itself. The automatic value can be wrong
when the server runs in a container on a bridge network — it then sees only the container's
address — so the field stays editable and whatever you type is remembered.

> **Safety:** set your comfort limits in the DG-Lab app before assigning a script. Output stops
> within ~300 ms whenever playback pauses, the tab closes, or the connection drops.

Both channels must be **unmuted in the DG-Lab app**; a muted channel accepts commands and
stays silent. The channel labels in Device Assignment show the current mute state and limit.

The pairing address is stable per client: the relay derives the controller id from your access
token, so reloading the page or restarting the server keeps the same URL and the app stays
paired. With authentication disabled there is no token, so the id falls back to the client's
network address and every browser on that host shares one pairing URL.

## Debugging

To trace the wire protocol when something misbehaves, set `localStorage['happy-dglab-debug'] =
'true'` in the browser console and reload. Warnings and rejected commands are always logged.
