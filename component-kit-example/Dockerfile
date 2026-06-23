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

# Default to BusyBox so this image can also run as a Kubernetes init container
# on clusters that copy component-kit assets into an emptyDir volume.
FROM busybox:1.37.0@sha256:9532d8c39891ca2ecde4d30d7710e01fb739c87a8b9299685c63704296b16028

# For newer Kubernetes clusters that mount component kits directly with image
# volumes, a scratch final stage is sufficient and keeps the image minimal.
# FROM scratch
COPY --from=build /app/component-kit-example/dist /app/component-kits/example
