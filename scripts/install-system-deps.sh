#!/bin/sh
# Installs the system packages the server needs at runtime (Dockerfile, devcontainer, CI).
set -eu

PACKAGES="ffmpeg"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

if command -v apk >/dev/null 2>&1; then
  $SUDO apk add --no-cache $PACKAGES
elif command -v apt-get >/dev/null 2>&1; then
  $SUDO apt-get update
  $SUDO apt-get install -y --no-install-recommends $PACKAGES
  if [ -z "$SUDO" ]; then
    rm -rf /var/lib/apt/lists/*
  fi
else
  echo "Unsupported package manager; install manually: $PACKAGES" >&2
  exit 1
fi
