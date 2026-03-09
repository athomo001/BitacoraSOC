# Multi-stage build para optimizar tamaño
FROM node:24-alpine AS base

WORKDIR /app

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de producción
RUN npm install --omit=dev && npm cache clean --force

# Copiar código fuente
COPY src ./src

# Crear directorios necesarios y usuario no-root por seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    mkdir -p /app/uploads/logos /app/logs && \
    chown -R nodejs:nodejs /app

USER nodejs

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "src/server.js"]
