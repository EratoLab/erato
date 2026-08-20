FROM node:22.22.2-trixie@sha256:e61770466a526ffb31c33ae045beecd3921896ae83a898e48a68b2fca68accae AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Install a newer version of corepack to avoid keyId issue (see https://github.com/nodejs/corepack/issues/612)
RUN npm install --global corepack@latest
RUN corepack enable

FROM base AS build

# Install dependencies from package metadata before copying source files so
# application changes do not invalidate these layers.
COPY desktop-sidecar-protocol/package.json desktop-sidecar-protocol/pnpm-lock.yaml desktop-sidecar-protocol/pnpm-workspace.yaml desktop-sidecar-protocol/.npmrc /app/desktop-sidecar-protocol/
WORKDIR /app/desktop-sidecar-protocol
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --config.confirmModulesPurge=false

COPY desktop-sidecar-protocol /app/desktop-sidecar-protocol
RUN pnpm run build

# The normalize script is copied before the install on purpose: the SBOM and
# license steps below must share exact cache lineage with the install, because
# the registry cache restores layers but never `--mount=type=cache` contents.
# If anything between the install and those steps could invalidate on its own,
# they would re-execute in a build whose install was a cache hit — reading a
# pnpm store that is empty in that build.
COPY scripts/normalize-pnpm-license-json.mjs /app/scripts/normalize-pnpm-license-json.mjs
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml /app/frontend/
COPY frontend-utils /app/frontend-utils
WORKDIR /app/frontend
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --config.confirmModulesPurge=false

# Dependency metadata only — kept ahead of the source copy so application
# changes can neither invalidate them nor strand them without a store.
RUN mkdir -p /app/sbom && pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.7 > /app/sbom/frontend.cdx.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm licenses list --prod --json | node ../scripts/normalize-pnpm-license-json.mjs | ./node_modules/.bin/pnpm-licenses generate-disclaimer --json-input --output-file=/app/sbom/frontend.txt

COPY frontend /app/frontend
RUN pnpm rebuild @swc/core esbuild msw protobufjs unrs-resolver
RUN NODE_OPTIONS=--max-old-space-size=8192 pnpm run build:lib
RUN NODE_OPTIONS=--max-old-space-size=8192 pnpm run build

COPY office-addin/package.json office-addin/pnpm-lock.yaml office-addin/pnpm-workspace.yaml /app/office-addin/
WORKDIR /app/office-addin
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm update @erato/frontend --config.confirmModulesPurge=false
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --config.confirmModulesPurge=false

# Ahead of the source copy for the same store-lineage reason as the frontend's.
RUN mkdir -p /app/sbom && pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.7 > /app/sbom/office-addin.cdx.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm licenses list --prod --json | node ../scripts/normalize-pnpm-license-json.mjs | ./node_modules/.bin/pnpm-licenses generate-disclaimer --json-input --output-file=/app/sbom/office-addin.txt

RUN cp pnpm-lock.yaml /tmp/office-addin-pnpm-lock.yaml
COPY office-addin /app/office-addin
RUN cp /tmp/office-addin-pnpm-lock.yaml pnpm-lock.yaml
RUN NODE_OPTIONS=--max-old-space-size=8192 pnpm run build

# Final stage - empty image with just the static files for all served frontends
FROM scratch
COPY --from=build /app/frontend/out /public
COPY --from=build /app/frontend/serve.edited.json /public/serve.json
COPY --from=build /app/office-addin/dist /public/platform-office-addin
COPY --from=build /app/sbom /sbom
