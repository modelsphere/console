# console: the BFF, with the SPA embedded in it.
#
# Three stages, because the UI is compiled into the Go binary -- the web build
# has to finish before the Go build starts, and neither toolchain belongs in the
# runtime image. Everything is built here from source: .dockerignore keeps the
# host's node_modules and web/dist out of the context.
#
# Debian-based build stages match the Debian-derived runtime and remove a class
# of musl-vs-glibc "works on my builder" differences.

# Package indexes are build args, so a build that cannot reach the public ones
# can point at a mirror: --build-arg NPM_REGISTRY=https://registry.npmmirror.com
#                        --build-arg GOPROXY=https://goproxy.cn,direct
ARG NPM_REGISTRY=https://registry.npmjs.org
ARG GOPROXY=https://proxy.golang.org,direct

# --- 1. the SPA ------------------------------------------------------------
FROM node:26-bookworm-slim AS web
ARG NPM_REGISTRY

WORKDIR /src/web
# Manifests first: this layer is cached until a dependency actually changes,
# which is most of the build time. @riseaicloud/* resolve to file:./vendor/...,
# so the vendored packages are part of the manifests.
COPY web/package.json web/package-lock.json ./
COPY web/vendor ./vendor
RUN npm ci --no-audit --no-fund --registry "$NPM_REGISTRY"

COPY web/ ./
RUN npm run build

# --- 2. the binary ---------------------------------------------------------
FROM golang:1.26 AS build
ARG GOPROXY
ENV GOPROXY=$GOPROXY
# auto: -mod=vendor when the context carries vendor/modules.txt, else -mod=mod.
ARG GO_MOD_MODE=auto

WORKDIR /src
COPY go.mod go.sum ./
# No separate `go mod download` layer: whether to download at all is only known
# once vendor/ is in, and a vendored build must not reach the network.

COPY . .
# web/dist is committed empty so `go build` works without node; the real build
# lands here and is what gets embedded.
COPY --from=web /src/web/dist ./web/dist

RUN set -eu ; \
    mod="${GO_MOD_MODE}"; \
    if [ "${mod}" = "auto" ]; then \
        if [ -f vendor/modules.txt ]; then mod=vendor; else mod=mod; fi; \
    fi; \
    echo "building with -mod=${mod}"; \
    if [ "${mod}" != "vendor" ]; then go mod download; fi; \
    CGO_ENABLED=0 GOOS=linux go build \
      -trimpath -mod="${mod}" \
      -ldflags="-s -w" \
      -o /out/console ./cmd/console

# --- 3. runtime ------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/console /console
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/console"]
CMD ["--config", "/etc/console/console.yaml"]
