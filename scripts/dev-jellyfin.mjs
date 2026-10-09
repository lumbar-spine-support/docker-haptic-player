#!/usr/bin/env node
// Local Jellyfin for development: the test fixtures as libraries and the locally built HAPPY plugin.
// See docs/developer/local-jellyfin.md.
//
//   node scripts/dev-jellyfin.mjs up         build the plugin, start Jellyfin, set it up (idempotent)
//   node scripts/dev-jellyfin.mjs plugin     rebuild the plugin and restart Jellyfin
//   node scripts/dev-jellyfin.mjs test-plugin  dotnet test the plugin in the .NET SDK container
//   node scripts/dev-jellyfin.mjs bootstrap  only run the setup against a running Jellyfin
//   node scripts/dev-jellyfin.mjs down       stop Jellyfin, keep its data
//   node scripts/dev-jellyfin.mjs reset      stop Jellyfin and delete its data (fresh wizard on next `up`)
//
// Credentials are generated on first setup and kept in config/dev-jellyfin.env (gitignored), which
// `npm run test:jellyfin:dev` and the "Debug (local Jellyfin)" launch config also read. Nothing here touches config/test.env.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE_FILE = join(ROOT, 'dev/jellyfin/compose.yaml');
const ENV_FILE = join(ROOT, 'config/dev-jellyfin.env');
const PORT = process.env.HAPPY_DEV_JELLYFIN_PORT || '8097';
const BROWSER_URL = `http://localhost:${PORT}`;
const RELAY_URL = `ws://localhost:${process.env.HAPPY_DEV_RELAY_PORT || '8070'}`;
const ADMIN = 'happy-admin';
const USER = 'happy-user';
const AUTH = 'MediaBrowser Client="HAPPY dev", Device="dev-jellyfin", DeviceId="happy-dev-jellyfin", Version="1"';

const LIBRARIES = [
    // NFO sidecars give tags, genres and Markdown overviews; trickplay feeds the storyboards.
    { name: 'Videos', collectionType: 'mixed', path: '/media/videos' },
    // Audiobooks: overview from the ID3 comment, genres as tags, albums from track numbers.
    { name: 'Audio', collectionType: 'books', path: '/media/audio' },
];

function log(message) {
    console.log(`[dev-jellyfin] ${message}`);
}

function fail(message) {
    console.error(`[dev-jellyfin] ${message}`);
    process.exit(1);
}

function compose(...args) {
    const env = { ...process.env, HOST_UID: String(process.getuid?.() ?? 1000), HOST_GID: String(process.getgid?.() ?? 1000) };
    const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit', env });
    if (result.error) fail(`docker compose failed: ${result.error.message}`);
    if (result.status !== 0) fail(`docker compose ${args[0]} exited with ${result.status}`);
}

/** Bind-mount sources must exist, or Docker creates them root-owned on the host. */
function ensureMountSources() {
    for (const dir of ['jellyfin-plugin/artifacts/dev', 'jellyfin-plugin/artifacts/nuget', 'public', 'config']) {
        mkdirSync(join(ROOT, dir), { recursive: true });
    }
}

function buildPlugin() {
    ensureMountSources();
    log('Building the plugin (Debug) in the .NET SDK container…');
    compose('--profile', 'tools', 'run', '--rm', 'plugin-build');
}

function readEnvFile() {
    if (!existsSync(ENV_FILE)) return {};
    return Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n')
        .map(line => line.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value]));
}

function writeEnvFile(values) {
    const lines = [
        '# Written by scripts/dev-jellyfin.mjs for the local dev Jellyfin. Do not commit.',
        ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
        '',
    ];
    writeFileSync(ENV_FILE, lines.join('\n'));
}

/** Default gateway of this container (devcontainer: the Docker host), from /proc/net/route. */
function defaultGateway() {
    try {
        const route = readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)
            .map(line => line.trim().split(/\s+/))
            .find(cols => cols[1] === '00000000');
        if (!route) return null;
        const hex = route[2];
        return [3, 2, 1, 0].map(i => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.');
    } catch {
        return null;
    }
}

async function reachable(base) {
    try {
        const res = await fetch(`${base}/System/Ping`, { signal: AbortSignal.timeout(2000) });
        return res.status < 500 || res.status === 503;
    } catch {
        return false;
    }
}

