import { fetchFunscript, fetchTrackDescription, fetchVersion, fetchAuthStatus, logout, formatVersion, qs, buildUrl, trackHref, detailHref, renderHapticIcons, escapeHtml, renderTrackArt, artworkUrl } from './utils';
import { bindDragOnlyRange, syncRangeFill } from './utils/rangeSlider';
import { resetScrollPosition } from '../shared/scroll';
import { PlaybackSession, PlaybackQueue, PlaybackController } from './components/player';
import type { PlayerFooterElement } from './components/player';
import { ButtplugClientManager } from './components/haptic/buttplugClient';
import { FunscriptSync } from './components/funscriptSync';
import { DeviceStatus } from './components/haptic/deviceStatus';
import { DeviceAssignment } from './components/haptic/deviceAssignment';
import { HapticControls } from './components/hapticControls';
import { Visualization } from './components/visualization';
import { Markdown } from './components/markdown';
import { Library } from './components/library';
import type { TrackInfo, QueueSource, FunscriptInfo } from '../shared/types';
import type { HapticChannel } from '../shared/haptics';

import '@videojs/html/ui/title';
import '@videojs/html/icons/element'

// <video-player> with our extra loop feature; must register before any skin uses it.
import '@/components/videojs/player';

// Ejected Minimal Skins (shadcn: @videojs/video-minimal and @videojs/audio-minimal)
// Registers <video-minimal-skin> from the ejected skin.html/skin.css.
import '@/components/videojs/skins/video/minimal/element';

const INTIFACE_ADDRESS_KEY = 'happy-intiface-address';
const HAPTIC_STRENGTH_KEY = 'happy-haptic-strength';
const HAPTIC_DELAY_KEY = 'happy-haptic-delay-ms';
const HAPTIC_UPDATE_RATE_KEY = 'happy-haptic-update-rate-hz';
const AUTOPLAY_KEY = 'happy-autoplay';
const BLUR_CONTENT_KEY = 'happy-blur-content';

type DetailContext =
  | { type: 'playlist'; playlistId: string }
  | { type: 'album'; albumId: string }
  | null;
type LoadedScript = { channel: HapticChannel; funscript: import('../shared/types').Funscript };

