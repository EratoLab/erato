# cargo-chef version = 0.1.78
# Rust version = 1.99.1 - Should be kept up-to-date with rust-toolchain.toml
# Trixie = Debian 13 -> LTS support until 2030
# Pinned for security & build performance reasons
FROM lukemathwalker/cargo-chef:0.1.78-rust-1.99.1-trixie@sha256:420b7375dc4059a85f1c365f23f96b8f561c2861e365645b413c531b206c528a AS chef
WORKDIR /app
RUN cargo install --locked cargo-auditable --version 0.7.4

FROM chef AS planner
COPY . .
RUN cargo chef prepare --bin erato --recipe-path recipe.json

FROM chef AS builder
ARG ERATO_FEATURES=""
COPY --from=planner /app/recipe.json recipe.json
RUN cargo auditable chef cook --bin erato --release --recipe-path recipe.json
RUN cargo install --locked cargo-about --version 0.9.1 --features cli

# Build application (only erato binary)
COPY . .
# Compress embedded debug information without stripping backtrace details.
# Pass the linker option only to the final binary so dependencies stay cached.
RUN if [ -n "$ERATO_FEATURES" ]; then \
      cargo auditable rustc --release -p erato --bin erato --features "$ERATO_FEATURES" -- -C link-arg=-Wl,--compress-debug-sections=zlib; \
    else \
      cargo auditable rustc --release -p erato --bin erato -- -C link-arg=-Wl,--compress-debug-sections=zlib; \
    fi
RUN mkdir -p /app/sbom && cargo about generate --manifest-path erato/Cargo.toml --config about.toml --locked about.hbs > /app/sbom/backend.txt

# Pinned for security & build performance reasons
FROM registry.eratolabs.com/erato/chainguard-glibc-dynamic:2026-10-30-dev@sha256:6fb1a88c68a9898d70760d1670581aa70717426c332d09f5dc81116fe7bc8e99
WORKDIR /app

# Copy the binary from builder
COPY --from=builder /app/target/release/erato /app/erato
COPY --from=builder /app/sbom /app/sbom

EXPOSE 3130

ENV HTTP_HOST="0.0.0.0"

CMD ["./erato"]
