# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# base — shared by every stage so they resolve to the same layer.
#
# -slim (Debian/glibc) rather than -alpine (musl): argon2 is a native module
# and publishes glibc prebuilds, so Alpine would have to compile it from
# source with python3 and build-essential. Prisma 7 no longer matters here —
# its driver adapter means there is no query-engine binary at all.
# ---------------------------------------------------------------------------
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# tini becomes PID 1. Without it Node is PID 1, and PID 1 does not get the
# default signal handlers — SIGTERM would be ignored, graceful shutdown
# would never run, and every deploy would sever in-flight requests.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*


# ---------------------------------------------------------------------------
# deps — all dependencies, including dev, for building.
#
# Only the manifest and lockfile are copied first: this layer is then reused
# on every build where dependencies have not changed. Copying source first
# would reinstall everything on each edit.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev


# ---------------------------------------------------------------------------
# prod-deps — runtime dependencies only, installed from the same lockfile.
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force


# ---------------------------------------------------------------------------
# build — generate the Prisma client, then compile.
#
# Order matters: `prisma generate` writes TypeScript into src/generated, and
# tsc then compiles it along with everything else into dist/.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY prisma ./prisma
COPY prisma7.config.ts tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npx tsc


# ---------------------------------------------------------------------------
# migrator — the Prisma CLI, for the one-shot migration job.
#
# Kept separate so the runtime image carries no build tooling: a schema
# migration is a deploy step, not something the application should be able
# to perform on itself.
# ---------------------------------------------------------------------------
FROM deps AS migrator
COPY prisma ./prisma
COPY prisma7.config.ts ./
CMD ["npx", "prisma", "migrate", "deploy"]


# ---------------------------------------------------------------------------
# runtime — compiled output and production dependencies, nothing else.
# ---------------------------------------------------------------------------
FROM base AS runtime

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist         ./dist
COPY --chown=node:node package.json ./

# Never root: a container escape as root is a far worse incident than one
# as an unprivileged user. The node user ships with the official image.
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]

# Overridden by the worker service; both run from the same image.
CMD ["node", "dist/api.js"]
