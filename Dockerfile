FROM oven/bun:1 AS base
WORKDIR /app

# Install system dependencies needed by Homebrew and build tooling.
# gosu is used by entrypoint.sh to drop from root to appuser cleanly.
# appuser is the non-root user the server runs as — the primary security
# boundary. System paths (/usr, /bin, /etc) and /app are root-owned and
# unwritable by the process. See entrypoint.sh for how privileges are dropped.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl git procps file gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r appuser && useradd -r -g appuser appuser

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base
COPY --from=install /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
