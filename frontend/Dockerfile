# Stage 1: Build Angular app
# Marca de autor en comentarios: Athan Espinoza
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app
USER root
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev

# Copiar dependencias
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store-frontend,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store && \
  NPM_CONFIG_USER_AGENT=pnpm/11.7.0 pnpm install --frozen-lockfile --ignore-scripts

# Copiar código y compilar para producción
COPY . .
RUN sed -i "s|__APP_VERSION__|${APP_VERSION}|g" src/environments/environment*.ts
RUN pnpm run build --configuration production

# Stage 2: Servir con Nginx
FROM nginx:1.27-alpine

# OpenSSL (certs al arranque) + wget (espera a backend antes de nginx)
RUN apk add --no-cache openssl wget

# Copiar configuración de Nginx
COPY nginx.conf /etc/nginx/nginx.conf

COPY docker-entrypoint.sh /docker-entrypoint-bitacora.sh
RUN sed -i 's/\r$//' /docker-entrypoint-bitacora.sh && chmod +x /docker-entrypoint-bitacora.sh

# Copiar build de Angular (Angular 20 genera en /browser)
COPY --from=builder /app/dist/bitacora-soc/browser /usr/share/nginx/html

# Permisos para Nginx no-root
RUN mkdir -p /var/cache/nginx /var/log/nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx /docker-entrypoint-bitacora.sh && \
  true

# Exponer puerto
EXPOSE 80

# Cambiar a usuario no root
USER nginx

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/health || exit 1

ENTRYPOINT ["/docker-entrypoint-bitacora.sh"]
