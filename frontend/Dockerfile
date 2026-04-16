FROM node:22.22.2-trixie@sha256:e61770466a526ffb31c33ae045beecd3921896ae83a898e48a68b2fca68accae AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Install a newer version of corepack to avoid keyId issue (see https://github.com/nodejs/corepack/issues/612)
RUN npm install --global corepack@latest
RUN corepack enable
COPY . /app

FROM base AS build
WORKDIR /app/frontend
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build:lib
RUN pnpm run build

WORKDIR /app/office-addin
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile --lockfile=false
RUN pnpm run build

# Final stage - empty image with just the static files for all served frontends
FROM scratch
COPY --from=build /app/frontend/out /public
COPY --from=build /app/frontend/serve.edited.json /public/serve.json
COPY --from=build /app/office-addin/dist /public/platform-office-addin
