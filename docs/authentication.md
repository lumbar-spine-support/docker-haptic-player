[← Back to Table of Content](index.md)

# Authentication

HAPPY has no accounts or passwords of its own. Your media, artwork and funscripts come from Jellyfin, so HAPPY asks you to sign in with your **Jellyfin user name and password**.

## Signing in

The first time you open HAPPY in a browser it shows a sign-in card with the address of your Jellyfin server (`JELLYFIN_URL`). After signing in you see exactly the libraries that Jellyfin user can access, and the HAPPY plugin only hands out funscripts of those items.

The sign-in is remembered in the browser. Each browser shows up once in Jellyfin under *Dashboard → Devices*, where you can also end its session. If Jellyfin rejects the stored session later (because it was ended there, or the user was removed), HAPPY shows the sign-in card again.

## Signing out

The lock button in the header (its tooltip names the signed-in user) ends the session in Jellyfin and returns to the sign-in card.

## Controlling access

Who may use HAPPY, and which media they see, is decided in Jellyfin:

- Create a Jellyfin user for each person and give them access only to the libraries they should see.
- Disable or delete a user in Jellyfin to lock them out of HAPPY too.

The HAPPY page itself (the app shell, the built-in docs and the default settings) is served without a sign-in. It contains no media and nothing from your libraries.

Note that Jellyfin itself may serve the original media file (`/Videos/{id}/stream?static=true`) to anyone who knows the item's id, even without a token. Item ids are long random values that HAPPY only hands to signed-in users, but if that matters to you, restrict access to Jellyfin itself (for example with your reverse proxy). Funscripts, trickplay images and the library listing always require a signed-in user.

## Casting and the DG-Lab relay

- **Chromecast and AirPlay:** stream URLs carry your Jellyfin access token, so a remote receiver can play the file without signing in itself.
- **DG-Lab Coyote:** the [DG-Lab relay](dg-lab.md#the-relay) only accepts browser tabs that are signed in to Jellyfin. It checks the tab's token with Jellyfin (its `JELLYFIN_URL`) when the tab connects. The DG-Lab app itself pairs with the one-time link HAPPY shows.
