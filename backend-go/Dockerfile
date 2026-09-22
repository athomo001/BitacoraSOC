# Build multi-stage: binario Go estático + (a partir de la Fase 3) build de
# Angular embebido vía //go:embed. Fase 2: solo el binario Go, sin frontend.
FROM golang:1.27 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/bitacora-app ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/bitacora-app /bitacora-app
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/bitacora-app"]
