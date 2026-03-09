# Stage 1: Build Angular app
FROM node:24-alpine AS builder

WORKDIR /app

# Version del build (inyectada desde Docker Compose/CI)
ARG APP_VERSION=dev

# Copiar dependencias
COPY package*.json ./
RUN npm ci && npm cache clean --force

# Copiar código y compilar para producción
COPY . .
RUN sed -i "s|__APP_VERSION__|${APP_VERSION}|g" src/environments/environment*.ts
RUN npm run build -- --configuration production

# Stage 2: Servir con Nginx
FROM nginx:alpine

# Instalar OpenSSL para poder auto-generar certificados dummy en el arranque
RUN apk add --no-cache openssl

# Copiar configuración de Nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Copiar build de Angular (Angular 20 genera en /browser)
COPY --from=builder /app/dist/bitacora-soc/browser /usr/share/nginx/html

# Exponer puerto
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/health || exit 1

# Nginx se ejecuta en foreground por defecto
CMD ["nginx", "-g", "daemon off;"]
