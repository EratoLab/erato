FROM node:22.10.0-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Install a newer version of corepack to avoid keyId issue (see https://github.com/nodejs/corepack/issues/612)
RUN npm install --global corepack@latest
RUN corepack enable
COPY . /app
WORKDIR /app

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build

# Final stage - empty image with just the static files
FROM scratch
COPY --from=build /app/out /public 
COPY --from=build /app/out/index.html /public/404.html
COPY --from=build /app/serve.edited.json /public/serve.json
