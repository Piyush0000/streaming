# Builds the web frontend and serves it, plus proxies to the other services,
# all through a single nginx container — the "gateway".
FROM node:20-alpine AS web-build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY web ./web
ARG VITE_AUTH_BASE_URL=/api/auth
ARG VITE_API_BASE_URL=/api
ARG VITE_CHAT_WS_URL=/
ARG VITE_CHAT_WS_PATH=/ws/chat/socket.io
ARG VITE_MEDIA_WS_URL=/ws/media
ENV VITE_AUTH_BASE_URL=$VITE_AUTH_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_CHAT_WS_URL=$VITE_CHAT_WS_URL
ENV VITE_CHAT_WS_PATH=$VITE_CHAT_WS_PATH
ENV VITE_MEDIA_WS_URL=$VITE_MEDIA_WS_URL
RUN npm install --workspaces --include-workspace-root --ignore-scripts
RUN npm run build -w @streaming/shared-types
RUN npm run build -w web

FROM nginx:1.27-alpine
COPY services/gateway/nginx.conf /etc/nginx/nginx.conf
COPY --from=web-build /repo/web/dist /usr/share/nginx/html
EXPOSE 8080
