#!/bin/sh
set -eu

CERT_DIR=/etc/nginx/certs
if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "[bitacora-frontend] Generando certificados TLS en $CERT_DIR (solo desarrollo / arranque sin cert montado)."
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -subj "/CN=localhost"
fi
# Nginx worker puede correr como otro uid según imagen
chown -R 1001:1001 "$CERT_DIR" 2>/dev/null || true

# Evita 502 en ráfaga: Nginx no debe proxyar antes de que Express escuche en 3000.
echo "[bitacora-frontend] Esperando http://backend:3000/health ..."
n=0
max=120
while [ "$n" -lt "$max" ]; do
  if wget -q --spider --timeout=2 "http://backend:3000/health" 2>/dev/null; then
    echo "[bitacora-frontend] Backend OK."
    break
  fi
  n=$((n + 1))
  if [ "$n" -eq "$max" ]; then
    echo "[bitacora-frontend] ADVERTENCIA: backend no respondió en ${max}s; arrancando Nginx igual (revisar logs de bitacora-backend)."
    break
  fi
  sleep 1
done

exec nginx -g "daemon off;"
