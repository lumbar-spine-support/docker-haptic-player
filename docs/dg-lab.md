[← Back to Table of Content](index.md)

# DG-Lab Coyote 3.0

>⚠️ Please read through the manufacturer's instructions first!

The Coyote is not supported by Intiface. Instead, HAPPY talks to it using the [WebSocket v4.0 protocol](https://github.com/dungeonlab-open/dglab-websocket-server) of the Dungeon Lab app.

The app keeps full ownership of the safety limits.
HAPPY can only ever request a strength at or below the ceiling the app reports. Still, increase limits slowly to avoid hurting yourself. Inform yourself about how current flows between electrodes and how to avoid hurting yourself.

Due to a lack of long-term testing, the feature is off by default. To try it, run the relay (below) and turn on *Enable DG-Lab Coyote 3.0* on the HAPPY plugin's settings page in Jellyfin (*Dashboard → Plugins → HAPPY*). While it is disabled, HAPPY does not show the settings section at all.

## The relay

HAPPY and the DG-Lab app never talk to each other directly. Both connect to a small WebSocket relay that passes the DG-Lab v4.0 messages between them. The relay ships as its own Docker image, so only Coyote owners need to run it:

```yaml
services:
  happy-dglab-relay:
    image: ghcr.io/lumbar-spine-support/happy-dglab-relay:latest
    ports:
      - "8070:8070"
    environment:
      # Address the relay uses to check sign-ins with Jellyfin, e.g. on a shared Docker network.
      JELLYFIN_URL: "http://jellyfin:8096"
    restart: unless-stopped
```

Then enter the relay's address as your browser and phone reach it under *Relay address* on the plugin's settings page:

- `ws://<host>:8070` when you open Jellyfin over plain HTTP, for example `ws://192.168.1.10:8070`.
- `wss://…` when Jellyfin is served over HTTPS, because browsers block plain `ws://` from an HTTPS page. Put the relay behind your reverse proxy, either on its own host name (`wss://relay.example.com`) or under a path (`wss://example.com/dglab`). The relay accepts any path that ends in `/ws/dglab`, so the proxy does not need to rewrite it.
- Empty means `/ws/dglab` on Jellyfin's own address. Use this if your reverse proxy forwards that path to the relay.

This setting is the only place the relay address is set. HAPPY shows it read-only in the DG-Lab section of the settings sidebar, and the DG-Lab app dials the same address, so it must be one that phones can reach too (not `localhost`).

The relay only accepts HAPPY tabs that are signed in to Jellyfin; it checks each tab's sign-in with Jellyfin at `JELLYFIN_URL`. The DG-Lab app pairs with the one-time link HAPPY shows. Further settings: `PORT` (default `8070`) and `LOG_LEVEL` (`error`, `warn`, `info`, `debug`).

## DG-Lab App Setup

1. First go to [DG-Lab Downloads](https://www.dungeon-lab.com/app-download) and download the most recent version of the app.
2. Follow the app instructions to pair your Coyote. Note that you are not going to pair the Coyote with HAPPY over Bluetooth. HAPPY clients and DG-Lab will both connect to the HAPPY DG-Lab relay (above), which serves as the middleman for DG-Lab's v4.0 protocol.
3. Now you should have access to the Coyote settings. HAPPY does not have write access to those settings, so you need to adjust them as you see fit. The most important settings to consider:
    - **Channel Mute**: The button with the sinusoidal icon enables/disables the output of channels A and B separately. You can mute a channel first to test if the funscript values arrive at the DG-Lab app. You will still see the values HAPPY sends over the WebSocket.
    - **Intensity Limit**: Click the cog on the right side and a few options will show. Among them you should see *Intensity Limit*. For Coyote 3.0 it should be a value you can choose between 0 and 200. It depends on the body-region what value is appropriate. HAPPY holds the channel at this limit (times the device strength slider) while a funscript plays, and plays the funscript through the pulse width instead: a position of 100 means full pulse width, 0 means no pulses. Pulse width can change every 25 ms, strength only every 100 ms, so this follows fast scripts more closely.
    - **Soft Start**: This is a protection mechanism by Dungeon Lab that limits the gradient of sudden spikes in the output. This will most likely interfere with precise execution of funscripts if the funscripts in their nature have sudden spikes rather than continuous oscillations. In this case you can disable *Protection Mode*  and adjust the maximum gradient yourself. I personally deactivated the *decay* completely and drastically lowered the soft start rise-rate (maximum gradient).

Make sure that you applied the settings to both channel A and B in case you are using both outputs of the Coyote.

## Pairing

1. Open HAPPY and the settings sidebar, then press **Enable** in the DG-Lab section.
2. On the phone running the DG-Lab 4 app, tap **Open DG-Lab**. If HAPPY is open on a desktop
   browser instead, either copy the URL enter the server URL in DG-Lab app or scan the QR code shown from the DG-Lab app.
3. Return to HAPPY web interface. You should now see a green badge indicating successful pairing. The Coyote's two channels should appear in Device Assignment and can be
   assigned to any funscript like a toy connected through Intiface.
   The status badge above each funscript turns yellow or red when the Coyote is unplugged, muted or limited in the app; click it for details.
4. Have fun and **stay safe**!

There is a single pairing per relay. Opening HAPPY in another browser or on another device takes
over the paired DG-Lab app without pairing again; the previous tab is disconnected. After a relay
restart you have to pair again.

With *Reconnect to the relay on page load* (on by default), a page reload reconnects to the relay automatically if DG-Lab was
connected before and the relay was last heard from less than 5 minutes ago (the time the relay keeps
the paired app). After that the section stays *Disconnected* and you pair again by hand.

## Sandbox

The **Sandbox** button below the DG-Lab device cards opens a test page. Pick a channel and a pattern (constant, wave, on/off, ramp, strokes, heartbeat, steps) and press **Start**. The chart shows the pattern and the pulses it produces with the current strength and Pulse Frequency from the device card. Use it to find comfortable settings or check the setup without funscript media. Starting pauses any playing media; **Stop** or leaving the page (e.g. through the navbar) silences the Coyote.

The page is available while DG-Lab is enabled; turn it off with *Show the waveform sandbox* on the plugin's settings page.

## Debugging

To trace the wire protocol when something misbehaves, set `localStorage['happy-log'] =
'dglab=debug'` in the browser console and reload, or turn on *Debug output in the browser console* on the
plugin's settings page for everyone. Warnings, rejected commands and every lost relay connection (with its
close code) are always logged.

The relay logs every connection, disconnect and reconnect at the default `LOG_LEVEL=info`
(`docker logs happy-dglab-relay`). If the status badge flickers to *Error* or the DG-Lab app reports an
unstable network, these lines tell you where the trouble is:

| Log line | Meaning |
| --- | --- |
| `Controller closed: code 1000 …, reason "ping_timeout"` | The HAPPY tab heard no answer from the relay for 6 s and reconnected. Look at the network between the browser and the relay (Wi-Fi, reverse proxy). |
| `… code 1006 (abnormal …)` | The connection dropped without a goodbye: a network or reverse proxy cut it, or the browser was suspended. |
| `… was silent for 7.3 s although it pings every 2 s` | Nothing reached the relay from that peer for that long; its link to the relay stalled. |
| `… answered a native ping after …` / `… has not answered native pings for …` | Slow or missing round trips between the relay and that peer. |
| `… is not keeping up: … KiB queued towards it` | The relay cannot send to that peer fast enough (slow link or buffering proxy). |
| `The relay stalled for up to … ms` | The relay itself froze (CPU limit, paused or swapping container), which delays both peers. |
| `Controller gone, keeping the app paired …` / `Controller … back after …` | The HAPPY tab disconnected and came back; the DG-Lab app stays paired meanwhile. |

`LOG_LEVEL=debug` adds the round trip time of every native ping (every 10 s per peer).

`happy-log` is a comma-separated list of `namespace=level` pairs (`debug`, `info`, `warn`, `error`,
`silent`). A namespace also covers its `:`-children, and `*` sets the default, e.g.
`dglab=debug,dglab:socket=warn,*=info`.
