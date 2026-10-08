import { fetchFunscript, fetchTrackDescription, fetchDoc, docAssetUrl, fetchVersion, fetchAuthStatus, fetchClientSettings, setMediaAccessToken, setStoryboardsEnabled, logout, artworkUrl } from './api';
import { formatVersion } from './utils/formatVersion';
import { qs } from './utils/html';
import { storedSetting } from './utils/storedSetting';
import { keepScreenOnWhilePlaying } from './utils/wakeLock';
import { Router, buildUrl, trackHref, detailHref } from './router';
import { bindDragOnlyRange, syncRangeFill } from './components/ui/rangeSlider';
import { resetScrollPosition } from './scroll';
import { PlaybackSession, PlaybackQueue, PlaybackController } from './components/player';
import type { PlayerFooterElement } from './components/player';
import { ButtplugClientManager } from './components/haptic/buttplugClient';
import { HapticBackendRegistry } from './components/haptic/backendRegistry';
import { CoyoteBackend } from './components/haptic/dglab/coyoteBackend';
import { bindPairingPanel } from './components/haptic/dglab/pairingPanel';
import { DglabSandbox } from './components/haptic/dglab/sandboxView';
import { setLogLevel } from './utils/logger';
import { FunscriptSync, type LoadedScript } from './components/funscriptSync';
import { prepareScript } from '../shared/interpolation';
import { DeviceStatus } from './components/haptic/deviceStatus';
import { DeviceAssignment } from './components/haptic/deviceAssignment';
import type { HapticBackend } from './components/haptic/backend';
import { Visualization } from './components/haptic/visualization';
import { Markdown } from './components/markdown';
import { Library } from './components/library';
import { DetailView } from './components/library/detail';
import { bindIntifaceSettings } from './components/settings/intiface';
import { bindDelaySlider, bindUpdateRateSlider } from './components/settings/haptics';
import { bindToggle } from './components/settings/toggle';
import type { TrackInfo, QueueSource, ClientSettings } from '../shared/types';
import type { HapticChannel } from '../shared/haptics';

import '@videojs/html/ui/title';
import '@videojs/html/icons/element'

// <video-player> with our extra loop feature; must register before any skin uses it.
import '@/components/videojs/player';

// Ejected Compat Skin (shadcn: @videojs/video from the compat registry)
// Registers <video-compat-skin> from the ejected skin.html/skin.css.
import '@/components/videojs/video/element';

const INTIFACE_DELAY_KEY = 'happy-haptic-delay-ms';
const DGLAB_DELAY_KEY = 'happy-dglab-delay-ms';

/** Used when the server config cannot be reached. */
const FALLBACK_SETTINGS: ClientSettings = {
  videoSeekInterval: 10,
  storyboards: false,
  blurContent: false,
  hapticFrequency: 30,
  hapticDelay: 0,
  hapticDelayLimit: 500,
  dglabEnabled: false,
  dglabSandboxEnabled: false,
  autoReconnectIntiface: false,
  autoReconnectDglab: false,
  debugLogging: false,
  funscriptInterpolationMethod: 'pchip',
  funscriptColorGradient: false,
  cardViewForceSquareArtwork: false,
  cardViewLargePortraitArtwork: true,
  mediaAccessToken: null,
};

class App {
  private readonly libraryView = qs<HTMLElement>('#library-view');
  private readonly playerView = qs<HTMLElement>('#player-view');
  private readonly detailView = qs<HTMLElement>('#detail-view');
  private readonly docsView = qs<HTMLElement>('#docs-view');
  private readonly docsContent = qs<HTMLElement>('#docs-content');
  private readonly docsButton = qs<HTMLAnchorElement>('#btn-docs');
  private readonly vizContainer = qs<HTMLElement>('#visualization');
  private readonly funscriptsSection = qs<HTMLElement>('#funscripts-section');
  private readonly descriptionSection = qs<HTMLElement>('#track-description-section');
  private readonly descriptionEl = qs<HTMLElement>('#track-description');
  private readonly trackTagsSection = qs<HTMLElement>('#track-tags-section');
  private readonly trackTagsEl = qs<HTMLElement>('#track-tags');
  private readonly zoomSlider = qs<HTMLInputElement>('#viz-zoom');
  private readonly timelineToggleButton = qs<HTMLButtonElement>('#viz-toggle');
  private readonly timelineLockButton = qs<HTMLButtonElement>('#viz-lock');
  private readonly footer = qs<PlayerFooterElement>('#player-footer');
  private readonly versionBadge = qs<HTMLElement>('#app-version');
  private readonly logoutBtn = qs<HTMLButtonElement>('#btn-logout');

