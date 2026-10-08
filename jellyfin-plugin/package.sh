#!/bin/sh
# Build the plugin into artifacts/HAPPY_<version>/, ready to copy into Jellyfin's plugins/ directory.
# Runs anywhere the .NET 10 SDK is available (e.g. mcr.microsoft.com/dotnet/sdk:10.0).
set -eu
cd "$(dirname "$0")"

field() { sed -n "s/^$1: \"\(.*\)\"$/\1/p" build.yaml; }
version=$(field version)
out="artifacts/HAPPY_${version}"

rm -rf "$out"
dotnet publish Jellyfin.Plugin.Happy/Jellyfin.Plugin.Happy.csproj -c Release -o "artifacts/publish" --nologo -v quiet
mkdir -p "$out"
cp artifacts/publish/Jellyfin.Plugin.Happy.dll "$out/"

cat > "$out/meta.json" <<JSON
{
  "category": "General",
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
  "autoUpdate": false,
  "assemblies": ["Jellyfin.Plugin.Happy.dll"]
}
JSON

echo "Built $out"
