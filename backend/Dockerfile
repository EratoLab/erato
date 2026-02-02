# cargo-chef version = 0.1.73
# Rust version = 1.91.1 - Should be kept up-to-date with rust-toolchain.toml
# Trixie = Debian 13 -> LTS support until 2030
# Pinned for security & build performance reasons
FROM lukemathwalker/cargo-chef:0.1.73-rust-1.91.1-trixie@sha256:0952ecbcded4600a826cb52277fb662df5c56abecc3acd5475988f88f015e7aa AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies - this is the caching Docker layer!
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libtesseract-dev \
    libleptonica-dev \
    libclang-dev \
    && rm -rf /var/lib/apt/lists/*
RUN cargo chef cook --release --recipe-path recipe.json
# Build application (only erato binary)
COPY . .
RUN cargo build --release -p erato --bin erato

# Pinned for security & build performance reasons
FROM debian:trixie-slim@sha256:5cf544fad978371b3df255b61e209b373583cb88b733475c86e49faa15ac2104

WORKDIR /app

# Install dependencies
# ca-certificates -> Certificates for HTTPS
# sqitch + libdbd-pg-perl + postgresql-client -> sqitch
# tesseract-ocr-dev + leptonica-dev + clang-dev -> tesseract (parser_core dependency)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    ca-certificates \
    sqitch \
    libdbd-pg-perl \
    postgresql-client \
    libtesseract5 \
    && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/erato /app/erato
# Copy sqitch (migration) files from host
COPY sqitch /app/sqitch

EXPOSE 3130

ENV HTTP_HOST="0.0.0.0"

CMD ["./erato"]
