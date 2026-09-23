#!/usr/bin/env node
// Copies third-party vendor assets from node_modules into public/vendor so the
// browser can load them without any CDN access.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function mkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing vendor asset: ${path.relative(root, filePath)}`);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

let copiedCount = 0;
let copiedBytes = 0;

function copy(src, dest) {
  ensureExists(src);
  mkdir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  copiedCount += 1;
  copiedBytes += fs.statSync(dest).size;
}

function copyDir(srcDir, destDir) {
  ensureExists(srcDir);
  mkdir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copy(srcPath, destPath);
    }
  }
}

const nm = path.join(root, 'node_modules');
const vendor = path.join(root, 'public', 'vendor');

try {
  // Bootstrap CSS + JS (bundle includes Popper)
  // Future enhancement: validate upstream minification/compression artifacts before copy.
  copy(
    path.join(nm, 'bootstrap', 'dist', 'css', 'bootstrap.min.css'),
    path.join(vendor, 'bootstrap', 'bootstrap.min.css'),
  );
  copy(
    path.join(nm, 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js'),
    path.join(vendor, 'bootstrap', 'bootstrap.bundle.min.js'),
  );

  // Both minified files carry a sourceMappingURL, so devtools 404s without these.
  copy(
    path.join(nm, 'bootstrap', 'dist', 'css', 'bootstrap.min.css.map'),
    path.join(vendor, 'bootstrap', 'bootstrap.min.css.map'),
  );
  copy(
    path.join(nm, 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js.map'),
    path.join(vendor, 'bootstrap', 'bootstrap.bundle.min.js.map'),
  );

  // Bootstrap Icons CSS + webfonts
  copy(
    path.join(nm, 'bootstrap-icons', 'font', 'bootstrap-icons.min.css'),
    path.join(vendor, 'bootstrap-icons', 'bootstrap-icons.min.css'),
  );
  copyDir(
    path.join(nm, 'bootstrap-icons', 'font', 'fonts'),
    path.join(vendor, 'bootstrap-icons', 'fonts'),
  );

  // Video.js 10 is an ESM package. Copy its module and stylesheet tree for
  // browser experiments; it no longer provides the legacy global video.min.js.
  copyDir(
    path.join(nm, '@videojs', 'html', 'dist', 'default'),
    path.join(vendor, '@videojs', 'html'),
  );

  console.log(
    `Vendor assets copied to public/vendor/ (${copiedCount} files, ${formatSize(copiedBytes)})`,
  );
} catch (error) {
  console.error(`Failed to copy vendor assets: ${error.message}`);
  process.exitCode = 1;
}
