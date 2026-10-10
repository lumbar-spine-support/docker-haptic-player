#!/bin/sh
# Deletes the zips of beta builds pruned from manifest-beta.json (one download URL per line, as
# written by jellyfin-plugin-manifest.ts --pruned-file). Only assets of the rolling `beta`
# pre-release are deleted; anything else in the list is left alone. Needs GH_TOKEN.
#
#   sh scripts/delete-pruned-betas.sh <pruned.txt>
set -eu
list="$1"
[ -s "$list" ] || exit 0

while IFS= read -r url; do
  case "$url" in
    */releases/download/beta/*)
      name="${url##*/}"
      echo "Deleting $name from the beta release"
      gh release delete-asset beta "$name" --yes || echo "Could not delete $name" >&2
      ;;
    *) echo "Keeping $url (not a beta release asset)" ;;
  esac
done < "$list"
