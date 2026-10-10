import '../styles/video/compat.css';
import './skin.css';
import '@videojs/html/i18n';
import '@videojs/html/ui/container';
import '@videojs/html/ui/poster';
import '@videojs/html/ui/buffering-indicator';
import '@videojs/html/ui/error-dialog';
import '@videojs/html/ui/dialog-backdrop';
import '@videojs/html/ui/dialog-popup';
import '@videojs/html/ui/dialog-title';
import '@videojs/html/ui/dialog-description';
import '@videojs/html/ui/dialog-close';
import '@videojs/html/ui/title';
import '@videojs/html/ui/controls';
import '@videojs/html/ui/controls-backdrop';
import '@videojs/html/ui/controls-content';
import '@videojs/html/ui/tooltip-group';
import '@videojs/html/ui/controls-group';
import '@videojs/html/ui/airplay-button';
import '@videojs/html/ui/tooltip';
import '@videojs/html/ui/tooltip-label';
import '@videojs/html/ui/tooltip-shortcut';
import '@videojs/html/ui/cast-button';
import '@videojs/html/ui/pip-button';
import '@videojs/html/ui/fullscreen-button';
import '@videojs/html/ui/seek-button';
import '@videojs/html/ui/play-button';
import '@videojs/html/ui/time-slider';
import '@videojs/html/ui/time-slider-chapters';
import '@videojs/html/ui/slider-track';
import '@videojs/html/ui/slider-buffer';
import '@videojs/html/ui/slider-fill';
import '@videojs/html/ui/slider-thumb';
import '@videojs/html/ui/slider-preview';
import '@videojs/html/ui/slider-thumbnail';
import '@videojs/html/ui/slider-value';
import '@videojs/html/ui/time-slider-chapter-title';
import '@videojs/html/ui/mute-button';
import '@videojs/html/ui/volume-popover';
import '@videojs/html/ui/volume-slider';
import '@videojs/html/ui/time-group';
import '@videojs/html/ui/time';
import '@videojs/html/ui/time-separator';
import '@videojs/html/ui/captions-button';
import '@videojs/html/ui/menu';
import '@videojs/html/ui/popover';
import '@videojs/html/ui/menu-content';
import '@videojs/html/ui/menu-item';
import '@videojs/html/ui/menu-separator';
import '@videojs/html/ui/quality-radio-group';
import '@videojs/html/ui/menu-radio-item';
import '@videojs/html/ui/menu-item-indicator';
import '@videojs/html/ui/audio-track-radio-group';
import '@videojs/html/ui/playback-rate-radio-group';
import '@videojs/html/ui/captions-radio-group';
import '@videojs/html/ui/hotkey';
import '@videojs/html/ui/gesture';
import '@videojs/html/ui/status-announcer';
import '@videojs/html/ui/volume-indicator';
import '@videojs/html/ui/volume-indicator-fill';
import '@videojs/html/ui/volume-indicator-value';
import '@videojs/html/ui/status-indicator';
import '@videojs/html/ui/status-indicator-value';
import '@videojs/html/ui/seek-indicator';
import '@videojs/html/ui/seek-indicator-value';
import { registerIcons } from '@videojs/html/icons';
import {
  airPlayEnterIcon as airPlayEnterIconCompat,
  airPlayExitIcon as airPlayExitIconCompat,
  captionsOffIcon as captionsOffIconCompat,
  captionsOnIcon as captionsOnIconCompat,
  castEnterIcon as castEnterIconCompat,
  castExitIcon as castExitIconCompat,
  seekIcon as seekIconCompat,
} from '@videojs/html/icons/compat';

