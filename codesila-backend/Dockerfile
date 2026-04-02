FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (better caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy rest
COPY . .

# Prisma needs this
RUN npx prisma generate

# Build TS -> dist
RUN npm run build

# ─── Production stage (minimal attack surface) ───────────────
FROM node:20-alpine AS production

# Security: create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Security: remove unnecessary packages
RUN apk --no-cache add dumb-init && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy only production artifacts
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma

# Security: make filesystem read-only where possible
RUN chmod -R 555 /app/dist

# Security: run as non-root user
USER appuser

# Security: expose only the app port
EXPOSE 3000

# Security: use dumb-init to handle PID 1 properly
# Prevents zombie processes and handles signals correctly
ENTRYPOINT ["dumb-init", "--"]

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
