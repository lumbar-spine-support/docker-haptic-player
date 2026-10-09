import { Router } from 'express';
import type { Config } from '../config';
import { CHAPTER_SOURCES, type ChapterSource, type ClientSettings } from '../../shared/types';
import { DEFAULT_INTERPOLATION_METHOD, isInterpolationMethod } from '../../shared/interpolation';
import { isLevelEnabled } from '../utils/logger';

const isChapterSource = (value: string): value is ChapterSource => (CHAPTER_SOURCES as readonly string[]).includes(value);

/** Exposes the server-configured defaults the client falls back to on first run. */
export function createConfigRouter(clientConfig: Config.ClientConfig): Router {
  const router = Router();
  const settings: Omit<ClientSettings, 'debugLogging'> = {
    videoSeekInterval: Number(clientConfig.videoSeekInterval),
    blurContent: Boolean(clientConfig.blurContent),
    hapticFrequency: Number(clientConfig.hapticFrequency),
    hapticDelay: Number(clientConfig.hapticDelay),
    hapticDelayLimit: Math.max(0, Math.abs(Number(clientConfig.hapticDelayLimit)) || 0),
    dglabEnabled: Boolean(clientConfig.dglabEnabled),
    dglabSandboxEnabled: Boolean(clientConfig.dglabEnabled) && Boolean(clientConfig.dglabSandboxEnabled),
    dglabRelayUrl: String(clientConfig.dglabRelayUrl ?? '').trim(),
    autoReconnectIntiface: Boolean(clientConfig.autoReconnectIntiface),
    autoReconnectDglab: Boolean(clientConfig.autoReconnectDglab),
    funscriptInterpolationMethod: isInterpolationMethod(clientConfig.funscriptInterpolationMethod)
      ? clientConfig.funscriptInterpolationMethod
      : DEFAULT_INTERPOLATION_METHOD,
    funscriptColorGradient: Boolean(clientConfig.funscriptColorGradient),
    cardViewForceSquareArtwork: Boolean(clientConfig.cardViewForceSquareArtwork),
    cardViewLargePortraitArtwork: Boolean(clientConfig.cardViewLargePortraitArtwork),
    jellyfinUrl: String(clientConfig.jellyfinUrl),
    funscriptSuffixes: {
      separator: String(clientConfig.funscriptSuffixSeparator),
      stroker: String(clientConfig.funscriptSuffixStroker),
      buttplug: String(clientConfig.funscriptSuffixButtplug),
      vibrator: String(clientConfig.funscriptSuffixVibrator),
      estim: String(clientConfig.funscriptSuffixEstim),
      machine: String(clientConfig.funscriptSuffixMachine),
    },
    chapterSourcePriority: (clientConfig.chapterSourcePriority as string[]).filter(isChapterSource),
  };
  router.get('/', (_req, res) => {
    res.json({ ...settings, debugLogging: isLevelEnabled('debug') });
  });
  return router;
}
