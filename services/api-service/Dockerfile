FROM node:20-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/api-service ./services/api-service
RUN npm install --workspaces --include-workspace-root --ignore-scripts
RUN npm run build -w @streaming/shared-types -w @streaming/config -w @streaming/db-migrate -w @streaming/auth-shared -w @streaming/events -w @streaming/api-service

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app

COPY --from=build /repo/package.json /repo/package-lock.json* ./
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/services/api-service/package.json ./services/api-service/package.json
COPY --from=build /repo/services/api-service/dist ./services/api-service/dist
COPY --from=build /repo/services/api-service/migrations ./services/api-service/migrations

RUN npm install --workspaces --include-workspace-root --omit=dev --ignore-scripts

# Pre-create the Elonix Hub uploads dir owned by the non-root user so the named
# volume (hub-uploads) is seeded with writable ownership on first run.
RUN mkdir -p /app/services/api-service/hub-uploads && chown -R app:app /app/services/api-service/hub-uploads

USER app
WORKDIR /app/services/api-service
EXPOSE 4002
CMD ["node", "dist/index.js"]
