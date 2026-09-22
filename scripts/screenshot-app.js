import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, devices } from 'playwright';

const SERVER_URL = 'http://localhost:3000';
const LANDSCAPE_VIEWPORT = { width: 412, height: 915 };
const SCREENSHOT_FULL_PAGE = false;

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

async function clickLastLibraryResult(page) {
    const playableGridResults = page.locator('#track-grid a.track-art-link[href*="view=player"]');
    const playableListResults = page.locator('#track-list tr').filter({ hasNot: page.locator('th') });
    const gridCount = await playableGridResults.count();

    if (gridCount > 0) {
        await playableGridResults.nth(gridCount - 1).click();
        return;
    }

    const listCount = await playableListResults.count();

    if (listCount > 0) {
        await playableListResults.nth(listCount - 1).click();
        return;
    }

    throw new Error('Could not find a playable library result');
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

    server = spawn('node', ['--enable-source-maps', 'dist/server/index.js'], {
        cwd: process.cwd(),
        detached: true,
        stdio: 'inherit',
        env: {
            ...process.env,
            CONFIG_PATH: `${process.cwd()}/config/settings.yaml`,
            MEDIA_DIR: `${process.cwd()}/test/fixtures/media/`,
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

    await clickLastLibraryResult(page);
    await page.locator('#player-view:not(.d-none)').waitFor();
    await page.locator('#viz-toggle').click();
    await waitForJavaScriptToSettle(page);

    await capture(page, 'docs/screenshots/player.jpg');
} finally {
    if (browser) {
        await browser.close();
    }

    stopServer(server);
}
