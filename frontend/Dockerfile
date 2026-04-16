# Stage 1: Build Angular app
# Marca de autor en comentarios: Athan Espinoza
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS builder

WORKDIR /app
USER root

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev

# Copiar dependencias
COPY package*.json ./
RUN --mount=type=cache,id=npm-cache-frontend,target=/root/.npm \
    npm ci

# Copiar código y compilar para producción
COPY . .
RUN sed -i "s|__APP_VERSION__|${APP_VERSION}|g" src/environments/environment*.ts
RUN npm run build -- --configuration production

# Stage 2: Servir con Nginx
FROM nginx:alpine

# OpenSSL (certs al arranque) + wget (espera a backend antes de nginx)
RUN apk add --no-cache openssl wget

# Copiar configuración de Nginx
COPY nginx.conf /etc/nginx/nginx.conf

COPY docker-entrypoint.sh /docker-entrypoint-bitacora.sh
RUN sed -i 's/\r$//' /docker-entrypoint-bitacora.sh && chmod +x /docker-entrypoint-bitacora.sh

# Copiar build de Angular (Angular 20 genera en /browser)
COPY --from=builder /app/dist/bitacora-soc/browser /usr/share/nginx/html

# Exponer puerto
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/health || exit 1

ENTRYPOINT ["/docker-entrypoint-bitacora.sh"]
