[← Back to Documentation](index.md)

# Intiface Central

For haptic support install [Intiface Central](https://intiface.com/#intiface-central). It connects to your toys directly and provides a generic API for haptic control, so HAPPY works with arbitrary haptic toys.

If you haven't used Intiface Central yet, check out their [Quickstart Guide](https://intiface.com/docs/intiface-central/quickstart).

## Connecting

1. In Intiface Central, start the server with the big "play" button.
2. Press "start scan" with your devices in pairing mode.
3. In HAPPY, open the settings panel, enter the Intiface address (default `ws://localhost:12345`) and press **Connect**.

Use the address of the machine running Intiface as seen from the device running the browser. `localhost` only works when browser and Intiface run on the same machine.

*TODO: image-walkthrough*

## Device Assignment

Each device exposes features like "linear", "vibrate" or "rotate". In the settings panel each feature can be assigned to the same or different funscripts of the current file. See [Library Setup](library.md#funscripts) for how funscripts are named.

*TODO: image-walkthrough*