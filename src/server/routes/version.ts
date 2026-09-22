import { Router } from 'express';
import fs from 'fs';
import path from 'path';

// Baked into the image at build time; falls back to package.json for `npm start`.
function resolveVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Release channel of the running image; inferred from the version when not stamped in.
function resolveChannel(version: string): string {
  const explicit = process.env.APP_CHANNEL?.trim();
  if (explicit) return explicit;
  if (/-preview\b/.test(version)) return 'preview';
  if (version.includes('-')) return 'dev';
  return 'stable';
}

export function createVersionRouter(): Router {
  const router = Router();
  const version = resolveVersion();
  const channel = resolveChannel(version);
  const commit = process.env.GIT_COMMIT ?? null;
  const builtAt = process.env.BUILD_DATE ?? null;

  router.get('/', (_req, res) => {
    res.json({ version, channel, commit, builtAt });
  });

  return router;
}
