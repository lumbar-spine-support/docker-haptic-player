[← Back to Table of Content](index.md)

# Installation

HAPPY plays media from a [Jellyfin](https://jellyfin.org/) server and runs inside it as a plugin. Jellyfin scans your files and provides metadata, artwork, chapters, timeline thumbnails, users and streaming. The HAPPY plugin adds the funscripts and serves HAPPY itself. There is no separate HAPPY server or container.

You need:

1. A Jellyfin server (currently 12.1) with your audio and video in its libraries (see [Media Library](library.md)).
2. The HAPPY plugin installed in that Jellyfin server (below).
3. Optionally, for the DG-Lab Coyote only: the [DG-Lab relay](dg-lab.md#the-relay).

## Jellyfin plugin

The plugin serves HAPPY, its settings and these docs, and indexes the `.funscript` files that sit next to your media for signed-in Jellyfin users.

### From the HAPPY plugin repository (recommended)

Add HAPPY's plugin repository to Jellyfin once. After that Jellyfin installs the plugin from its catalog and keeps it up to date like any official plugin.

1. In Jellyfin, open *Dashboard → Plugins → Repositories* and add a repository:
   - Name: `HAPPY`
   - URL: `https://raw.githubusercontent.com/lumbar-spine-support/jellyfin-haptic-player/refs/heads/jellyfin-plugin-repository/manifest.json`
2. Open the plugin *Catalog*, select **HAPPY** (category *General*) and install it.
3. Restart Jellyfin. *Dashboard → Plugins* now lists **HAPPY**.
4. Run a library scan, or just open HAPPY; the funscript index is built on first use and refreshed after every scan.

Jellyfin checks its repositories for updates every day (the *Update Plugins* scheduled task) and installs new versions automatically; restart Jellyfin to load an update. You can turn automatic updates off on the plugin's page. Jellyfin only offers plugin versions built for its own version or an older one.

### Beta channel

To try changes before they are released, use the beta repository instead:

- URL: `https://raw.githubusercontent.com/lumbar-spine-support/jellyfin-haptic-player/refs/heads/jellyfin-plugin-repository/manifest-beta.json`

It is the same plugin with the same settings. It offers every stable release plus the latest beta builds, which are made from the development branch after every change. They have a fourth version number, for example `1.1.0.3`, and HAPPY shows **beta** next to its version in the settings panel. Beta builds are tested automatically but not by hand, so expect the occasional bug, and please report it.

- **Switching to beta:** replace the HAPPY repository URL with the beta URL (or add it next to the stable one). Run the *Update Plugins* scheduled task, or wait a day, then restart Jellyfin.
- **Updates:** a new beta usually appears a few minutes after each change; the next stable release replaces all betas before it.
- **Back to stable:** switch the repository URL back. Jellyfin never downgrades a plugin, so you stay on the beta until the next stable release replaces it. To go back right away, uninstall HAPPY, restart Jellyfin and install it again from the stable repository; the plugin settings are kept.

### By hand

1. Download `happy_<version>.zip` from a [HAPPY release](https://github.com/lumbar-spine-support/jellyfin-haptic-player/releases) and unzip it into a new folder `HAPPY_<version>` (it contains `Jellyfin.Plugin.Happy.dll` and `meta.json`). Each CI build also uploads the folder as the `jellyfin-plugin-happy` artifact; to build it yourself, run `sh jellyfin-plugin/package.sh` with the .NET 10 SDK, which writes `jellyfin-plugin/artifacts/HAPPY_<version>/`.
2. Copy that folder into the `plugins` directory of Jellyfin's data directory (for the official Docker image that is `/config/plugins/` inside Jellyfin's config volume).
3. Restart Jellyfin and continue with step 4 above.

The plugin is built for one Jellyfin version (currently 12.1). After a Jellyfin upgrade, install the matching plugin version; with the repository added, Jellyfin does that for you once a matching version is released.

## Opening HAPPY

Open `<your Jellyfin address>/Happy/Web/` in your browser, for example `http://192.168.1.10:8096/Happy/Web/` or `https://jellyfin.example.com/Happy/Web/`. If Jellyfin runs under a base URL such as `/jellyfin`, keep it: `https://example.com/jellyfin/Happy/Web/`. The plugin's settings page (*Dashboard → Plugins → HAPPY*) also has an *Open HAPPY* button.

Jellyfin's web client also lists **HAPPY** in its menu for every user: in the side menu and in the bar above the home page. It opens HAPPY in a new tab. If you are signed in to Jellyfin's web client in that browser, HAPPY uses that sign-in; otherwise sign in with your Jellyfin user name and password.

The settings panel's *Back to Jellyfin* button returns to Jellyfin's web client. Jellyfin's apps for TVs and phones don't show the menu entry; open HAPPY in a browser there. Playback, VR and haptics always happen in HAPPY's own player. HAPPY shows the libraries that user can see in Jellyfin. HAPPY has no accounts of its own: who may see what is decided by Jellyfin's users and their library access, see [Authentication](authentication.md).

Server-wide defaults (seek interval, haptic delay, DG-Lab, funscript file names and more) are set by a Jellyfin administrator on the plugin's settings page, see [Configuration](configuration.md).

## Moving from the HAPPY container

Earlier versions of HAPPY ran as their own Docker container (`ghcr.io/lumbar-spine-support/docker-haptic-player`). That image gets no more releases. To move over:

1. Install the plugin as described above.
2. Enter the values from your `settings.yaml` or container environment on the plugin's settings page. `JELLYFIN_URL` is no longer needed, since HAPPY now runs on Jellyfin's own address.
3. If you use the DG-Lab Coyote, run the [DG-Lab relay](dg-lab.md#the-relay) and enter its address on the settings page.
4. Stop and remove the old container, and remove it from your reverse proxy.

Settings you changed in HAPPY itself (haptic delays, device assignments and strengths, the Intiface address, blur and similar toggles) are stored in the browser per address. HAPPY now has a different address, so they do not carry over; set them again once. Bookmarks and home screen shortcuts need the new address as well.
