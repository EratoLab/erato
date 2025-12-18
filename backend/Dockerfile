# cargo-chef version = 0.1.73
# Rust version = 1.91.1 - Should be kept up-to-date with rust-toolchain.toml
# Bookworm = Debian 12 -> LTS support until 2028
# Pinned for security & build performance reasons
FROM lukemathwalker/cargo-chef:0.1.73-rust-1.91.1-bookworm@sha256:ac22e8377f914b774d0d3a27cb60ab93b9115d39ef3f72e01f2dfbb55433b3eb AS chef
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
# Build application
COPY . .
RUN cargo build --release

# Pinned for security & build performance reasons
FROM debian:bookworm-slim@sha256:e899040a73d36e2b36fa33216943539d9957cba8172b858097c2cabcdb20a3e2

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