#!/bin/sh
# Updates the Jellyfin plugin repository branch (manifest.json, manifest-beta.json) in CI:
# checks the branch out into ./repository, runs the given command, commits and pushes.
# The release and beta workflows both push to the branch, so a rejected push starts over from
# the new remote state instead of merging JSON; the command must therefore be repeatable.
# A ruleset lets only deploy keys and admins write the branch (GitHub Actions can't bypass rulesets
# on a personal repo), so CI pushes with the write deploy key in PLUGIN_REPOSITORY_DEPLOY_KEY.
#
#   sh scripts/update-plugin-repository.sh "<commit message>" <command> [args...]
set -eu
branch="${REPOSITORY_BRANCH:-jellyfin-plugin-repository}"
message="$1"
shift

push_remote=origin
if [ -n "${PLUGIN_REPOSITORY_DEPLOY_KEY:-}" ]; then
  ssh_dir="$(mktemp -d)"
  trap 'rm -rf "$ssh_dir"' EXIT
  printf '%s\n' "$PLUGIN_REPOSITORY_DEPLOY_KEY" > "$ssh_dir/key"
  chmod 600 "$ssh_dir/key"
  # GitHub's published host key (https://api.github.com/meta).
  echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$ssh_dir/known_hosts"
  export GIT_SSH_COMMAND="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"
  push_remote="git@github.com:${GITHUB_REPOSITORY}.git"
fi

for attempt in 1 2 3 4 5; do
  rm -rf repository
  git worktree prune
  if git fetch --depth=1 origin "$branch"; then
    git worktree add --force -B "$branch" repository FETCH_HEAD
  else
    git worktree add --orphan -b "$branch" repository
  fi

  "$@"

  git -C repository add -A
  if git -C repository diff --cached --quiet; then
    echo "Nothing to commit"
    exit 0
  fi
  git -C repository -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$message"
  if git -C repository push "$push_remote" "HEAD:refs/heads/$branch"; then
    exit 0
  fi
  echo "Push rejected (attempt $attempt), retrying from the new $branch" >&2
  sleep $((attempt * 5))
done
echo "Could not push to $branch" >&2
exit 1
