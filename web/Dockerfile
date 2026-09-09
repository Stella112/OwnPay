# OwnPay web — multi-stage build producing a lean Next.js standalone runner.
# Build context is the web/ directory.

# 1. Install dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. Build (NEXT_PUBLIC_* are inlined at build time, so they arrive as build args)
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Public config only — no secrets. The deployer key never touches the web build.
ARG NEXT_PUBLIC_STOCK_VESTING_ADDRESS=""
ARG NEXT_PUBLIC_AAPLC_ADDRESS=""
ARG NEXT_PUBLIC_NVDAC_ADDRESS=""
ARG NEXT_PUBLIC_BASE_RPC_URL=""
ARG NEXT_PUBLIC_BASENAME_UNIVERSAL_RESOLVER=""
ENV NEXT_PUBLIC_STOCK_VESTING_ADDRESS=$NEXT_PUBLIC_STOCK_VESTING_ADDRESS \
    NEXT_PUBLIC_AAPLC_ADDRESS=$NEXT_PUBLIC_AAPLC_ADDRESS \
    NEXT_PUBLIC_NVDAC_ADDRESS=$NEXT_PUBLIC_NVDAC_ADDRESS \
    NEXT_PUBLIC_BASE_RPC_URL=$NEXT_PUBLIC_BASE_RPC_URL \
    NEXT_PUBLIC_BASENAME_UNIVERSAL_RESOLVER=$NEXT_PUBLIC_BASENAME_UNIVERSAL_RESOLVER \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 3. Minimal runtime image
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# Standalone output + static assets + public dir
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
