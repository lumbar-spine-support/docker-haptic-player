import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, devices } from 'playwright';

const SERVER_URL = 'http://localhost:3000';
const LANDSCAPE_VIEWPORT = { width: 412, height: 915 };
const SCREENSHOT_FULL_PAGE = false;
// Card title of test/fixtures/media/BigBuckBunny_320x180.mp4 (Jellyfin falls back to the file name).
const PLAYER_MEDIA = /big\s*buck\s*bunny/i;

// Screenshots end up in the public docs, so they come from a demo Jellyfin holding only
// test/fixtures/media, never from a personal library. Deliberately separate from the
// HAPPY_JELLYFIN_* variables of the integration tests.
const { SCREENSHOT_JELLYFIN_URL, SCREENSHOT_JELLYFIN_USER, SCREENSHOT_JELLYFIN_PASSWORD = '' } = process.env;
if (!SCREENSHOT_JELLYFIN_URL || !SCREENSHOT_JELLYFIN_USER) {
    console.error('Set SCREENSHOT_JELLYFIN_URL and SCREENSHOT_JELLYFIN_USER (and SCREENSHOT_JELLYFIN_PASSWORD) to a demo Jellyfin '
        + 'that serves test/fixtures/media with the HAPPY plugin installed.');
    process.exit(1);
}

async function capture(page, path) {
    // avoid focus/hover/selection styling leaking into the screenshot
    await page.evaluate(() => {
        document.activeElement?.blur?.();
        window.getSelection?.()?.removeAllRanges();
    });
    await page.mouse.move(0, 0);
    await page.screenshot({ path, fullPage: SCREENSHOT_FULL_PAGE });
}

async function run(command, args, options = {}) {
    const child = spawn(command, args, {
        stdio: 'inherit',
        shell: false,
        ...options,
    });

    const [code] = await once(child, 'exit');

    if (code !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed with exit code ${code}`);
    }
}

async function assertPortFree(url) {
    try {
        await fetch(url);
    } catch {
        return;
    }

    // Otherwise waitForServer would happily accept the stale server and screenshot the wrong build.
    throw new Error(`Something is already listening on ${url}; stop it before taking screenshots`);
}

async function waitForServer(url, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);

            if (response.ok || response.status < 500) {
                return;
            }
        } catch {
            // Server is not ready yet.
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`Timed out waiting for server at ${url}`);
}

async function applyMediaFilter(page, filterName) {
    const filterTypes = {
        audio: 'tracks',
        track: 'tracks',
        tracks: 'tracks',
        video: 'videos',
        videos: 'videos',
    };

    const filterType = filterTypes[filterName.toLowerCase()] ?? filterName;
    const input = page.locator(`input[data-filter-type="${filterType}"]`).first();

    if (!(await input.count())) {
        throw new Error(`Could not find "${filterName}" media filter`);
    }

    const isChecked = await input.isChecked();

    if (isChecked) {
        return;
    }

    // set directly instead of clicking so no hover/focus styling remains for screenshots
    await input.evaluate((element) => {
        element.checked = true;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function clickPlayerMedia(page) {
    // Library ids are Jellyfin item ids, so the card is found by its title.
    const card = page.locator('#track-grid .track-card', { has: page.locator('.card-title', { hasText: PLAYER_MEDIA }) });
    const link = card.locator('a.track-art-link[href*="view=player"]').first();

    if (!(await link.count())) {
        throw new Error(`Could not find ${PLAYER_MEDIA} in the library`);
    }

    await link.click();
}

async function waitForJavaScriptToSettle(page) {
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() => document.readyState === 'complete');
    await page.evaluate(async () => {
        await document.fonts?.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise((resolve) => {
            if ('requestIdleCallback' in window) {
                requestIdleCallback(resolve, { timeout: 1000 });
            } else {
                setTimeout(resolve, 0);
            }
        });
    });
}

function stopServer(server) {
    if (!server?.pid) {
        return;
    }

    try {
        process.kill(-server.pid, 'SIGTERM');
    } catch (error) {
        if (error.code !== 'ESRCH') {
            throw error;
        }
    }
}

let server;
let browser;

try {
    await run('npm', ['run', 'build:client']);
    await run('npm', ['run', 'build:server']);

    await assertPortFree(SERVER_URL);

    server = spawn('node', ['--enable-source-maps', 'dist/server/index.js'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            CONFIG_PATH: `${process.cwd()}/config`,
            JELLYFIN_URL: SCREENSHOT_JELLYFIN_URL,
        },
    });

    await waitForServer(SERVER_URL);

    browser = await chromium.launch();

    const context = await browser.newContext({
        ...devices['Pixel 9'],
        viewport: LANDSCAPE_VIEWPORT,
        screen: LANDSCAPE_VIEWPORT,
        isMobile: true,
    });

    const page = await context.newPage();

    await page.goto(SERVER_URL, {
        waitUntil: 'networkidle',
    });

    await page.locator('#jellyfin-user').fill(SCREENSHOT_JELLYFIN_USER);
    await page.locator('#jellyfin-password').fill(SCREENSHOT_JELLYFIN_PASSWORD);
    await page.locator('#jellyfin-sign-in-submit').click();
    await page.locator('#jellyfin-sign-in').waitFor({ state: 'detached' });
    await page.waitForLoadState('networkidle');

    await applyMediaFilter(page, 'audio');
    await applyMediaFilter(page, 'video');

    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library.jpg');

    await page.setViewportSize({
        width: LANDSCAPE_VIEWPORT.height,
        height: LANDSCAPE_VIEWPORT.width,
    });
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-landscape.jpg');

    await page.setViewportSize(LANDSCAPE_VIEWPORT);
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-portrait.jpg');

    await page.locator('#btn-view-list').click();
    await page.locator('#track-list:not(.d-none)').waitFor();
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/library-tabular.jpg');

    await page.locator('#btn-view-grid').click();
    await waitForJavaScriptToSettle(page);

    await clickPlayerMedia(page);
    await page.locator('#player-view:not(.d-none)').waitFor();
    // await page.locator('#viz-toggle').click();
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/player.jpg');
} finally {
    if (browser) {
        await browser.close();
    }

    stopServer(server);
}
