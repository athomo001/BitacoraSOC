# Multi-stage build para optimizar tamaño
# Marca de autor en comentarios: Athan Espinoza
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base

WORKDIR /app
USER root

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Copiar archivos de dependencias
COPY package.json pnpm-lock.yaml ./

# Crear usuario no-root antes de instalar dependencias (idempotente para fallback local)
RUN if ! grep -q '^nodejs:' /etc/group; then addgroup -g 1001 -S nodejs; fi && \
    if ! grep -q '^nodejs:' /etc/passwd; then adduser -S nodejs -u 1001; fi

# Instalar dependencias de producción usando cache mount para velocidad local
RUN --mount=type=cache,id=pnpm-store-backend,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    NPM_CONFIG_USER_AGENT=pnpm/11.7.0 pnpm install --prod --frozen-lockfile --ignore-scripts

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