  private readonly buttplug = new ButtplugClientManager();
  /** Fans every haptic operation out across Intiface and, when enabled, DG-Lab. */
  private readonly haptics = new HapticBackendRegistry();
  /** Owns the two interchangeable players; one of them is always the playing one. */
  private readonly session: PlaybackSession;
  private readonly queue = new PlaybackQueue();
  private readonly playback: PlaybackController;
  /** One engine per backend, so each can apply its own delay correction. */
  private readonly syncEngines: FunscriptSync[] = [];
  private readonly intifaceSync: FunscriptSync;
  private activeScripts: LoadedScript[] = [];
  private readonly deviceStatus: DeviceStatus;
  /** One device list per backend, rendered inside that backend's settings section. */
  private readonly deviceAssignments: DeviceAssignment[] = [];
  private trackChannels: HapticChannel[] = [];
  private readonly viz: Visualization;
  private readonly library: Library;
  private readonly detail: DetailView;
  private readonly router: Router;
  /** Resampling rate picked in the settings; engines created later start with it. */
  private updateRateHz: number | null = null;
  private dglabSandbox: DglabSandbox | null = null;

  private currentTrackId: string | null = null;
  /** Funscripts per track id, shared by the timeline view and the haptic engine. */
  private readonly scriptCache = new Map<string, Promise<LoadedScript[]>>();
  /** Scroll position to restore when returning to library view */
  private savedLibraryScrollPosition = 0;
  /** Server-provided defaults, applied only where localStorage has no stored value. */
  private settings: ClientSettings = FALLBACK_SETTINGS;
  private readonly setKeepScreenOn: (enabled: boolean) => void;

  /** Waits for the `<video-player>` elements to upgrade before wiring the app. */
  static async create(playerHosts: [HTMLElement, HTMLElement]): Promise<App> {
    return new App(await PlaybackSession.create(playerHosts));
  }

  private constructor(session: PlaybackSession) {
    this.session = session;
    this.setKeepScreenOn = keepScreenOnWhilePlaying(session);
    this.queue.autoplay = storedSetting('happy-autoplay', true).get();
    this.haptics.add(this.buttplug);
    this.intifaceSync = this.createSyncEngine(this.buttplug);
    this.deviceStatus = new DeviceStatus(this.haptics);
    this.viz = new Visualization(session);
    this.viz.onSeek((time) => { void session.focusedStore.seek(time); });

    this.router = new Router({
      before: () => {
        this.docsView?.classList.add('d-none');
        this.dglabSandbox?.hide();
      },
      tags: (tags) => this.library.setActiveTags(tags),
      docs: (page) => this.showDocs(page),
      player: (id) => {
        resetScrollPosition();
        return this.openTrack(id, false, undefined, false);
      },
      playlist: async (id) => this.showPlaylistDetail(id, false),
      album: async (id) => this.showAlbumDetail(id, false),
      library: () => this.showLibrary(false),
      dglabSandbox: () => this.showDglabSandbox(),
    });
    this.library = new Library({
      openTrack: (id) => { void this.openTrack(id, true); },
      openAlbum: (id) => this.showAlbumDetail(id, true),
      openPlaylist: (id) => this.showPlaylistDetail(id, true),
      navigateTo: (url) => this.navigateTo(url),
      isLibraryRoute: () => this.router.isLibraryRoute(),
      showLibrary: () => this.showLibrary(false),
    });
    this.detail = new DetailView({
      allMedia: () => this.allMedia(),
      openTrack: (id, source, autoplay) => { void this.openTrack(id, true, source, autoplay); },
    });
    this.playback = new PlaybackController(this.library, this.queue, session);
  }

