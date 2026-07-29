# Railpack does not detect Bun projects, so Railway builds from this Dockerfile.
# Two stages: the toolchain and sources stay out of the deployed image.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime
WORKDIR /app

# Only the built site and the server it needs — no sources, no node_modules.
COPY --from=build /app/dist ./dist
COPY serve.ts ./serve.ts

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "serve.ts"]
