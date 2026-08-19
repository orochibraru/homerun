# Stage 1: Install dependencies
FROM oven/bun:1 AS deps

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Stage 2: Build the application
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Stage 3: Production runtime
FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache wget ca-certificates

WORKDIR /app

ENV NODE_ENV=production

# Copy built application
COPY --from=builder --chown=bun:bun /app/build ./build
COPY --from=builder --chown=bun:bun /app/package.json ./
COPY --from=builder --chown=bun:bun /app/drizzle/ /app/drizzle
COPY --from=builder --chown=bun:bun /app/drizzle.config.ts /app/drizzle.config.ts

# Expose the port
EXPOSE 3000

# Set the host to listen on all interfaces
ENV HOST=0.0.0.0
ENV PORT=3000
ENV BODY_SIZE_LIMIT=Infinity
ENV APP_ENV=production
ENV ORIGIN=http://localhost:3000
ENV STORAGE_BASE_PATH=/app/data

RUN mkdir -p /app/data
RUN chown -R bun:bun /app/data

VOLUME /app/data

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 CMD wget --no-verbose --tries=1 --spider http://0.0.0.0:3000/api/health || exit 1

USER bun

# Start the application
CMD ["bun", "run", "/app/build/index.js"]