  /** All playable media items (audio tracks and videos combined). */
  private allMedia(): TrackInfo[] {
    return this.library.allMedia();
  }

  /** The seek indicator shows whatever step the triggering hotkey/gesture carries, so the interval goes there. */
  private applySeekInterval(): void {
    const step = this.settings.videoSeekInterval;
    document.querySelectorAll<HTMLElement>('media-hotkey[action="seekStep"], media-gesture[action="seekStep"]').forEach((el) => {
      const keys = el.getAttribute('keys')?.toLowerCase();
      const backward = keys === 'arrowleft' || keys === 'j' || el.getAttribute('region') === 'left';
      // An attribute survives custom-element upgrade; a property set beforehand is reset by the constructor.
      el.setAttribute('value', String(backward ? -step : step));
    });
  }

  async init(): Promise<void> {
    try {
      this.settings = await fetchClientSettings();
    } catch (err) {
      console.warn('Falling back to built-in client settings:', err);
    }
    setMediaAccessToken(this.settings.mediaAccessToken);
    setStoryboardsEnabled(this.settings.storyboards);
    this.applySeekInterval();
    this.library.setForceSquareArtwork(this.settings.cardViewForceSquareArtwork);
    this.library.setLargePortraitArtwork(this.settings.cardViewLargePortraitArtwork);
    this.library.bindControls();
    bindIntifaceSettings(this.buttplug, this.settings.autoReconnectIntiface);
    bindToggle('#blur-content-toggle', 'happy-blur-content', this.settings.blurContent,
      (enabled) => document.body.classList.toggle('blur-content', enabled));
    bindToggle('#color-gradient-toggle', 'happy-color-gradient', this.settings.funscriptColorGradient,
      (enabled) => this.viz.setColorGradient(enabled));
    bindToggle('#keep-screen-on-toggle', 'happy-keep-screen-on', true, this.setKeepScreenOn);
    this.bindZoomControls();
    whenIdle(() => {
      void this.showVersion();
      void this.bindLogout();
    });
    this.footer?.bind(this.session, this.playback, (trackId) => this.navigateTo(trackHref(trackId)));

    this.mountDeviceAssignment(this.buttplug, '#intiface-devices');

    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) {
      settingsPanel.addEventListener('show.bs.offcanvas', () => {
        for (const assignment of this.deviceAssignments) assignment.refresh();
      });
    }

    this.initHapticControls();
    await this.initDglab();
    this.playback.onActiveTrack((track) => { void this.onActiveTrackChanged(track); });

    await yieldToMain();
    await this.library.load();
    await yieldToMain();
    await this.router.start();

    // Closing or backgrounding the tab must silence the devices, not leave them running.
    window.addEventListener('pagehide', () => { void this.haptics.stopAll(); });

