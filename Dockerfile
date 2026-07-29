# Railpack does not detect Bun projects, so Railway builds from this Dockerfile.
# Two stages: the toolchain and sources stay out of the deployed image.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# The site, and the server bundled into one file. Bundling matters: serve.ts imports
# scripts/instagram.ts, and copying the entry point alone left that behind — the
# container then crash-looped on "Cannot find module './scripts/instagram.ts'".
RUN bun run build
RUN bun build ./serve.ts --target=bun --outfile=server.js

FROM oven/bun:1 AS runtime
WORKDIR /app

# Only the built site and the self-contained server — no sources, no node_modules.
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "server.js"]
