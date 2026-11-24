#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT

go run sigs.k8s.io/controller-tools/cmd/controller-gen@v0.19.0 \
  crd paths=./internal/iam "output:crd:dir=$output"
cp "$output/iam.theriseunion.io_reverseproxies.yaml" helm/console/crds/
