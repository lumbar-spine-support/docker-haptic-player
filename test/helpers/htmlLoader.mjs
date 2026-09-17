// Node module customization hook that makes `import x from './file.html'` return
// the file's raw text as the default export, mirroring esbuild's `--loader:.html=text`
// used by the real client build. This lets tests import modules that transitively
// import `.html` template files without needing a bundler or a new dependency.
import fs from 'node:fs';

export async function load(url, context, nextLoad) {
    if (url.endsWith('.html')) {
        const path = new URL(url);
        const source = fs.readFileSync(path, 'utf8');
        return {
            format: 'module',
            shortCircuit: true,
            source: `export default ${JSON.stringify(source)};`,
        };
    }
    return nextLoad(url, context);
}
