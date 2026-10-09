[← Back to Table of Content](index.md)

# Configuration

HAPPY's server-wide settings live on the plugin's settings page in Jellyfin: *Dashboard → Plugins → HAPPY*. Only Jellyfin administrators can change them. Changes apply the next time HAPPY is opened or reloaded; Jellyfin does not need a restart.

Settings marked *(user)* are only starting values: each user can change them in HAPPY's settings panel, and HAPPY remembers that choice in the browser. Changing them on the plugin page then only affects browsers that have not changed them yet.

## Playback

| Setting | Default | Description |
| --- | --- | --- |
| Seek interval (seconds) | `10` | Seek step when double-tapping or double-clicking the video. |
| Blur images and videos *(user)* | off | Blur artwork and videos. Can be toggled in HAPPY. |
| Chapters | Embedded, then funscript | Which chapter sources HAPPY uses and in which order: the first source that provides chapters wins. *No chapters* turns them off. See [Chapters](library.md#chapters). |

## Haptics

| Setting | Default | Description |
| --- | --- | --- |
| Intiface update rate (Hz) *(user)* | `30` | How often HAPPY sends commands to Intiface. Smaller values are usually more stable but less precise. |
| Haptic delay (ms) *(user)* | `0` | Shifts the haptics against the media to keep them in sync. |
| Delay slider range (ms) | `500` | The delay sliders in HAPPY go from minus to plus this value. |
| Interpolation between funscript points | Smooth (pchip) | How positions between funscript points are computed for haptics and the timeline: smooth, linear, or none (hold each position until the next point). Strokers follow smooth as linear. |
| Colour the timeline by speed *(user)* | off | Colour the timeline graph on a heat scale by movement speed (blue = slow, red = fast). |
| Reconnect to Intiface on page load | on | Reconnect to Intiface on page load if it was connected when the page was last used. |

## DG-Lab Coyote (experimental)

| Setting | Default | Description |
| --- | --- | --- |
| Enable DG-Lab Coyote 3.0 | off | Show the DG-Lab section in HAPPY. While it is off, HAPPY never connects to the relay. |
| Relay address | *(empty)* | The [DG-Lab relay](dg-lab.md#the-relay) as browsers and phones reach it, e.g. `ws://192.168.1.10:8070` or `wss://relay.example.com`. Empty means `/ws/dglab` on Jellyfin's own address. |
| Show the waveform sandbox | on | Show the [sandbox](dg-lab.md#sandbox) page for testing waveform patterns without media. |
| Reconnect to the relay on page load | on | Reconnect to the relay on page load if it was connected and last seen less than 5 minutes ago. |

The relay itself is configured with environment variables, see [DG-Lab Coyote 3.0](dg-lab.md#the-relay).

## Library

| Setting | Default | Description |
| --- | --- | --- |
| Crop artwork to squares | off | Reduce artwork to a square, for a consistent layout. |
| Portrait artwork takes two rows | off | Portrait artwork takes up two rows in the card view. |

## Funscript file names

A script belongs to the media file with the same name: `clip.mp4` + `clip.stroker.funscript`. See [Media Library](library.md#funscripts).

| Setting | Default | Description |
| --- | --- | --- |
| Separator | `.` | Single character between the file name and the funscript suffixes. |
| Stroker suffix | `stroker` | Suffix of stroker scripts. |
| Buttplug suffix | `buttplug` | Suffix of buttplug scripts. |
| Vibrator suffix | `vibrator` | Suffix of vibrator scripts. |
| E-stim suffix | `estim` | Suffix of e-stim scripts. |
| Machine suffix | `machine` | Suffix of machine scripts. |

## Jellyfin menu

| Setting | Default | Description |
| --- | --- | --- |
| Show HAPPY in Jellyfin's menu | on | Adds a HAPPY link to the menu of Jellyfin's web client for every user. It opens HAPPY in a new tab. Takes effect when the Jellyfin page is reloaded. |
| Menu text | `HAPPY` | Text of the link. |
| Menu icon | `vibration` | A [Material icon](https://fonts.google.com/icons) name. |

## Troubleshooting

| Setting | Default | Description |
| --- | --- | --- |
| Debug output in the browser console | off | Log the DG-Lab protocol traffic at debug level in the browser console. |
