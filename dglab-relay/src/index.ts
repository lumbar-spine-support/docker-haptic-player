// HAPPY DG-Lab relay: passes DG-Lab v4 frames between one HAPPY tab and the DG-Lab app.
// Configuration comes only from the environment; see dglab-relay/README.md.

import { createJellyfinTokenVerifier } from './jellyfinAuth';
import { createLogger, isLogLevel, LOG_LEVELS, setLogLevel } from './logger';
import { createRelayServer } from './server';

const log = createLogger('[dglab-relay]');

function main(): void {
  const level = process.env.LOG_LEVEL;
  if (level && !isLogLevel(level)) log.warn(`Unknown LOG_LEVEL "${level}". Valid levels: ${LOG_LEVELS.join(', ')}`);
  setLogLevel(level);

  const jellyfinUrl = (process.env.JELLYFIN_URL ?? '').trim().replace(/\/+$/, '');
  if (!jellyfinUrl) {
    log.error('JELLYFIN_URL is not set. The relay checks every HAPPY tab\'s sign-in with that Jellyfin server.');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8070);

  const { server, close } = createRelayServer(createJellyfinTokenVerifier(jellyfinUrl));
  server.listen(port, () => log.info(`Listening on :${port}, checking sign-ins with ${jellyfinUrl}`));

  const shutdown = (): void => {
    log.info('Shutting down');
    void close().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
