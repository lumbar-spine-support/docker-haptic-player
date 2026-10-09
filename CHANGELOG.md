# Changelog

## [0.16.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.15.0...v0.16.0) (2026-10-09)


### Features

* **plugin:** user can configure which libraries to share with HAPPY ([8872e4e](https://github.com/lumbar-spine-support/docker-haptic-player/commit/8872e4edc62eaad2c8830b7ffa94ffff596483b3))
* **storyboards:** show preview on thumbnail when dragging the timeline ([3c94712](https://github.com/lumbar-spine-support/docker-haptic-player/commit/3c9471272c5e159ba285b4da1a684c0abdee3c55))

## [0.15.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.14.0...v0.15.0) (2026-10-05)


### Features

* **config:** make portrait card size configurable ([cb72dad](https://github.com/lumbar-spine-support/docker-haptic-player/commit/cb72dade58dad35c75b0b67889a8898d5a622181))

## [0.14.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.13.0...v0.14.0) (2026-10-04)


### Features

* add column headers also to card view for sorting. ([8251975](https://github.com/lumbar-spine-support/docker-haptic-player/commit/8251975f2a1f4bb4963eb847dcc2c6e64de96d79))
* add portrait artwork rendering ([5b647cf](https://github.com/lumbar-spine-support/docker-haptic-player/commit/5b647cf99a99cee07122e95a5c638bde5d2eed3e))
* artwork now automatically generated for videos if not available as metadata (album cover) ([0304ad5](https://github.com/lumbar-spine-support/docker-haptic-player/commit/0304ad5410eb20ea681982fcd398f26b9f245d98))
* decluttered sorting and filtering; less UI is occupied by filter buttons and hidden behind dropdowns. ([1af5142](https://github.com/lumbar-spine-support/docker-haptic-player/commit/1af514215f61a668c50a9e1e25b714fe7b8227e1))
* **docker:** update Dockerfile with additional metadata and health check; modify installation instructions for port mapping ([cf9ee7d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/cf9ee7d2bf93d2343c8de9f87d9613d10106eabb))
* dynamic layout; landscape artwork now takes two columns relative to "square artwork" ([71ed189](https://github.com/lumbar-spine-support/docker-haptic-player/commit/71ed1895a927770390d64a361c55dcc3d1da748a))
* migrate to new video js "compat" skin for more space in action bar for features to come ([871494a](https://github.com/lumbar-spine-support/docker-haptic-player/commit/871494a048ab35de01760b5670a4dcb84670b652))
* **vr:** initial draft for VR180 playback (no full immersive VR playback yet, just 2D rendering for phone/desktop) ([a755875](https://github.com/lumbar-spine-support/docker-haptic-player/commit/a755875ca796035b33f49fca30a481f00ff50f29))


### Bug Fixes

* funscript section should be hidden when no funscript available. ([f2486d1](https://github.com/lumbar-spine-support/docker-haptic-player/commit/f2486d16e67aae6fe74cd2218c3dbabcab4f3256))
* whitespace in cards view ([d7b8215](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d7b8215a8f659d72b37c1a547e1dee40ff3c5ff3))

## [0.13.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.12.0...v0.13.0) (2026-10-03)


### Features

* add auto-reconnect options for Intiface and DG-Lab relay in configuration and client logic ([b717a2d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/b717a2dc6aba5adde9ba41c7eb2a72a3fb8e196a))
* add pulse width control for Coyote devices and update related documentation ([d068c90](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d068c9046c6fb09afc31abf4a1da7e799387ab22))
* css improvements ([bdda820](https://github.com/lumbar-spine-support/docker-haptic-player/commit/bdda820b125d55604f8dddec548807516d98bad7))
* **dglab:** introduce sandbox for testing waveform patterns ([45bd9f5](https://github.com/lumbar-spine-support/docker-haptic-player/commit/45bd9f5f3b92e990986fbf494af713dac95e712a))
* generate playlist cover icons from first 4 tracks (if less tracks then use the first track as cover) ([5577df3](https://github.com/lumbar-spine-support/docker-haptic-player/commit/5577df3c7f0bee6f5c64d54d6eaea87dcc839c3d))
* improved tabular view for mobile; more metadata shown but still sortable ([379362d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/379362d90cf446342ea5a1e818520357bccf0de0))
* popovers for funscript badges to explain why we have warning or error ([ee6afe3](https://github.com/lumbar-spine-support/docker-haptic-player/commit/ee6afe3c277e1d9cd0b41296cd8cedf3be806344))
* wake screen during playback to avoid intiface disconnects ([8cf4c84](https://github.com/lumbar-spine-support/docker-haptic-player/commit/8cf4c84c97c837a1582b8ea3b28cb76dd8c322c8))


### Bug Fixes

* &lt;br&gt; tags were escaped in markdown docs (or HTML in general) ([cf45095](https://github.com/lumbar-spine-support/docker-haptic-player/commit/cf45095b159d31a268d306cef41e6d01ba240256))
* a connected websocket with dungeon lab does not directly yield "connected" badge for funscript; only when the coyote is also paired with dg lab ([ee6afe3](https://github.com/lumbar-spine-support/docker-haptic-player/commit/ee6afe3c277e1d9cd0b41296cd8cedf3be806344))
* auth screen now more accessible on mobile (keyboard pushes the content up) ([d3d92b4](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d3d92b48e706f340d398b330153e4292940b0e70))
* carrier-frequency was transmitted has Hz but should have been a period in ms instead; this caused the shown frequency to not match actual e-stim frequency. ([d068c90](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d068c9046c6fb09afc31abf4a1da7e799387ab22))
* clear-all tags button missing in tags view ([bdda820](https://github.com/lumbar-spine-support/docker-haptic-player/commit/bdda820b125d55604f8dddec548807516d98bad7))
* css of tabular view on i medium displays (ipad mini) ([a687379](https://github.com/lumbar-spine-support/docker-haptic-player/commit/a687379abbe3f89c737323d6e5873cf0419a5de4))
* default interpolation method ([bb0bbca](https://github.com/lumbar-spine-support/docker-haptic-player/commit/bb0bbcabd76e1d051b2ccbcee7c9c12db4cea9ab))
* dglab pairing App URL ([4ac70f9](https://github.com/lumbar-spine-support/docker-haptic-player/commit/4ac70f997b2536ee57b5c31a7c0332c2d5910a78))
* improve MediaClock synchronization and drift correction logic ([2319ffb](https://github.com/lumbar-spine-support/docker-haptic-player/commit/2319ffbed7a87a1ba5b0ed64f2c8bfd9f0b059df))
* jittering funscript timeline cursor on android; this time purely via CSS ([a5b5774](https://github.com/lumbar-spine-support/docker-haptic-player/commit/a5b5774eb5b6cfee33e95dbcc316e4d897e99c5f))
* make initial reconnect attempt fail silently ([0d5a87c](https://github.com/lumbar-spine-support/docker-haptic-player/commit/0d5a87ca63a92a784750091de88900100c11f3d8))
* missing ping/pong to detect dead dg-lab websockets ([799e098](https://github.com/lumbar-spine-support/docker-haptic-player/commit/799e098bba9083234e55e50f1db4ed15faab7480))
* missing rate limit for media endpoint ([f6e83ce](https://github.com/lumbar-spine-support/docker-haptic-player/commit/f6e83ceaf6925348f0e1d1f34014b3ac8212b06c))

## [0.12.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.11.0...v0.12.0) (2026-09-28)


### Features

* make maximum haptic delay configurable ([0561f33](https://github.com/lumbar-spine-support/docker-haptic-player/commit/0561f334d3e08193d39ee09373124b90759d5ffb))


### Bug Fixes

* improve chapter visibility (should be visible when paused to indicate chapter more easily) ([4ed19d1](https://github.com/lumbar-spine-support/docker-haptic-player/commit/4ed19d110c0a36b7de4a1db480a4ad90e4f2c3b9))

## [0.11.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.10.0...v0.11.0) (2026-09-28)


### Features

* implement reading chapters from media and/or funscripts to show in player ([0a2f2e6](https://github.com/lumbar-spine-support/docker-haptic-player/commit/0a2f2e6e835c672e35a10d07340dc4952223ddaf))


### Bug Fixes

* if available, use DisplayName not HarwareName for intiface haptic toys ([d7b5003](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d7b5003473e19b5a16187a47763bf8884ebf01cb))
* intiface features that came with v5 were not correctly displayed ([54a1f8d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/54a1f8d654a73bcff052bf03b9ad8d95111fbe74))

## [0.10.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.9.0...v0.10.0) (2026-09-28)


### Features

* tag view ([5219ed9](https://github.com/lumbar-spine-support/docker-haptic-player/commit/5219ed9561df7190f6e07936ae4dbb25fb0df602))

## [0.9.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.8.0...v0.9.0) (2026-09-28)


### Features

* improved alerts for intiface integration to help user debug issues ([a58ee4d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/a58ee4df81b76ab58d92096f37684dfb128f0dda))


### Bug Fixes

* minor css change to spacing in sidebar ([4b0af7f](https://github.com/lumbar-spine-support/docker-haptic-player/commit/4b0af7fbbce2782b5aead6336add40b65c31c17c))

## [0.8.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.7.0...v0.8.0) (2026-09-27)


### Features

* funscript viz refactor and more fluid implementation ([53da5db](https://github.com/lumbar-spine-support/docker-haptic-player/commit/53da5dbddeaf9d0ab10ad08db1a3a716b1b22d2d))
* interpolation method can be chosen at server startup time: none, linear or pchip ([10b2456](https://github.com/lumbar-spine-support/docker-haptic-player/commit/10b2456890df9169505b499c783d93d48f691136))


### Bug Fixes

* css of tables and long text in documentation markdown ([2e6e58a](https://github.com/lumbar-spine-support/docker-haptic-player/commit/2e6e58a4dedb638cb0a16d9986d54d819d1660bf))
* hide cast button + picture-in-picture button for audio files ([9887fca](https://github.com/lumbar-spine-support/docker-haptic-player/commit/9887fca76d67c8c90300c8879fc28e280e384e06))
* missing artifaces in docker image ([c84a4e8](https://github.com/lumbar-spine-support/docker-haptic-player/commit/c84a4e817904f47bc574a5b92b4240c364f83288))

## [0.7.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.6.0...v0.7.0) (2026-09-27)


### Features

* add QR-code pairing for Dungeon-Lab app (helpful if HAPPY client is a PC not the phone connected to haptics) ([1925afa](https://github.com/lumbar-spine-support/docker-haptic-player/commit/1925afac498ecdefb851e98510aad4eebc508751))


### Bug Fixes

* chromecast / airplay not working when authentication is enabled; now a short-lived token is granted for cast devices to access media stream ([22dc3a0](https://github.com/lumbar-spine-support/docker-haptic-player/commit/22dc3a03ef449adf7d50d22e9dce1fd9cbadd8ed))
* empty YAML entries for PASSWORD not treated correctly ([1fbba44](https://github.com/lumbar-spine-support/docker-haptic-player/commit/1fbba44ceb932677027c17303c3c3c5eb28762b1))
* smaller cards on very large displays ([fcaace6](https://github.com/lumbar-spine-support/docker-haptic-player/commit/fcaace6ce5e4520c6ade0743dc64d4d3664e8734))

## [0.6.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.5.0...v0.6.0) (2026-09-27)


### Features

* allow more funscript zoom ([3ea06dd](https://github.com/lumbar-spine-support/docker-haptic-player/commit/3ea06dd8d8bbe7f843bab2f70c32cdb94eaabfff))
* artist tag filtering ([bdf85a5](https://github.com/lumbar-spine-support/docker-haptic-player/commit/bdf85a569b370b6cfdde85193cae16dbf7dda5dd))
* coyote 3.0 ui provides proper warnings/errors regarding channel muting and device connection state ([b18205a](https://github.com/lumbar-spine-support/docker-haptic-player/commit/b18205a1966b920c927be75fa0580f5fd6446afe))
* details for intiface channels added; now you can see what the maximum values, step limits and current values are ([e477a21](https://github.com/lumbar-spine-support/docker-haptic-player/commit/e477a218357bc6e25a4b3be7d747a2593a2dddb4))
* improve responsiveness by caching artworks and lazy loading ([21a853d](https://github.com/lumbar-spine-support/docker-haptic-player/commit/21a853d571f8bdf643dfec0e1d54fb0f4ef84fb2))
* improved and configurable logging for debugging ([c4efbb9](https://github.com/lumbar-spine-support/docker-haptic-player/commit/c4efbb95dd16559db111c10c6223490771a3dbea))
* improved configuration handling ([d4c6663](https://github.com/lumbar-spine-support/docker-haptic-player/commit/d4c6663cf9c4c3b1e2257d5e4e50441181d2b63a))
* markdown documentation ([69f9d99](https://github.com/lumbar-spine-support/docker-haptic-player/commit/69f9d998e1520c54403be6a60022b6cabb506df7))


### Bug Fixes

* ENV not overwriting settings.yaml default upon first server start ([2b9a259](https://github.com/lumbar-spine-support/docker-haptic-player/commit/2b9a25959b07e03bebe30ddfb3ef58ee7149be35))

## [0.5.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.4.0...v0.5.0) (2026-09-23)


### Features

* authentication layer ([10bcd14](https://github.com/lumbar-spine-support/docker-haptic-player/commit/10bcd14f6c4f53bcb4dd1271a1dd57323b09427e))

## [0.4.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.3.1...v0.4.0) (2026-09-22)


### Features

* generic funscripts can be read (without suffix) ([8e99cb4](https://github.com/lumbar-spine-support/docker-haptic-player/commit/8e99cb4bdca925faace1f8603427e40fb5f3ed98))
* version badge in offcanvas element ([3d49676](https://github.com/lumbar-spine-support/docker-haptic-player/commit/3d4967648a2bde58f9d1c01b87a7820be667ecad))

## [0.3.1](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.3.0...v0.3.1) (2026-09-22)


### Bug Fixes

* chromecast button vanished ([359deb3](https://github.com/lumbar-spine-support/docker-haptic-player/commit/359deb3c5889bcefd4a60b9b52ec2fbc50ff4134))

## [0.3.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.2.0...v0.3.0) (2026-09-22)


### Features

* behaviour change: no intiface auto-connect; user needs to trigger ([647a30c](https://github.com/lumbar-spine-support/docker-haptic-player/commit/647a30cd8cfb75faf40b17891d2f10af6ce0e8ea))
* card visual cleanup; with haptic filters icons don't need to be shown on card, there is still tabular view for this. ([ef2dfde](https://github.com/lumbar-spine-support/docker-haptic-player/commit/ef2dfdee87725b3cf5163d90340c2518ed6a210e))
* collapsible funscript timelines ([7198a27](https://github.com/lumbar-spine-support/docker-haptic-player/commit/7198a27cb0db463abd8b9d17f433ccfbea158278))
* properly render artist, title and year in content title (while playback is paused/stopped) ([f41f40f](https://github.com/lumbar-spine-support/docker-haptic-player/commit/f41f40f2031dbe9d2157b92d79504bc899015aef))
* remove sectioning of media into albums/audio/video/playlists for cleaner look ([5e426f8](https://github.com/lumbar-spine-support/docker-haptic-player/commit/5e426f8ff1937f40d1024902dfa2f893170a6d4c))


### Bug Fixes

* disableremoteplayback added because we don't need the browser native chromecast icon ([170bfc9](https://github.com/lumbar-spine-support/docker-haptic-player/commit/170bfc92dc0b55b5a8d379789c2432fbb0c82a2f))
* when tag was already selected, pressing the tag again from player page didn't return back to library view ([c56c0dc](https://github.com/lumbar-spine-support/docker-haptic-player/commit/c56c0dc0466f675e12db917863c08236e16ab5fc))

## [0.2.0](https://github.com/lumbar-spine-support/docker-haptic-player/compare/v0.1.0...v0.2.0) (2026-09-21)


### Features

* add /api/version endpoint and stamp image builds with app version ([9cfe54f](https://github.com/lumbar-spine-support/docker-haptic-player/commit/9cfe54ffd0a1d974b5d2e34a255c1166c49d8243))
* make icon.svg theme-aware so that when installed as (web) app on chrome (android) it respects the user theme. Prevents icon staying white when background is white. ([e1c554e](https://github.com/lumbar-spine-support/docker-haptic-player/commit/e1c554e244abcdbd0ff4b21fb740b098fd974cc4))
* skip + loop button implementation; fixes to queue playback of albums/playlists ([1ae4f62](https://github.com/lumbar-spine-support/docker-haptic-player/commit/1ae4f624ed27ad2146bef2af290c6c30a291ccc9))
