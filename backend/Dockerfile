# Bookworm = Debian 12 -> LTS support until 2028
FROM lukemathwalker/cargo-chef:0.1.71-rust-1.84.0-bookworm AS chef
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
# Build dependencies - this is the caching Docker layer!
RUN cargo chef cook --release --recipe-path recipe.json
# Build application
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim

WORKDIR /app

# Install runtime dependencies
# RUN apt-get update && \
#     apt-get install -y --no-install-recommends \
#     ca-certificates \
#     libssl3 \
#     && rm -rf /var/lib/apt/lists/*

# Copy the binary from builder
COPY --from=builder /app/target/release/backend /app/backend

EXPOSE 3000

CMD ["./backend"] 