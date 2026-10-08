#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

mkdir -p config
npm install -g npm@12.0.2
npm install
sudo npx --yes playwright install-deps chromium
npx --yes playwright install chromium
