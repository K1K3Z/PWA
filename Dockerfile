FROM node:24.21.0-bookworm-slim AS frontend
WORKDIR /build
ENV NG_CLI_ANALYTICS=false
COPY pwa-angular/package.json pwa-angular/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY pwa-angular/ ./
RUN npm run build -- --configuration production

FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app/push-server
COPY push-server/package.json push-server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node push-server/*.mjs ./
COPY --from=frontend --chown=node:node /build/dist/pwa/browser /app/pwa-angular/dist/pwa/browser
RUN mkdir -p /app/push-server/data && chown node:node /app/push-server/data
USER node
EXPOSE 10000
CMD ["node", "cloud.mjs"]