    if (this.docsButton) this.docsButton.href = buildUrl('docs', 'index');
    this.docsButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.navigateTo(buildUrl('docs', 'index'));
    });
    this.docsContent?.addEventListener('click', (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-doc-link]');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      this.navigateTo(link.href);
    });
  }

  private mountDeviceAssignment(backend: HapticBackend, containerSelector: string): void {
    const container = qs<HTMLElement>(containerSelector);
    if (!container) return;
    const assignment = new DeviceAssignment(backend);
    assignment.setAvailableChannels(this.trackChannels);
    assignment.mount(container);
    this.deviceAssignments.push(assignment);
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

  private bindZoomControls(): void {
    if (!this.zoomSlider) return;
    const applyZoom = (rawZoom: number): void => {
      const zoom = Math.max(1, rawZoom);
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

  private createSyncEngine(backend: HapticBackend): FunscriptSync {
    const engine = new FunscriptSync(this.session, backend);
    if (this.updateRateHz !== null) engine.setUpdateFrequencyHz(this.updateRateHz);
    engine.loadScripts(this.activeScripts);
    this.syncEngines.push(engine);
    return engine;
  }

  private initHapticControls(): void {
    bindDelaySlider(this.intifaceSync, 'haptic-delay', INTIFACE_DELAY_KEY, this.settings.hapticDelay, this.settings.hapticDelayLimit);
    bindUpdateRateSlider(this.settings.hapticFrequency, (rate) => {
      this.updateRateHz = rate;
      for (const engine of this.syncEngines) engine.setUpdateFrequencyHz(rate);
    });
  }

  /**
   * Sets up the DG-Lab section, or removes it outright when the server flag is off.
   *
   * The backend is only constructed when enabled, so a disabled deployment never
   * opens a relay socket.
   */
  private async initDglab(): Promise<void> {
    const section = document.getElementById('dglab-section');
    if (!this.settings.dglabEnabled) {
      section?.remove();
      return;
    }

    if (this.settings.debugLogging) setLogLevel('dglab', 'debug');
    const coyote = new CoyoteBackend();
    this.haptics.add(coyote);
    bindDelaySlider(this.createSyncEngine(coyote), 'dglab-delay', DGLAB_DELAY_KEY, 0, this.settings.hapticDelayLimit);
    this.mountDeviceAssignment(coyote, '#dglab-devices');
    bindPairingPanel(coyote, this.settings.autoReconnectDglab);

    const sandboxButton = qs<HTMLAnchorElement>('#btn-dglab-sandbox');
    if (!this.settings.dglabSandboxEnabled) {
      sandboxButton?.remove();
      return;
    }
    // Media haptics would fight the pattern for the same channel.
    this.dglabSandbox = new DglabSandbox(coyote, () => this.session.activeStore.pause());
    sandboxButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.navigateTo(buildUrl('dglab-sandbox'));
    });
  }

  /** Falls back to the library when the sandbox is disabled. */
  private showDglabSandbox(): void {
    if (!this.dglabSandbox) {
      this.showLibrary(false);
      return;
    }
    this.currentTrackId = null;
    this.detail.clear();
    this.libraryView?.classList.add('d-none');
    this.playerView?.classList.add('d-none');
    this.detailView?.classList.add('d-none');
    this.library.setViewToggleVisible(false);
    this.dglabSandbox.show();
  }

  private async showDocs(page: string): Promise<void> {
    this.currentTrackId = null;
    this.detail.clear();
    this.libraryView?.classList.add('d-none');
    this.playerView?.classList.add('d-none');
    this.detailView?.classList.add('d-none');
    this.docsView?.classList.remove('d-none');
    this.library.setViewToggleVisible(false);
    document.title = 'Documentation — HAPPY';
    if (!this.docsContent) return;
    let markdown: string;
    try {
      markdown = await fetchDoc(page);
    } catch (err) {
      console.warn(`[docs] Failed to load page "${page}":`, err);
      markdown = `# Page not found\n\n[Back to the documentation overview](index.md)`;
    }
    this.docsContent.innerHTML = Markdown.renderDoc(markdown, {
      pageHref: (target, hash) => `${buildUrl('docs', target)}${hash}`,
      assetHref: docAssetUrl,
    });
    const hash = location.hash.slice(1);
    const anchor = hash ? document.getElementById(decodeURIComponent(hash)) : null;
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
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
    this.detail.clear();
    // Restore scroll position when returning to library view
    window.scrollTo(0, this.savedLibraryScrollPosition);
  }

  /** Shows the detail page over the (hidden) library grid, remembering where the grid was scrolled to. */
  private enterDetailView(state: object, href: string, pushState: boolean): void {
    this.savedLibraryScrollPosition = window.scrollY;
    if (pushState) history.pushState(state, '', href);
    this.library.setControlsVisible(false);
    this.libraryView?.classList.remove('d-none');
    this.detailView?.classList.remove('d-none');
    this.playerView?.classList.add('d-none');
    this.library.setContentVisible(false);
  }

  private showPlaylistDetail(playlistId: string, pushState: boolean): void {
    const playlist = this.library.getPlaylist(playlistId);
    if (!playlist) {
      this.navigateTo(buildUrl('library'));
      return;
    }
    this.enterDetailView({ playlistId }, detailHref('playlist', playlistId), pushState);
    this.detail.showPlaylist(playlist);
    document.title = `${playlist.name} — HAPPY`;
  }

  private showAlbumDetail(albumId: string, pushState: boolean): void {
    const album = this.library.getAlbum(albumId);
    if (!album) {
      this.navigateTo(buildUrl('library'));
      return;
    }
    this.enterDetailView({ albumId }, detailHref('album', albumId), pushState);
    this.detail.showAlbum(album);
    document.title = `${album.title} — HAPPY`;
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
    this.activeScripts = [];
    for (const engine of this.syncEngines) engine.clearScripts();
    if (!track) return;
    this.applyMediaSessionMetadata(track);
    // A queue step swaps the media under the file page, so the page (URL, tags,
    // description) has to follow it. Only when a file page is what's on screen.
    if (this.currentTrackId && this.currentTrackId !== track.id) {
      await this.openTrack(track.id, true, this.queue.source);
    }
    const scripts = await this.fetchTrackScripts(track);
    if (this.session.activeTrackId !== track.id) return;
    this.activeScripts = scripts;
    for (const engine of this.syncEngines) engine.loadScripts(scripts);
    this.publishChannels(scripts);
    for (const engine of this.syncEngines) engine.resyncNow();
  }

  private renderTrackDescription(markdown: string): void {
    if (!this.descriptionEl || !this.descriptionSection) return;
    const html = markdown.trim() ? Markdown.render(markdown) : '';
    this.descriptionEl.innerHTML = html;
    this.descriptionSection.classList.toggle('d-none', html === '');
  }

  private renderFunscripts(scripts: LoadedScript[]): void {
    if (!this.funscriptsSection) return;
    this.funscriptsSection.classList.toggle('d-none', scripts.length === 0);
  }

  /** Renders the funscript timelines and description of the browsed track. */
  private async loadTrackAssets(track: TrackInfo): Promise<void> {
    this.renderTrackDescription('');
    const scripts = await this.fetchTrackScripts(track);
    if (this.currentTrackId !== track.id) return;

    this.renderFunscripts(scripts);
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
    this.trackChannels = channels;
    this.deviceStatus.setAvailableChannels(channels);
    for (const assignment of this.deviceAssignments) assignment.setAvailableChannels(channels);
  }

  private fetchTrackScripts(track: TrackInfo): Promise<LoadedScript[]> {
    const cached = this.scriptCache.get(track.id);
    if (cached) return cached;
    const pending = Promise.all(track.funscripts.map(async (fsInfo) => {
      try {
        const funscript = await fetchFunscript(track.id, fsInfo.filename);
        const channel: HapticChannel = { type: fsInfo.type, ...(fsInfo.sub ? { sub: fsInfo.sub } : {}) };
        return { channel, prepared: prepareScript(funscript.actions, this.settings.funscriptInterpolationMethod) };
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
      ? [{ src: artworkUrl(track.id, track.artworkVersion), type: 'image/jpeg' }]
      : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork,
    });
  }

  private navigateTo(url: string): void {
    this.router.navigateTo(url);
  }
}

function whenIdle(fn: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}

/** Ends the current task so the browser can paint and handle input before continuing. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function main(): Promise<void> {
  const slotA = qs<HTMLElement>('#player-slot-a');
  const slotB = qs<HTMLElement>('#player-slot-b');
  if (!slotA || !slotB) return;
  const app = await App.create([slotA, slotB]);
  await app.init();
}

document.addEventListener('DOMContentLoaded', () => { void main(); });
