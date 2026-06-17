FROM node:22.22.2-trixie@sha256:e61770466a526ffb31c33ae045beecd3921896ae83a898e48a68b2fca68accae AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install --global corepack@latest
RUN corepack enable
COPY . /app

FROM base AS build
WORKDIR /app/frontend
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --config.confirmModulesPurge=false
RUN pnpm run build:lib

WORKDIR /app/component-kit-example
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --no-frozen-lockfile --lockfile=false --config.confirmModulesPurge=false
RUN pnpm run build

FROM scratch
COPY --from=build /app/component-kit-example/dist /app/component-kits/example
