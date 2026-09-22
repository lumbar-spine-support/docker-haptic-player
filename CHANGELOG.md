# Changelog

## [0.4.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/docker-haptic-player-v0.3.1...docker-haptic-player-v0.4.0) (2026-09-22)


### Features

* generic funscripts can be read (without suffix) ([8e99cb4](https://github.com/lumbar-spine-support/docker-haptic-player/commit/8e99cb4bdca925faace1f8603427e40fb5f3ed98))
* version badge in offcanvas element ([3d49676](https://github.com/lumbar-spine-support/docker-haptic-player/commit/3d4967648a2bde58f9d1c01b87a7820be667ecad))

## [0.3.1](https://github.com/lumbar-spine-support/docker-haptic-player/compare/docker-haptic-player-v0.3.0...docker-haptic-player-v0.3.1) (2026-09-22)


### Bug Fixes

* chromecast button vanished ([359deb3](https://github.com/lumbar-spine-support/docker-haptic-player/commit/359deb3c5889bcefd4a60b9b52ec2fbc50ff4134))

## [0.3.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/docker-haptic-player-v0.2.0...docker-haptic-player-v0.3.0) (2026-09-22)


### Features

* behaviour change: no intiface auto-connect; user needs to trigger ([647a30c](https://github.com/lumbar-spine-support/docker-haptic-player/commit/647a30cd8cfb75faf40b17891d2f10af6ce0e8ea))
* card visual cleanup; with haptic filters icons don't need to be shown on card, there is still tabular view for this. ([ef2dfde](https://github.com/lumbar-spine-support/docker-haptic-player/commit/ef2dfdee87725b3cf5163d90340c2518ed6a210e))
* collapsible funscript timelines ([7198a27](https://github.com/lumbar-spine-support/docker-haptic-player/commit/7198a27cb0db463abd8b9d17f433ccfbea158278))
* properly render artist, title and year in content title (while playback is paused/stopped) ([f41f40f](https://github.com/lumbar-spine-support/docker-haptic-player/commit/f41f40f2031dbe9d2157b92d79504bc899015aef))
* remove sectioning of media into albums/audio/video/playlists for cleaner look ([5e426f8](https://github.com/lumbar-spine-support/docker-haptic-player/commit/5e426f8ff1937f40d1024902dfa2f893170a6d4c))


### Bug Fixes

* disableremoteplayback added because we don't need the browser native chromecast icon ([170bfc9](https://github.com/lumbar-spine-support/docker-haptic-player/commit/170bfc92dc0b55b5a8d379789c2432fbb0c82a2f))
* when tag was already selected, pressing the tag again from player page didn't return back to library view ([c56c0dc](https://github.com/lumbar-spine-support/docker-haptic-player/commit/c56c0dc0466f675e12db917863c08236e16ab5fc))

## [0.2.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/docker-haptic-player-v0.1.0...docker-haptic-player-v0.2.0) (2026-09-21)


### Features

* add /api/version endpoint and stamp image builds with app version ([9cfe54f](https://github.com/lumbar-spine-support/docker-haptic-player/commit/9cfe54ffd0a1d974b5d2e34a255c1166c49d8243))
* make icon.svg theme-aware so that when installed as (web) app on chrome (android) it respects the user theme. Prevents icon staying white when background is white. ([e1c554e](https://github.com/lumbar-spine-support/docker-haptic-player/commit/e1c554e244abcdbd0ff4b21fb740b098fd974cc4))
* skip + loop button implementation; fixes to queue playback of albums/playlists ([1ae4f62](https://github.com/lumbar-spine-support/docker-haptic-player/commit/1ae4f624ed27ad2146bef2af290c6c30a291ccc9))
