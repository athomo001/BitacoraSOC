# Multi-stage build para optimizar tamaño
# Marca de autor en comentarios: Athan Espinoza
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base

WORKDIR /app
USER root

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# Copiar archivos de dependencias
COPY package*.json ./

# Crear usuario no-root antes de instalar dependencias (idempotente para fallback local)
RUN if ! grep -q '^nodejs:' /etc/group; then addgroup -g 1001 -S nodejs; fi && \
    if ! grep -q '^nodejs:' /etc/passwd; then adduser -S nodejs -u 1001; fi

# Instalar dependencias de producción usando cache mount para velocidad local
RUN --mount=type=cache,id=npm-cache-backend,target=/root/.npm \
    npm install --omit=dev

# Copiar código fuente
COPY src ./src

# Crear directorios necesarios y asignar permisos solo sobre lo necesario
RUN mkdir -p /app/uploads/logos /app/logs && \
    chown -R nodejs:nodejs /app/src /app/uploads /app/logs

USER nodejs

# Exponer puerto
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Comando de inicio
CMD ["node", "src/server.js"]
