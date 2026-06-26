# cargo-chef version = 0.1.77
# Rust version = 1.96.0 - Should be kept up-to-date with rust-toolchain.toml
# Trixie = Debian 13 -> LTS support until 2030
# Pinned for security & build performance reasons
FROM lukemathwalker/cargo-chef:0.1.77-rust-1.96.0-trixie@sha256:e606721f52d95169364bf39cae726a94ed8b397625011ccfaa8340db488b823b AS chef
WORKDIR /app
RUN cargo install --locked cargo-auditable --version 0.7.4

FROM chef AS planner
COPY . .
RUN cargo chef prepare --bin erato --recipe-path recipe.json

FROM chef AS builder
ARG ERATO_FEATURES=""
COPY --from=planner /app/recipe.json recipe.json
RUN cargo auditable chef cook --bin erato --release --recipe-path recipe.json

# Build application (only erato binary)
COPY . .
RUN if [ -n "$ERATO_FEATURES" ]; then \
      cargo auditable build --release -p erato --bin erato --features "$ERATO_FEATURES"; \
    else \
      cargo auditable build --release -p erato --bin erato; \
    fi

# Pinned for security & build performance reasons
FROM debian:trixie-slim@sha256:5cf544fad978371b3df255b61e209b373583cb88b733475c86e49faa15ac2104

WORKDIR /app

# Install dependencies
# ca-certificates -> Certificates for HTTPS
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/erato /app/erato

EXPOSE 3130

ENV HTTP_HOST="0.0.0.0"

CMD ["./erato"]
