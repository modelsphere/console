#!/usr/bin/env bash
# Re-copy the swiss pages from swiss/web/src into web/src/modules/swiss.
#
# The module is a mirror: swissd's wire types (lib/api.ts) and the pages that
# read them move together, so upstream is the only place they are edited. Three
# rewrites make the copy run under the console shell; everything console-specific
# lives in lib/host.ts and the files this script never touches.
#
#   usage: hack/sync-swiss-ui.sh <path-to-swiss-checkout> [ref]
set -euo pipefail

SWISS=${1:?usage: sync-swiss-ui.sh <path-to-swiss-checkout> [ref]}
REF=${2:-HEAD}
DEST=$(cd "$(dirname "$0")/.." && pwd)/web/src/modules/swiss
UPSTREAM=$(git -C "$SWISS" rev-parse "$REF")

# Standalone-only (swiss's own app shell) and console-only files are both
# outside the mirror. The console-only set is the module's bindings and the
# components/ui/rise adapters -- which swiss has no file for, so they are never
# a sync target and need no exclusion here.
SKIP='^(main\.tsx|index\.css|vite-env\.d\.ts|components/Layout\.tsx|routes/Login\.tsx|routes/Preview.*\.tsx)$'
KEEP='^(index\.tsx|lib/host\.ts|components/Session\.tsx)$'

git -C "$SWISS" ls-tree -r --name-only "$UPSTREAM" web/src \
  | sed 's|^web/src/||' \
  | grep -Ev "$SKIP" \
  | grep -Ev "$KEEP" \
  | while read -r f; do
      # swiss's ui components are one of the two kits the build picks between, so
      # they land in components/ui/shadcn rather than on top of the Rise ones.
      d=$f
      case "$f" in components/ui/*) d="components/ui/shadcn/${f#components/ui/}";; esac
      mkdir -p "$DEST/$(dirname "$d")"
      git -C "$SWISS" show "$UPSTREAM:web/src/$f" > "$DEST/$d"
    done

# 1. the module's alias    2. router + fetch go through the host  3. api.ts's calls
find "$DEST" -name '*.ts' -o -name '*.tsx' | while read -r f; do
  case "$f" in
    *"/lib/host.ts"|*"/index.tsx"|*"/components/Session.tsx") continue;;
    *"/components/ui/rise/"*) continue;;
  esac
  perl -pi -e 's{from "\@/}{from "\@swiss/}g; s{from "react-router"}{from "\@swiss/lib/host"}g' "$f"
done
perl -pi -e 's{(?<![.\w])fetch\((path)\b}{hostFetch(apiPath($1)}g' "$DEST/lib/api.ts"
grep -q 'from "@swiss/lib/host"' "$DEST/lib/api.ts" \
  || perl -0pi -e 's{\A}{import { apiPath, hostFetch } from "\@swiss/lib/host";\n\n}' "$DEST/lib/api.ts"

echo "$UPSTREAM" > "$DEST/UPSTREAM"
echo "synced from $SWISS @ $UPSTREAM"
