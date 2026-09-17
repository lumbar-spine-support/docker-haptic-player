#!/usr/bin/env node
const esbuild = require('esbuild');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
const minify = process.argv.includes('--minify');
const watch = process.argv.includes('--watch');
const sourcemap = process.argv.includes('--sourcemap');

async function build(entryPoint, outfile) {
    const config = {
        entryPoints: [entryPoint],
        bundle: true,
        platform: 'browser',
        target: 'es2020',
        ...(minify && { minify: true }),
        ...(sourcemap && { sourcemap: true }),
        loader: {
            '.html': 'text',
            '.svg': 'text',
        },
        define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
        },
        alias: {
            '@': path.resolve(process.cwd(), '@'),
        },
        outfile,
        ...(watch && { logLevel: 'info' }),
    };

    if (watch) {
        const ctx = await esbuild.context(config);
        await ctx.watch();
        console.log(`Watching ${entryPoint}...`);
    } else {
        await esbuild.build(config);
    }
}

async function buildAll() {
    try {
        await Promise.all([
            build('src/client/index.ts', 'public/js/app.js'),
        ]);
        if (!watch) {
            console.log('Build complete');
            process.exit(0);
        }
    } catch (error) {
        console.error('Build failed:', error);
        process.exit(1);
    }
}

buildAll();
