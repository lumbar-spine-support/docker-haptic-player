[← Back to Table of Content](index.md)

# DG-Lab Coyote 3.0 (experimental)

>⚠️ Please read through the manufacturers instructions first!

The Coyote is not supported by Intiface. Instead, HAPPY talks to it using the [WebSocket v4.0 protocol](https://github.com/dungeonlab-open/dglab-websocket-server) of the Dungeon Lab app.

The app keeps full ownership of the safety limits.
HAPPY can only ever requests a strength at or below the ceiling the app reports. Still, increase limits slowly to avoid hurting yourself. Inform yourself about how current flows between electrodes and how to avoid hurting yourself.

Due to a lack of long-term testing, the feature is off by default. Turn it on with `DGLAB_ENABLED=1` if you want to try it (see [docs/configuration.md](configuration.md)).
While disabled, the WebSocket endpoint
does not exist and the settings section is not rendered at all.

## DG-Lab App Setup

1. First go to [DG-Lab Downloads](https://www.dungeon-lab.com/app-download) and download the most recent version of the app.
2. Follow the app instructions to pair your Coyote. Note that you are not going to pair the Coyote with HAPPY over Bluetooth. HAPPY clients and DG-Lab will both connect to a Websocket relay hosted by the HAPPY server that serves as the middleman for DG-Lab's v4.0 protocol.
3. Now you should have access to the Coyote settings. HAPPY does not have write access to those settings, so you need to adjust them as you see fit. The most important settings to consider:
    - **Channel Mute**: The button with the sinusoidal icon enables/disables the output of channels A and B seperately. You can mute a channel first to test if the funscript values arrive at the DG-Lab app. You will still see the values HAPPY sends over the WebSocket.
    - **Intensity Limit**: Click the cog on the right side and a few options will show. Among them you should see *Intensity Limit*. For Coyote 3.0 it should be a value you can choose between 0 and 200. It depends on the body-region what value is appropriate. Note that HAPPY treats funscript commands as a percentage of this maxmimum value. So if your funscript has `{"at": 1000, "pos": 100}` HAPPY will send `pos/100*intensityLimit` as the setpoint to the Coyote at 1000ms.
    - **Soft Start**: This is a protection mechanism by Dungeon Lab that limits the gradient of sudden spikes in the output. This will most likely interfer with precise execution of funscripts if the funscripts in their nature have sudden spikes rather than continuous oscillations. In this case you can disable *Protection Mode*  and adust the maximum gradient yourself. I personally deactivated the *decay* completely and drastically lowered the soft start rise-rate (maximum gradient).

Make sure that you applied the settings to both channel A and B in case you are using both outputs of the Coyote.

## Pairing

1. Open HAPPY and the settings sidebar, then press **Enable** in the DG-Lab section.
2. On the phone running the DG-Lab 4 app, tap **Open DG-Lab**. If HAPPY is open on a desktop
   browser instead, copy the shown URL and send it to the phone running DG-Lab and enter the address manually in *Socket Control*.
3. Return to HAPPY web interface. You should now see a green badge indicating successful pairing. The Coyote's two channels should appear in Device Assignment and can be
   assigned to any funscript like a toy connected through Intiface.
4. Have fun and **stay safe**!

## Debugging

To trace the wire protocol when something misbehaves, set `localStorage['happy-dglab-debug'] =
'true'` in the browser console and reload. Warnings and rejected commands are always logged.
