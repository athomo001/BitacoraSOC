# Build multi-stage: build de Angular 22 (frontend-v2) + binario Go estático
# que lo embebe vía //go:embed (spec/07-backend-arquitectura-go.md sección 1,
# Fase 3 del roadmap). Contexto de build = raíz del repo (ver
# docker-compose.yml: `context: .`, `dockerfile: backend-go/Dockerfile`)
# porque este Dockerfile necesita copiar frontend-v2/, que vive fuera de
# backend-go/ — Docker no permite `COPY ../algo` con un contexto más chico.

FROM node:24-slim AS frontend-build
WORKDIR /src/frontend-v2
RUN corepack enable
COPY frontend-v2/package.json frontend-v2/pnpm-lock.yaml frontend-v2/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend-v2/ ./
# El seed territorial de Chile (Fase 5) se sirve como asset estático del
# build de Angular — angular.json lo toma de ../seed, igual que en local.
COPY seed/ /src/seed/
RUN pnpm run build

FROM golang:1.27 AS build
WORKDIR /src
COPY backend-go/go.mod backend-go/go.sum ./
RUN go mod download
COPY backend-go/ .
# Pisa el placeholder de internal/web/dist/browser con el build real de
# Angular — mismo destino que scripts/sync-frontend.sh usa en desarrollo
# local, acá lo hace el propio build de Docker sin depender de haberlo
# corrido antes a mano.
RUN rm -rf internal/web/dist/browser
COPY --from=frontend-build /src/frontend-v2/dist/frontend-v2/browser ./internal/web/dist/browser
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bitacora-app ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/bitacora-app /bitacora-app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/bitacora-app"]
