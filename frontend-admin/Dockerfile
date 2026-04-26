# Dockerfile for PinTool Admin Frontend
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the Next.js app
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Copy package files and install production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built app from builder stage
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/i18n ./i18n
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs
COPY --from=builder /app/tailwind.config.ts ./tailwind.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose port (Railway sets PORT env var)
EXPOSE 3000

# Use dumb-init and start Next.js on the Railway PORT
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx next start -p ${PORT:-3000}"]
