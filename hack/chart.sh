#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
output="$root/dist"
version=""
image=""

usage() {
  cat <<'EOF'
Usage: hack/chart.sh [--version VERSION] [--image REPOSITORY] [--output DIR]

Packages helm/console as console-<VERSION>.tgz, with appVersion set to VERSION so
the chart pulls the console image of the same tag. CI (.github/workflows/publish.yml)
packages with this script and pushes the result to oci://ghcr.io/modelsphere/charts.

  --version     default <Chart.yaml appVersion>-git<short commit>, CI's version for main
  --image       image repository to point the chart at; default: values.yaml's
  --output      default ./dist
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) version=${2:?--version needs a value}; shift 2 ;;
    --image) image=${2:?--image needs a repository}; shift 2 ;;
    --output) output=${2:?--output needs a directory}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v helm >/dev/null || { echo "helm is required" >&2; exit 1; }

# The version names a commit, so the tree must be that commit.
if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "refusing to package a dirty worktree" >&2
  exit 1
fi
if [ -z "$version" ]; then
  app=$(sed -n 's/^appVersion: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/p' "$root/helm/console/Chart.yaml")
  [ -n "$app" ] || { echo "helm/console/Chart.yaml has no appVersion" >&2; exit 1; }
  version="$app-git$(git -C "$root" rev-parse --short=7 HEAD)"
fi

# Repoint a copy, never the checkout.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$root/helm/console" "$work/console"
if [ -n "$image" ]; then
  sed "s|^  repository: .*/console\$|  repository: $image|" "$root/helm/console/values.yaml" >"$work/console/values.yaml"
  grep -q "^  repository: $image\$" "$work/console/values.yaml" \
    || { echo "image.repository in helm/console/values.yaml was not repointed at $image" >&2; exit 1; }
fi

helm dependency build "$root/helm/console"

mkdir -p "$output"
output=$(cd "$output" && pwd)
helm package "$work/console" --version "$version" --app-version "$version" --destination "$output" >/dev/null
package="$output/console-$version.tgz"
test "$(helm show chart "$package" | sed -n 's/^appVersion: *//p')" = "$version"
echo "chart: $package"
