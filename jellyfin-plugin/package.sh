#!/bin/sh
# Build the plugin into artifacts/HAPPY_<version>/, ready to copy into Jellyfin's plugins/ directory,
# and zip it as artifacts/happy_<version>.zip for the plugin repository (docs/developer/jellyfin-plugin.md).
# Runs anywhere the .NET 10 SDK is available (e.g. mcr.microsoft.com/dotnet/sdk:10.0); the zip also needs `zip`.
set -eu
cd "$(dirname "$0")"

# Values are quoted; anything after the closing quote (the release-please marker) is ignored.
field() { sed -n "s/^$1: \"\([^\"]*\)\".*$/\1/p" build.yaml; }
version=$(field version)
out="artifacts/HAPPY_${version}"
zip="artifacts/happy_${version}.zip"

rm -rf "$out" "$zip"
dotnet publish Jellyfin.Plugin.Happy/Jellyfin.Plugin.Happy.csproj -c Release -o "artifacts/publish" --nologo -v quiet
mkdir -p "$out"
cp artifacts/publish/Jellyfin.Plugin.Happy.dll "$out/"

# Jellyfin keeps a bundled meta.json's autoUpdate when it installs from a repository, so it must stay true.
cat > "$out/meta.json" <<JSON
{
  "category": "$(field category)",
  "changelog": "",
  "description": "Indexes .funscript files next to library media and serves them to the HAPPY haptic player.",
  "guid": "$(field guid)",
  "name": "$(field name)",
  "overview": "$(field overview)",
  "owner": "$(field owner)",
  "targetAbi": "$(field targetAbi)",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "version": "${version}",
  "status": "Active",
  "autoUpdate": true,
  "assemblies": ["Jellyfin.Plugin.Happy.dll"]
}
JSON

echo "Built $out"

if command -v zip >/dev/null 2>&1; then
  zip -jqX "$zip" "$out"/*
  echo "Zipped $zip"
else
  echo "zip not found, skipping $zip" >&2
fi