function normalizeIntifaceAddress(rawAddress: string): string {
  const trimmed = rawAddress.trim();
  const address = trimmed || 'ws://localhost:12345';
  const withoutPrefix = address.replace(/^ws:\/\//i, '');
  return `ws://${withoutPrefix.replace(/^\/+/, '')}`;
}

function formatIntifaceHost(rawAddress: string): string {
  return normalizeIntifaceAddress(rawAddress).replace(/^ws:\/\//i, '');
}

class App {
  private readonly libraryView = qs<HTMLElement>('#library-view');
  private readonly playerView = qs<HTMLElement>('#player-view');
  private readonly detailView = qs<HTMLElement>('#detail-view');
  private readonly detailList = qs<HTMLElement>('#detail-list');
  private readonly detailTitle = qs<HTMLElement>('#detail-title');
  private readonly detailSubtitle = qs<HTMLElement>('#detail-subtitle');
  private readonly detailTypeLabel = qs<HTMLElement>('#detail-type-label');
  private readonly detailPlayBtn = qs<HTMLButtonElement>('#btn-detail-play');
  private readonly detailCover = qs<HTMLImageElement>('#detail-cover');
  // Album layout elements
  private readonly detailAlbumLayout = qs<HTMLElement>('#detail-album-layout');
  private readonly detailTypeLabelAlbum = qs<HTMLElement>('#detail-type-label-album');
  private readonly detailTitleAlbum = qs<HTMLElement>('#detail-title-album');
  private readonly detailSubtitleAlbum = qs<HTMLElement>('#detail-subtitle-album');
  private readonly detailYearAlbum = qs<HTMLElement>('#detail-year-album');
  private readonly detailCoverAlbum = qs<HTMLImageElement>('#detail-cover-album');
  // Playlist layout elements
  private readonly detailPlaylistLayout = qs<HTMLElement>('#detail-playlist-layout');
  private readonly detailTypeLabelPlaylist = qs<HTMLElement>('#detail-type-label-playlist');
  private readonly detailTitlePlaylist = qs<HTMLElement>('#detail-title-playlist');
  private readonly detailSubtitlePlaylist = qs<HTMLElement>('#detail-subtitle-playlist');
  private readonly connectBtn = qs<HTMLButtonElement>('#btn-connect');
  private readonly intifaceInput = qs<HTMLInputElement>('#intiface-address');
  private readonly hapticSlider = qs<HTMLInputElement>('#haptic-strength');
  private readonly hapticLabel = qs<HTMLElement>('#haptic-strength-label');
  private readonly hapticDelaySlider = qs<HTMLInputElement>('#haptic-delay');
  private readonly hapticDelayLabel = qs<HTMLElement>('#haptic-delay-label');
  private readonly vizContainer = qs<HTMLElement>('#visualization');
  private readonly descriptionSection = qs<HTMLElement>('#track-description-section');
  private readonly descriptionEl = qs<HTMLElement>('#track-description');
  private readonly trackTagsSection = qs<HTMLElement>('#track-tags-section');
  private readonly trackTagsEl = qs<HTMLElement>('#track-tags');
  private readonly zoomSlider = qs<HTMLInputElement>('#viz-zoom');
  private readonly timelineToggleButton = qs<HTMLButtonElement>('#viz-toggle');
  private readonly timelineLockButton = qs<HTMLButtonElement>('#viz-lock');
  private readonly hapticUpdateRateSlider = qs<HTMLInputElement>('#haptic-update-rate');
  private readonly hapticUpdateRateLabel = qs<HTMLElement>('#haptic-update-rate-label');
  private readonly footer = qs<PlayerFooterElement>('#player-footer');
  private readonly blurContentToggle = qs<HTMLInputElement>('#blur-content-toggle');
  private readonly versionBadge = qs<HTMLElement>('#app-version');
  private readonly logoutBtn = qs<HTMLButtonElement>('#btn-logout');

  private readonly buttplug = new ButtplugClientManager();
  /** Owns the two interchangeable players; one of them is always the playing one. */
  private readonly session: PlaybackSession;
  private readonly queue = new PlaybackQueue();
  private readonly playback: PlaybackController;
  private readonly syncEngine: FunscriptSync;
  private readonly deviceStatus: DeviceStatus;
  private readonly deviceAssignment: DeviceAssignment;
  private readonly hapticControls: HapticControls;
  private readonly viz: Visualization;
  private readonly library: Library;

  private currentTrackId: string | null = null;
  private detailContext: DetailContext = null;
  /** Funscripts per track id, shared by the timeline view and the haptic engine. */
  private readonly scriptCache = new Map<string, Promise<LoadedScript[]>>();
  /** Scroll position to restore when returning to library view */
  private savedLibraryScrollPosition = 0;

  /** Waits for the `<video-player>` elements to upgrade before wiring the app. */
  static async create(playerHosts: [HTMLElement, HTMLElement]): Promise<App> {
    return new App(await PlaybackSession.create(playerHosts));
  }

  private constructor(session: PlaybackSession) {
    this.session = session;
    this.queue.autoplay = localStorage.getItem(AUTOPLAY_KEY) !== 'false';
    this.syncEngine = new FunscriptSync(session, this.buttplug);
    this.deviceStatus = new DeviceStatus(this.buttplug);
    this.deviceAssignment = new DeviceAssignment(this.buttplug);
    this.hapticControls = new HapticControls(this.buttplug);
    this.viz = new Visualization(session);
    this.viz.onSeek((time) => { void session.focusedStore.seek(time); });

    this.library = new Library({
      openTrack: (id) => { void this.openTrack(id, true); },
      openAlbum: (id) => { void this.showAlbumDetail(id, true); },
      openPlaylist: (id) => { void this.showPlaylistDetail(id, true); },
      navigateTo: (url) => this.navigateTo(url),
      isLibraryRoute: () => this.isLibraryRoute(),
      showLibrary: () => this.showLibrary(false),
    });
    this.playback = new PlaybackController(this.library, this.queue, session);
  }

  /** All playable media items (audio tracks and videos combined). */
  private allMedia(): TrackInfo[] {
    return this.library.allMedia();
  }

  async init(): Promise<void> {
    this.library.bindControls();
    this.bindDetailControls();
    this.bindSidebarControls();
    this.initBlurContent();
    this.bindZoomControls();
    void this.showVersion();
    void this.bindLogout();
    this.footer?.bind(this.session, this.playback, (trackId) => this.navigateTo(trackHref(trackId)));

    const assignContainer = qs<HTMLElement>('#device-assignment');
    if (assignContainer) this.deviceAssignment.mount(assignContainer);

    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.addEventListener('show.bs.offcanvas', () => {
        this.deviceAssignment.refresh();
      });
    }

    this.initHapticControls();
    this.playback.onActiveTrack((track) => { void this.onActiveTrackChanged(track); });

    await this.library.load();
    await this.handleRouteChange();

    window.addEventListener('popstate', () => { void this.handleRouteChange(); });
  }

  private bindDetailControls(): void {
    this.detailPlayBtn?.addEventListener('click', () => {
      if (!this.detailContext) return;
      if (this.detailContext.type === 'playlist') {
        const playlist = this.library.getPlaylist(this.detailContext.playlistId);
        const firstTrackId = playlist?.entries[0]?.trackId;
        if (playlist && firstTrackId) {
          void this.openTrack(firstTrackId, true, { type: 'playlist', id: playlist.id }, true);
        }
      } else {
        const album = this.library.getAlbum(this.detailContext.albumId);
        const firstTrackId = album?.trackIds[0];
        if (album && firstTrackId) {
          void this.openTrack(firstTrackId, true, { type: 'album', id: album.id }, true);
        }
      }
    });
  }

  // ── End tag management ─────────────────────────────────────────────────────



  private renderPlayerTags(track: TrackInfo): void {
    if (!this.trackTagsSection || !this.trackTagsEl) return;
    this.trackTagsEl.innerHTML = '';
    if (track.tags.length === 0) {
      this.trackTagsSection.classList.add('d-none');
      return;
    }
    this.trackTagsSection.classList.remove('d-none');
    const sortedTags = [...track.tags].sort((a, b) => a.localeCompare(b));
    for (const tag of sortedTags) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tag-chip tag-chip-player';
      btn.textContent = tag;
      btn.title = `Filter by tag: ${tag}`;
      btn.addEventListener('click', () => {
        this.library.addTag(tag);
      });
      this.trackTagsEl.appendChild(btn);
    }
  }

  // ── End tag management ─────────────────────────────────────────────────────

  private async showVersion(): Promise<void> {
    if (!this.versionBadge) return;
    try {
      const info = await fetchVersion();
      this.versionBadge.textContent = `v${formatVersion(info.version)}`;
      this.versionBadge.title = info.commit ? `${info.version} (commit ${info.commit})` : info.version;
    } catch {
      this.versionBadge.classList.add('d-none');
    }
  }

  private async bindLogout(): Promise<void> {
    if (!this.logoutBtn) return;
    try {
      const status = await fetchAuthStatus();
      if (!status.required) return;
    } catch {
      return;
    }
    this.logoutBtn.classList.remove('d-none');
    this.logoutBtn.addEventListener('click', () => {
      void logout();
    });
  }

  private bindSidebarControls(): void {
    const savedAddress = localStorage.getItem(INTIFACE_ADDRESS_KEY)?.trim();
    const initialHost = formatIntifaceHost(savedAddress ?? 'ws://localhost:12345');
    if (this.intifaceInput) this.intifaceInput.value = initialHost;

    const syncConnectionButton = (): void => {
      if (!this.connectBtn) return;
      const state = this.buttplug.connectionState;
      this.connectBtn.disabled = state === 'connecting';
      this.connectBtn.classList.remove('btn-outline-primary', 'btn-outline-danger', 'btn-outline-secondary');
      if (state === 'connected') {
        this.connectBtn.textContent = 'Disconnect';
        this.connectBtn.classList.add('btn-outline-danger');
      } else if (state === 'connecting') {
        this.connectBtn.textContent = 'Connecting…';
        this.connectBtn.classList.add('btn-outline-secondary');
      } else {
        this.connectBtn.textContent = 'Connect';
        this.connectBtn.classList.add('btn-outline-primary');
      }
    };

    this.intifaceInput?.addEventListener('change', () => {
      const address = normalizeIntifaceAddress(this.intifaceInput?.value ?? 'localhost:12345');
      if (this.intifaceInput) this.intifaceInput.value = formatIntifaceHost(address);
      localStorage.setItem(INTIFACE_ADDRESS_KEY, address);
    });
    this.connectBtn?.addEventListener('click', () => {
      if (this.buttplug.connectionState === 'connected') {
        void this.buttplug.disconnect();
        return;
      }
      const address = normalizeIntifaceAddress(this.intifaceInput?.value ?? 'localhost:12345');
      if (this.intifaceInput) this.intifaceInput.value = formatIntifaceHost(address);
      localStorage.setItem(INTIFACE_ADDRESS_KEY, address);
      void this.buttplug.connect(address);
    });
    this.buttplug.onStateChange(() => syncConnectionButton());
    syncConnectionButton();
  }

  private bindZoomControls(): void {
    if (!this.zoomSlider) return;
    const applyZoom = (rawZoom: number): void => {
      const zoom = Math.max(1, Math.min(10, rawZoom));
      if (this.zoomSlider && Number(this.zoomSlider.value) !== zoom) this.zoomSlider.value = String(zoom);
      if (this.zoomSlider) syncRangeFill(this.zoomSlider);
      this.viz.zoomLevel = zoom;
      this.viz.redraw();
    };
    bindDragOnlyRange(this.zoomSlider);
    this.zoomSlider.addEventListener('input', () => applyZoom(Number(this.zoomSlider?.value ?? 1)));
    applyZoom(Number(this.zoomSlider.value || 1));

    if (this.timelineToggleButton) {
      this.timelineToggleButton.type = 'button';
      this.setTimelineVisibility(false);
      this.timelineToggleButton.addEventListener('click', () => {
        const nextVisible = !this.viz.isVisible();
        this.setTimelineVisibility(nextVisible);
      });
    }

    if (this.timelineLockButton) {
      this.timelineLockButton.type = 'button';
      this.setTimelineLockState(true);
      this.timelineLockButton.addEventListener('click', () => {
        const nextLocked = !this.viz.isLocked();
        this.setTimelineLockState(nextLocked);
      });
    }
  }

  private setTimelineVisibility(visible: boolean): void {
    this.viz.setVisible(visible);
    if (!this.timelineToggleButton) return;
    this.timelineToggleButton.classList.toggle('btn-primary', visible);
    this.timelineToggleButton.classList.toggle('btn-outline-primary', !visible);
    this.timelineToggleButton.setAttribute('aria-pressed', String(visible));
    this.timelineToggleButton.title = visible ? 'Hide timelines' : 'Show timelines';
    const icon = this.timelineToggleButton.querySelector('i');
    if (icon) {
      icon.className = visible ? 'bi bi-eye-fill' : 'bi bi-eye-slash-fill';
    }
  }

  private setTimelineLockState(locked: boolean): void {
    this.viz.setLocked(locked);
    if (this.vizContainer) {
      this.vizContainer.classList.toggle('canvas-locked', locked);
    }
    if (!this.timelineLockButton) return;
    this.timelineLockButton.classList.toggle('btn-primary', locked);
    this.timelineLockButton.classList.toggle('btn-outline-primary', !locked);
    this.timelineLockButton.setAttribute('aria-pressed', String(locked));
    this.timelineLockButton.title = locked ? 'Unlock timelines for seeking' : 'Lock timelines to prevent seeking';
    const icon = this.timelineLockButton.querySelector('i');
    if (icon) {
      icon.className = locked ? 'bi bi-lock-fill' : 'bi bi-unlock-fill';
    }
  }

  private initHapticControls(): void {
    if (!this.hapticSlider) return;
    const savedStrength = Number(localStorage.getItem(HAPTIC_STRENGTH_KEY) ?? '100');
    const initialStrength = Number.isFinite(savedStrength)
      ? Math.max(0, Math.min(100, savedStrength))
      : 100;
    bindDragOnlyRange(this.hapticSlider);
    this.hapticControls.init(this.hapticSlider, this.hapticLabel, initialStrength);
    syncRangeFill(this.hapticSlider);
    this.hapticSlider.addEventListener('input', () => {
      localStorage.setItem(HAPTIC_STRENGTH_KEY, this.hapticSlider?.value ?? String(initialStrength));
      this.syncEngine.resyncNow();
    });
    if (!this.hapticDelaySlider) return;
    const savedDelay = Number(localStorage.getItem(HAPTIC_DELAY_KEY) ?? 0);
    const initialDelay = Number.isFinite(savedDelay) ? Math.max(-200, Math.min(200, savedDelay)) : 0;
    bindDragOnlyRange(this.hapticDelaySlider);
    this.hapticDelaySlider.value = String(initialDelay);
    syncRangeFill(this.hapticDelaySlider);
    this.updateDelayLabel(initialDelay);
    this.syncEngine.setDelayMs(initialDelay);
    this.hapticDelaySlider.addEventListener('input', () => {
      const delay = Number(this.hapticDelaySlider?.value ?? 0);
      localStorage.setItem(HAPTIC_DELAY_KEY, String(delay));
      this.updateDelayLabel(delay);
      this.syncEngine.setDelayMs(delay);
    });
    if (!this.hapticUpdateRateSlider) return;
    const savedRate = Number(localStorage.getItem(HAPTIC_UPDATE_RATE_KEY) ?? 30);
    const initialRate = Number.isFinite(savedRate) ? Math.max(10, Math.min(240, savedRate)) : 30;
    bindDragOnlyRange(this.hapticUpdateRateSlider);
    this.hapticUpdateRateSlider.value = String(initialRate);
    syncRangeFill(this.hapticUpdateRateSlider);
    this.updateHapticUpdateRateLabel(initialRate);
    this.syncEngine.setUpdateFrequencyHz(initialRate);
    this.hapticUpdateRateSlider.addEventListener('input', () => {
      const rate = Number(this.hapticUpdateRateSlider?.value ?? 30);
      localStorage.setItem(HAPTIC_UPDATE_RATE_KEY, String(rate));
      this.updateHapticUpdateRateLabel(rate);
      this.syncEngine.setUpdateFrequencyHz(rate);
    });
  }

  private initBlurContent(): void {
    const blurEnabled = localStorage.getItem(BLUR_CONTENT_KEY) === 'true';
    if (this.blurContentToggle) {
      this.blurContentToggle.checked = blurEnabled;
      this.blurContentToggle.addEventListener('change', () => {
        const isChecked = this.blurContentToggle?.checked ?? false;
        localStorage.setItem(BLUR_CONTENT_KEY, String(isChecked));
        document.body.classList.toggle('blur-content', isChecked);
      });
    }
    document.body.classList.toggle('blur-content', blurEnabled);
  }

  private async handleRouteChange(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const view = params.get('view');
    const id = params.get('id');
    const tags = params.getAll('tag');
    if (tags.length > 0) {
      this.library.setActiveTags(tags);
    }
    if (view === 'player' && id) {
      resetScrollPosition();
      await this.openTrack(id, false, undefined, false);
      return;
    }
    if (view === 'playlist' && id) {
      await this.showPlaylistDetail(id, false);
      return;
    }
    if (view === 'album' && id) {
      await this.showAlbumDetail(id, false);
      return;
    }
    this.showLibrary(false);
  }

  private showLibrary(pushState: boolean): void {
    this.currentTrackId = null;
    if (pushState) history.pushState({}, '', buildUrl('library', undefined, this.library.activeTags_readonly));
    this.libraryView?.classList.remove('d-none');
    this.playerView?.classList.add('d-none');
    this.detailView?.classList.add('d-none');
    this.library.setControlsVisible(true);
    this.library.setViewToggleVisible(true);
    this.library.applyViewModeVisibility();
    this.library.renderActiveTags();
    this.library.render();
    document.title = 'HAPPY';
    this.detailContext = null;
    // Restore scroll position when returning to library view
    window.scrollTo(0, this.savedLibraryScrollPosition);
  }



  private async showPlaylistDetail(playlistId: string, pushState: boolean): Promise<void> {
    // Save scroll position before navigating away from library
    this.savedLibraryScrollPosition = window.scrollY;

    const playlist = this.library.getPlaylist(playlistId);
    if (!playlist) {
      this.navigateTo(buildUrl('library'));
      return;
    }
    if (pushState) history.pushState({ playlistId }, '', detailHref('playlist', playlistId));
    this.detailContext = { type: 'playlist', playlistId };
    this.library.setControlsVisible(false);
    this.libraryView?.classList.remove('d-none');
    this.detailView?.classList.remove('d-none');
    this.playerView?.classList.add('d-none');
    this.library.setContentVisible(false);
    // Show playlist layout, hide album layout
    this.detailAlbumLayout?.classList.add('d-none');
    this.detailPlaylistLayout?.classList.remove('d-none');
    this.detailTypeLabelPlaylist!.textContent = 'Playlist';
    this.detailTitlePlaylist!.textContent = playlist.name;
    this.detailSubtitlePlaylist!.textContent = `${playlist.entries.length} media`;
    this.renderDetailRows(
      playlist.entries.map((entry) => ({
        order: entry.order,
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        onClick: () => { void this.openTrack(entry.trackId, true, { type: 'playlist', id: playlist.id }, true); },
      }))
    );
    this.updateDetailPlayButton(Boolean(playlist.entries[0]?.trackId));
    document.title = `${playlist.name} — HAPPY`;
  }

  private async showAlbumDetail(albumId: string, pushState: boolean): Promise<void> {
    // Save scroll position before navigating away from library
    this.savedLibraryScrollPosition = window.scrollY;

    const album = this.library.getAlbum(albumId);
    if (!album) {
      this.navigateTo(buildUrl('library'));
      return;
    }
    if (pushState) history.pushState({ albumId }, '', detailHref('album', albumId));
    this.detailContext = { type: 'album', albumId };
    this.library.setControlsVisible(false);
    this.libraryView?.classList.remove('d-none');
    this.detailView?.classList.remove('d-none');
    this.playerView?.classList.add('d-none');
    this.library.setContentVisible(false);
    // Show album layout, hide playlist layout
    this.detailAlbumLayout?.classList.remove('d-none');
    this.detailPlaylistLayout?.classList.add('d-none');
    this.detailTypeLabelAlbum!.textContent = 'Album';
    this.detailTitleAlbum!.textContent = album.title;
    this.detailSubtitleAlbum!.textContent = album.artist || 'Unknown artist';
    this.detailYearAlbum!.textContent = album.year ? `${album.year}` : '';
    if (this.detailCoverAlbum) {
      this.detailCoverAlbum.src = renderTrackArt(album.coverTrackId);
      this.detailCoverAlbum.style.display = '';
    }
    this.renderDetailRows(
      album.trackIds.map((trackId, index) => {
        const track = this.allMedia().find((item) => item.id === trackId);
        return {
          order: index + 1,
          title: track?.title ?? trackId,
          artist: track?.artist ?? '',
          album: track?.album ?? '',
          funscripts: track?.funscripts ?? [],
          onClick: () => { void this.openTrack(trackId, true, { type: 'album', id: album.id }); },
        };
      })
    );
    this.updateDetailPlayButton(Boolean(album.trackIds[0]));
    document.title = `${album.title} — HAPPY`;
  }

  private updateDetailPlayButton(enabled: boolean): void {
    if (!this.detailPlayBtn) return;
    this.detailPlayBtn.disabled = !enabled;
  }

  private renderDetailRows(rows: Array<{ order: number; title: string; artist: string; album: string; funscripts?: FunscriptInfo[]; onClick: () => void }>): void {
    if (!this.detailList) return;
    this.detailList.innerHTML = '';
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      const hapticIcons = row.funscripts && row.funscripts.length > 0
        ? `<div class="d-flex flex-wrap gap-1">${renderHapticIcons(row.funscripts.map((f) => f.type))}</div>`
        : '';
      tr.innerHTML = `
        <td class="text-muted">${row.order}</td>
        <td class="fw-semibold">${escapeHtml(row.title)}</td>
        <td class="text-muted d-none d-md-table-cell">${escapeHtml(row.artist)}</td>
        <td class="text-muted d-none d-md-table-cell">${escapeHtml(row.album)}</td>
        <td class="align-middle d-none d-md-table-cell">${hapticIcons}</td>
      `;
      tr.addEventListener('click', row.onClick);
      this.detailList.appendChild(tr);
    }
  }

  private async openTrack(trackId: string, pushState: boolean, source?: QueueSource, autoplay = false): Promise<void> {
    resetScrollPosition();
    const track = this.allMedia().find((item) => item.id === trackId);
    if (!track) {
      this.navigateTo(buildUrl('library'));
      return;
    }
    if (pushState) history.pushState({ trackId }, '', trackHref(trackId));
    this.libraryView?.classList.add('d-none');
    this.playerView?.classList.remove('d-none');
    this.detailView?.classList.add('d-none');
    this.library.setViewToggleVisible(false);
    document.title = `${track.title} — HAPPY`;

    this.currentTrackId = track.id;
    this.renderPlayerTags(track);
    // Browsing only previews: the footer, queue and haptics stay with whatever
    // is playing until the user presses play on this page's player.
    this.playback.browse(track.id, source);

    await this.loadTrackAssets(track);
    if (this.currentTrackId !== track.id) return;
    if (autoplay) await this.playback.activate(track.id, source);
  }

  /** Another file took over playback: repoint haptics and the OS media controls. */
  private async onActiveTrackChanged(track: TrackInfo | null): Promise<void> {
    this.syncEngine.clearScripts();
    if (!track) return;
    this.applyMediaSessionMetadata(track);
    // A queue step swaps the media under the file page, so the page (URL, tags,
    // description) has to follow it. Only when a file page is what's on screen.
    if (this.currentTrackId && this.currentTrackId !== track.id) {
      await this.openTrack(track.id, true, this.queue.source);
    }
    const scripts = await this.fetchTrackScripts(track);
    if (this.session.activeTrackId !== track.id) return;
    this.syncEngine.loadScripts(scripts);
    this.publishChannels(scripts);
    this.syncEngine.resyncNow();
  }

  private renderTrackDescription(markdown: string): void {
    if (!this.descriptionEl || !this.descriptionSection) return;
    const html = markdown.trim() ? Markdown.render(markdown) : '';
    this.descriptionEl.innerHTML = html;
    this.descriptionSection.classList.toggle('d-none', html === '');
  }

  /** Renders the funscript timelines and description of the browsed track. */
  private async loadTrackAssets(track: TrackInfo): Promise<void> {
    this.renderTrackDescription('');
    const scripts = await this.fetchTrackScripts(track);
    if (this.currentTrackId !== track.id) return;

    if (this.vizContainer) {
      this.viz.mount(this.vizContainer, scripts);
      this.viz.redraw();
    }
    this.publishChannels(scripts);
    if (track.descriptionFilename) {
      try {
        const description = await fetchTrackDescription(track.id);
        if (this.currentTrackId === track.id) this.renderTrackDescription(description);
      } catch (err) {
        console.warn(`[player] Failed to load description for ${track.filename}:`, err);
      }
    }
  }

  /** Tell the status badges and the assignment UI which channels this track carries. */
  private publishChannels(scripts: LoadedScript[]): void {
    const channels = scripts.map((script) => script.channel);
    this.deviceStatus.setAvailableChannels(channels);
    this.deviceAssignment.setAvailableChannels(channels);
  }

  private fetchTrackScripts(track: TrackInfo): Promise<LoadedScript[]> {
    const cached = this.scriptCache.get(track.id);
    if (cached) return cached;
    const pending = Promise.all(track.funscripts.map(async (fsInfo) => {
      try {
        const funscript = await fetchFunscript(track.id, fsInfo.filename);
        return { channel: { type: fsInfo.type, ...(fsInfo.sub ? { sub: fsInfo.sub } : {}) }, funscript };
      } catch (err) {
        console.warn(`[player] Failed to load funscript ${fsInfo.filename}:`, err);
        return null;
      }
    })).then((loaded) => loaded.filter((script): script is LoadedScript => script !== null));
    this.scriptCache.set(track.id, pending);
    return pending;
  }

  /** OS-level media controls always describe the playing file, not the browsed one. */
  private applyMediaSessionMetadata(track: TrackInfo): void {
    if (!('mediaSession' in navigator)) return;
    const artwork: MediaImage[] = track.hasArtwork
      ? [{ src: artworkUrl(track.id), type: 'image/jpeg' }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork,
    });
  }

  private updateDelayLabel(delayMs: number): void {
    if (!this.hapticDelayLabel) return;
    const prefix = delayMs > 0 ? '+' : '';
    this.hapticDelayLabel.textContent = `${prefix}${delayMs}ms`;
  }

  private updateHapticUpdateRateLabel(rateHz: number): void {
    if (this.hapticUpdateRateLabel) this.hapticUpdateRateLabel.textContent = `${rateHz}Hz`;
  }

  private navigateTo(url: string): void {
    history.pushState({}, '', url);
    void this.handleRouteChange();
  }

  private isLibraryRoute(): boolean {
    const params = new URLSearchParams(location.search);
    return !params.get('view');
  }
}

async function main(): Promise<void> {
  const slotA = qs<HTMLElement>('#player-slot-a');
  const slotB = qs<HTMLElement>('#player-slot-b');
  if (!slotA || !slotB) return;
  const app = await App.create([slotA, slotB]);
  await app.init();
}

document.addEventListener('DOMContentLoaded', () => { void main(); });
