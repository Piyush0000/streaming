# mediasoup ships a native worker binary that must be compiled per-platform,
# so we use debian (not alpine/musl) and keep the same base for build+runtime.
FROM node:20-bookworm AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/media-service ./services/media-service
RUN npm install --workspaces --include-workspace-root --ignore-scripts=false
RUN npm run build -w @streaming/shared-types -w @streaming/config -w @streaming/auth-shared -w @streaming/events -w @streaming/media-service

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd -r app && useradd -r -g app app

COPY --from=build /repo/package.json /repo/package-lock.json* ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/media-service/package.json ./services/media-service/package.json
COPY --from=build /repo/services/media-service/dist ./services/media-service/dist
COPY --from=build /repo/node_modules ./node_modules

USER app
WORKDIR /app/services/media-service
EXPOSE 4004
# mediasoup RTP port range — must match MEDIASOUP_MIN_PORT/MAX_PORT env vars.
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp
CMD ["node", "dist/index.js"]
