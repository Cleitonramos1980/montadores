FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Type-check + build frontend assets
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# oracledb native addon needs libaio
RUN apk add --no-cache libaio libc6-compat

COPY package*.json ./
RUN npm ci --omit=dev

# Frontend static assets from Vite build
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
# Server source (tsx executes TS directly at runtime)
COPY src/server ./src/server

EXPOSE 3333

ENV NODE_ENV=production

# tsx is in prod deps — runs TS server without separate compilation step
CMD ["npx", "tsx", "src/server/index.ts"]
