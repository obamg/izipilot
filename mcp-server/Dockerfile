# Multi-stage build. Build context = project root, so we can share prisma/.
# Build with: docker build -f mcp-server/Dockerfile -t izipilot-mcp .

FROM node:20-alpine AS deps
WORKDIR /app
COPY mcp-server/package.json mcp-server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine AS build
WORKDIR /app
COPY mcp-server/package.json mcp-server/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY mcp-server/tsconfig.json ./tsconfig.json
COPY mcp-server/src ./src
COPY prisma ./prisma
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build:docker

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini && addgroup -S app && adduser -S app -G app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY mcp-server/package.json ./package.json
USER app
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
