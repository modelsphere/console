#!/usr/bin/env bash
# Builds console for the current commit, pushes it, and pins the tag in a values
# file so that installing and upgrading are the same helm command:
#
#   hack/image.sh
#   helm upgrade --install console ./helm/console -n console --create-namespace \
#     -f console-image.yaml --set playground.gateway.profile=<ns>/<site-profile>
#
# The tag is the chart version plus the commit, so an upgrade always changes the
# pod template and actually rolls: a fixed tag ("latest") would leave helm with
# nothing to do and every pod running the old image.
set -euo pipefail

cd "$(dirname "$0")/.."

# CI publishes main and release builds to ghcr.io/modelsphere; this is for a
# build of your own, pushed to a registry you are logged in to.
push=1
for arg in "$@"; do
  case "$arg" in
    --no-push) push=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
registry="${CONSOLE_REGISTRY:?set CONSOLE_REGISTRY, e.g. ghcr.io/<you>}"

version="$(awk '/^version:/ {print $2}' helm/console/Chart.yaml)"
commit="$(git rev-parse --short HEAD)"
tag="${version}-dev.${commit}"
image="${registry}/console:${tag}"

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: the working tree is dirty; ${tag} will not be reproducible from this commit" >&2
fi

echo "building ${image}"
# Both indexes are build args because a build host behind a firewall has to point
# at a mirror; the Dockerfile is explicit about that.
# No provenance attestation: it turns the image into an index some registries
# (Huawei SWR) reject ("fail to parse manifest.json").
docker build -t "${image}" --provenance=false \
  --build-arg "GOPROXY=${GOPROXY:-$(go env GOPROXY)}" \
  --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org}" \
  .

if [ "$push" = 1 ]; then
  echo "pushing ${image}"
  docker push "${image}"
fi

cat > console-image.yaml <<EOF
# Written by hack/image.sh — the image for this commit. Not committed.
image:
  repository: ${registry}/console
  tag: "${tag}"
  pullPolicy: IfNotPresent
EOF

echo
echo "console-image.yaml now pins ${tag}. Install or upgrade with:"
echo
echo "  helm upgrade --install console ./helm/console -n console --create-namespace \\"
echo "    -f console-image.yaml --set playground.gateway.profile=<ns>/<site-profile>"