import arrowClockwiseIconSource from 'bootstrap-icons/icons/arrow-clockwise.svg';
import badgeVrIconSource from 'bootstrap-icons/icons/badge-vr.svg';
import badgeVrFillIconSource from 'bootstrap-icons/icons/badge-vr-fill.svg';
import chatDotsIconSource from 'bootstrap-icons/icons/chat-dots.svg';
import checkLgIconSource from 'bootstrap-icons/icons/check-lg.svg';
import chevronDownIconSource from 'bootstrap-icons/icons/chevron-down.svg';
import fullscreenExitIconSource from 'bootstrap-icons/icons/fullscreen-exit.svg';
import fullscreenIconSource from 'bootstrap-icons/icons/fullscreen.svg';
import gearIconSource from 'bootstrap-icons/icons/gear.svg';
import heartIconSource from 'bootstrap-icons/icons/heart.svg';
import heartFillIconSource from 'bootstrap-icons/icons/heart-fill.svg';
import musicNoteListIconSource from 'bootstrap-icons/icons/music-note-list.svg';
import pauseFillIconSource from 'bootstrap-icons/icons/pause-fill.svg';
import phoneIconSource from 'bootstrap-icons/icons/phone.svg';
import pipIconSource from 'bootstrap-icons/icons/pip.svg';
import playFillIconSource from 'bootstrap-icons/icons/play-fill.svg';
import repeatIconSource from 'bootstrap-icons/icons/repeat.svg';
import repeatOneIconSource from 'bootstrap-icons/icons/repeat-1.svg';
import skipBackwardFillIconSource from 'bootstrap-icons/icons/skip-backward-fill.svg';
import skipForwardFillIconSource from 'bootstrap-icons/icons/skip-forward-fill.svg';
import speedometerIconSource from 'bootstrap-icons/icons/speedometer.svg';
import togglesIconSource from 'bootstrap-icons/icons/toggles.svg';
import volumeDownFillIconSource from 'bootstrap-icons/icons/volume-down-fill.svg';
import volumeMuteFillIconSource from 'bootstrap-icons/icons/volume-mute-fill.svg';
import volumeUpFillIconSource from 'bootstrap-icons/icons/volume-up-fill.svg';

const stripBootstrapClassesFromSource = (source: string) => source.replace(/\s*class="bi bi-[^"]+"/, '');

registerIcons('compat', {
  'airplay-enter': airPlayEnterIconCompat,
  'airplay-exit': airPlayExitIconCompat,
  'captions-off': captionsOffIconCompat,
  'captions-on': captionsOnIconCompat,
  'cast-enter': castEnterIconCompat,
  'cast-exit': castExitIconCompat,
  check: stripBootstrapClassesFromSource(checkLgIconSource),
  chevron: stripBootstrapClassesFromSource(chevronDownIconSource),
  'fullscreen-enter': stripBootstrapClassesFromSource(fullscreenIconSource),
  'fullscreen-exit': stripBootstrapClassesFromSource(fullscreenExitIconSource),
  'favorite-off': stripBootstrapClassesFromSource(heartIconSource),
  'favorite-on': stripBootstrapClassesFromSource(heartFillIconSource),
  gear: stripBootstrapClassesFromSource(gearIconSource),
  loop: stripBootstrapClassesFromSource(repeatIconSource),
  pause: stripBootstrapClassesFromSource(pauseFillIconSource),
  phone: stripBootstrapClassesFromSource(phoneIconSource),
  'pip-enter': stripBootstrapClassesFromSource(pipIconSource),
  'pip-exit': stripBootstrapClassesFromSource(pipIconSource),
  play: stripBootstrapClassesFromSource(playFillIconSource),
  queue: stripBootstrapClassesFromSource(musicNoteListIconSource),
  'repeat-one': stripBootstrapClassesFromSource(repeatOneIconSource),
  restart: stripBootstrapClassesFromSource(arrowClockwiseIconSource),
  seek: seekIconCompat,
  'skip-backward': stripBootstrapClassesFromSource(skipBackwardFillIconSource),
  'skip-forward': stripBootstrapClassesFromSource(skipForwardFillIconSource),
  speech: stripBootstrapClassesFromSource(chatDotsIconSource),
  speed: stripBootstrapClassesFromSource(speedometerIconSource),
  spinner: stripBootstrapClassesFromSource(arrowClockwiseIconSource),
  switches: stripBootstrapClassesFromSource(togglesIconSource),
  'volume-high': stripBootstrapClassesFromSource(volumeUpFillIconSource),
  'volume-low': stripBootstrapClassesFromSource(volumeDownFillIconSource),
  'volume-off': stripBootstrapClassesFromSource(volumeMuteFillIconSource),
  'vr-off': stripBootstrapClassesFromSource(badgeVrIconSource),
  'vr-on': stripBootstrapClassesFromSource(badgeVrFillIconSource),
});
