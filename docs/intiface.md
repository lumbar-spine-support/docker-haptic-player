[← Back to Table of Content](index.md)

# Intiface Central Integration

For haptic support install [Intiface Central](https://intiface.com/#intiface-central). It connects to your toys directly and provides a generic API for haptic control, so HAPPY works with arbitrary haptic toys.

If below description does not help, you can find a more detailed tutorial here: [Intiface Central Quickstart Guide](https://intiface.com/docs/intiface-central/quickstart).

## Connecting

1. In Intiface Central, start the server with the big "play" button.
2. Press "start scan" with your devices in pairing mode.
3. In HAPPY, open the settings panel, enter the Intiface address (default `ws://localhost:12345`) and press **Connect**. Pick `wss://` in the dropdown when Intiface is reachable only through a TLS proxy, for example when HAPPY itself is served over `https://` and Intiface is not on `localhost`.

Use the address of the machine running Intiface as seen from the device running the browser. `localhost` only works when browser and Intiface run on the same machine.

With `AUTO_RECONNECT_INTIFACE=true`, HAPPY reconnects on page load if Intiface was connected last time and you did not press **Disconnect**.

If the connection drops on its own, HAPPY retries in the background (1 s, doubling up to 15 s) and right away when you return to the tab. On mobile, a turned-off screen freezes the browser tab, and Intiface closes connections that stop answering its pings. HAPPY therefore keeps the screen on while media plays (**Keep Screen On During Playback** under *Appearance* in the settings, on by default); this needs the page to be served over HTTPS or from `localhost`.

## Device Assignment

Each device exposes features like "linear", "vibrate" or "rotate". Strokers are usually "linear" features but may also have "vibrate" features. A Nexus Revo Stealth exposes both a "rotate" and a "vibrate" feature through Intiface. You can assign each feature to the same or a different funscript!

Each stroker has its own position limits on its device card, so a long and a short stroker can use different ranges. New devices start at 0–100 %.

See [docs/library.md#funscripts](library.md#funscripts) for how funscripts must be stored in your library for HAPPY to connect them with your audio or video file.

The status badge above each funscript shows whether a device will play it; click it for details.

## Unsupported Features

Some toys report features that should not follow a funscript. HAPPY lists them on the device card but they cannot be assigned:

- **Temperature** (heating/cooling elements)
- **LED** (lights)
- **Spray** (liquid dispensers)