/** The address this process reaches Jellyfin at: localhost on the host, the bridge gateway in the devcontainer. */
async function resolveBase() {
    const gateway = defaultGateway();
    const candidates = [
        process.env.HAPPY_DEV_JELLYFIN_URL,
        BROWSER_URL,
        `http://host.docker.internal:${PORT}`,
        gateway && `http://${gateway}:${PORT}`,
    ].filter(Boolean);
    for (let attempt = 0; attempt < 90; attempt++) {
        for (const base of candidates) {
            if (await reachable(base)) return base.replace(/\/+$/, '');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    fail(`Jellyfin is not reachable at ${candidates.join(', ')}. Set HAPPY_DEV_JELLYFIN_URL if it runs elsewhere.`);
}

function client(base, token) {
    const authorization = token ? `${AUTH}, Token="${token}"` : AUTH;
    return async function request(path, { method = 'GET', body } = {}) {
        let res;
        // 503 while Jellyfin is still starting, even after /System/Info/Public answers.
        for (let attempt = 0; attempt < 120; attempt++) {
            res = await fetch(`${base}${path}`, {
                method,
                headers: { Authorization: authorization, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            if (res.status !== 503) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!res.ok) {
            const detail = (await res.text().catch(() => '')).slice(0, 200);
            throw new Error(`${method} ${path} → HTTP ${res.status} ${detail}`.trim());
        }
        const type = res.headers.get('content-type') ?? '';
        return type.includes('json') ? res.json() : res.text();
    };
}

/** Waits until Jellyfin has finished starting (it answers 503 while it loads). */
async function waitForStartup(base) {
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            // While starting, Jellyfin answers every route with an HTML status page, sometimes with 200.
            const res = await fetch(`${base}/System/Info/Public`);
            if (res.ok && res.headers.get('content-type')?.includes('json')) return res.json();
        } catch {
            // still starting
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    fail('Jellyfin did not finish starting within 2 minutes (docker compose -f dev/jellyfin/compose.yaml logs jellyfin).');
}

/** Waits until the (re)started Jellyfin serves the plugin's anonymous docs index. */
async function waitForPlugin(base) {
    await waitForStartup(base);
    for (let attempt = 0; attempt < 120; attempt++) {
        try {
            const res = await fetch(`${base}/Happy/Docs`);
            if (res.ok) return;
        } catch {
            // still starting
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    fail('The HAPPY plugin did not come up (docker compose -f dev/jellyfin/compose.yaml logs jellyfin).');
}

async function login(base, name, password) {
    const res = await fetch(`${base}/Users/AuthenticateByName`, {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ Username: name, Pw: password }),
    });
    if (!res.ok) return null;
    return (await res.json()).AccessToken;
}

async function runWizard(base, adminPassword) {
    log('Running the first-run wizard…');
    const anonymous = client(base);
    await anonymous('/Startup/Configuration', {
        method: 'POST',
        body: { UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' },
    });
    await anonymous('/Startup/User'); // creates the first user
    await anonymous('/Startup/User', { method: 'POST', body: { Name: ADMIN, Password: adminPassword } });
    await anonymous('/Startup/RemoteAccess', { method: 'POST', body: { EnableRemoteAccess: true } });
    await anonymous('/Startup/Complete', { method: 'POST' });
}

async function ensureLibraries(admin) {
    const existing = new Set((await admin('/Library/VirtualFolders')).map(folder => folder.Name));
    for (const { name, collectionType, path } of LIBRARIES) {
        if (existing.has(name)) continue;
        log(`Creating library "${name}" (${collectionType}) over ${path}…`);
        const query = new URLSearchParams({ name, collectionType, paths: path, refreshLibrary: 'false' });
        await admin(`/Library/VirtualFolders?${query}`, {
            method: 'POST',
            body: {
                LibraryOptions: {
                    PathInfos: [{ Path: path }],
                    LocalMetadataReaderOrder: ['Nfo'],
                    EnableRealtimeMonitor: true,
                    EnableTrickplayImageExtraction: true,
                    ExtractTrickplayImagesDuringLibraryScan: true,
                    EnableChapterImageExtraction: false,
                },
            },
        });
    }
}

async function ensureUser(admin, password) {
    const users = await admin('/Users');
    let user = users.find(u => u.Name === USER);
    if (!user) {
        log(`Creating non-admin user "${USER}"…`);
        user = await admin('/Users/New', { method: 'POST', body: { Name: USER, Password: password } });
    }
    const policy = { ...user.Policy, IsAdministrator: false, EnableAllFolders: true, EnableMediaPlayback: true };
    await admin(`/Users/${user.Id}/Policy`, { method: 'POST', body: policy });
}

async function scanLibrary(admin) {
    const task = () => admin('/ScheduledTasks?isHidden=false').then(tasks => tasks.find(t => t.Key === 'RefreshLibrary'));
    const before = (await task())?.LastExecutionResult?.EndTimeUtc ?? '';
    log('Scanning the libraries (with trickplay, this takes a minute on first run)…');
    await admin('/Library/Refresh', { method: 'POST' });
    for (let attempt = 0; attempt < 600; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const current = await task();
        const ended = current?.LastExecutionResult?.EndTimeUtc ?? '';
        if (current?.State === 'Idle' && ended && ended !== before) return;
    }
    log('The scan is still running; continuing anyway.');
}

/** Turns on DG-Lab with the dev relay, unless the relay address was already set by hand. */
async function ensureDglab(admin) {
    const pluginId = '98652011fd1c4b308359fcae3b45ed37';
    const config = await admin(`/Plugins/${pluginId}/Configuration`).catch(() => null);
    if (!config || config.DglabRelayUrl) return;
    log(`Enabling DG-Lab with the dev relay at ${RELAY_URL}…`);
    await admin(`/Plugins/${pluginId}/Configuration`, {
        method: 'POST',
        body: { ...config, DglabEnabled: true, DglabRelayUrl: RELAY_URL },
    });
}

async function reportPlugin(base, admin, userPassword) {
    const plugins = await admin('/Plugins');
    const happy = plugins.find(p => p.Name === 'HAPPY');
    if (!happy) {
        log('WARNING: the HAPPY plugin is not loaded. Check `docker compose -f dev/jellyfin/compose.yaml logs jellyfin`.');
        return;
    }
    log(`HAPPY plugin ${happy.Version}: ${happy.Status}`);
    const token = await login(base, USER, userPassword);
    const scripts = token ? await client(base, token)('/Happy/Funscripts').catch(() => null) : null;
    if (scripts) log(`Items with funscripts visible to ${USER}: ${Object.keys(scripts).length}`);
}

async function bootstrap() {
    mkdirSync(join(ROOT, 'config'), { recursive: true });
    const base = await resolveBase();
    const info = await waitForStartup(base);
    const env = readEnvFile();
    const adminPassword = env.HAPPY_DEV_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
    const userPassword = env.HAPPY_JELLYFIN_PASSWORD || randomBytes(12).toString('base64url');
    writeEnvFile({
        HAPPY_JELLYFIN_URL: base,
        HAPPY_JELLYFIN_USER: USER,
        HAPPY_JELLYFIN_PASSWORD: userPassword,
        HAPPY_DEV_ADMIN_USER: ADMIN,
        HAPPY_DEV_ADMIN_PASSWORD: adminPassword,
        // For the HAPPY Node server ("Debug (local Jellyfin)" launch config).
        JELLYFIN_URL: BROWSER_URL,
        JELLYFIN_INTERNAL_URL: base,
    });

    if (!info.StartupWizardCompleted) await runWizard(base, adminPassword);
    const adminToken = await login(base, ADMIN, adminPassword);
    if (!adminToken) {
        fail(`Cannot sign in as ${ADMIN} with the password in config/dev-jellyfin.env. ` +
            'The Jellyfin data predates that file; run `npm run dev:jellyfin:reset` and start again.');
    }
    const admin = client(base, adminToken);
    await ensureLibraries(admin);
    await ensureUser(admin, userPassword);
    await ensureDglab(admin);
    await scanLibrary(admin);
    await reportPlugin(base, admin, userPassword);

    const { Version: version } = await admin('/System/Info/Public');
    log(`Ready: ${BROWSER_URL} (Jellyfin ${version})`);
    log(`  user  ${USER} / ${userPassword}`);
    log(`  admin ${ADMIN} / ${adminPassword}`);
    log('  credentials: config/dev-jellyfin.env');
}

async function main() {
    const command = process.argv[2] ?? 'up';
    switch (command) {
        case 'up':
            buildPlugin();
            ensureMountSources();
            compose('up', '-d', '--build', 'jellyfin', 'dglab-relay');
            await bootstrap();
            break;
        case 'plugin':
            buildPlugin();
            // Recreate rather than restart, so a changed HAPPY_DEV_* environment takes effect too.
            ensureMountSources();
            compose('up', '-d', '--force-recreate', 'jellyfin');
            await waitForPlugin(await resolveBase());
            log('Plugin reloaded.');
            break;
        case 'test-plugin':
            ensureMountSources();
            compose('--profile', 'tools', 'run', '--rm', 'plugin-test');
            break;
        case 'bootstrap':
            await bootstrap();
            break;
        case 'down':
            compose('down');
            break;
        case 'reset':
            compose('down', '--volumes');
            break;
        default:
            fail(`Unknown command "${command}". Use up, plugin, bootstrap, down or reset.`);
    }
}

main().catch(err => fail(err instanceof Error ? err.message : String(err)));
