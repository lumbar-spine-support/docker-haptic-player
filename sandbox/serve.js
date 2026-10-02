#!/usr/bin/env node
// Dev server for the e-stim sandbox: bundles src/main.ts in memory and serves this folder with live reload.
const esbuild = require('esbuild');
const path = require('path');
const { pathToFileURL } = require('url');

const root = __dirname;
const outdir = path.join(root, 'dist');
const port = Number(process.env.PORT) || 8100;

async function main() {
    const ctx = await esbuild.context({
        entryPoints: [path.join(root, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        target: 'es2020',
        sourcemap: true,
        // Library sources live outside servedir; file URLs let the debugger map them to disk.
        sourceRoot: `${pathToFileURL(outdir).href}/`,
        outdir,
        write: false,
        logLevel: 'info',
    });
    await ctx.watch();
    const server = await ctx.serve({ servedir: root, host: '127.0.0.1', port });
    console.log(`Sandbox at http://localhost:${server.port}/`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
