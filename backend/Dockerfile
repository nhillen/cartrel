# Multi-stage Dockerfile for Cartrel Backend

# Development stage
FROM node:20-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 3002

# Development command (overridden by docker-compose)
CMD ["npm", "run", "dev"]

# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files (including lock file for reproducible builds)
COPY package.json package-lock.json ./

# Install all dependencies (including dev) using ci for reproducibility
RUN npm ci

# Copy source and config
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim AS production

WORKDIR /app

# Install OpenSSL and other dependencies for Prisma
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Copy package files (including lock file for reproducible builds)
COPY package.json package-lock.json ./

# Copy slack-reporter from build stage to the path npm expects
# Package.json has: "file:../../manabot/packages/slack-reporter"
# So we need to create /manabot/packages/slack-reporter from /app
RUN mkdir -p /manabot/packages
COPY --from=build /app/slack-reporter /manabot/packages/slack-reporter

# Install production dependencies only using ci for reproducibility
RUN npm ci --omit=dev

# Copy built files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Copy views directory (HTML files) to dist
COPY --from=build /app/src/views ./dist/views

# Add non-root user for security
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

# Change ownership of /app and /manabot for nodejs user
RUN chown -R nodejs:nodejs /app /manabot

USER nodejs

# Expose port
EXPOSE 3002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start production server
CMD ["node", "dist/index.js"]
