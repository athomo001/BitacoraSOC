// Punto de entrada del backend de BitacoraSOC (Go 1.27).
// Fase 2 del roadmap (spec/02-alcance-y-roadmap.md): esqueleto técnico con
// health checks reales contra Postgres — sin endpoints de negocio todavía
// (eso empieza en la Fase 4, Auth).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("bitacora-app terminó con error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL no configurada")
	}
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	pool, err := repository.NewPool(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	queries := db.New(pool)
	health := &handler.HealthHandler{Queries: queries}

	// Hub SSE genérico (Fase 2 del roadmap, spec/09-alta-disponibilidad-2-nodos.md
	// secciones 3.2/9.3): un único punto de publicación respaldado en
	// system_events, para reposición vía Last-Event-ID al reconectar.
	eventStore := &repository.EventStore{Queries: queries}
	hub := eventbus.NewHub()
	hub.Store = eventStore
	sse := &handler.SSEHandler{Hub: hub, Lister: eventStore}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health/live", health.Live)
	mux.HandleFunc("GET /api/health/ready", health.Ready)
	// NOTA: el contrato real (spec/04-contratos-api.md) exige JWT (`Auth`) en
	// este endpoint — todavía no existe middleware de auth (llega en la
	// Fase 4), así que por ahora queda sin protección, aceptable solo porque
	// en esta fase el binario no se expone más allá de 127.0.0.1 (sin Caddy/
	// nginx delante todavía). La Fase 4 debe envolver esta ruta con el
	// middleware de auth, no reescribir el handler.
	mux.HandleFunc("GET /api/stream/events", sse.Stream)

	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("bitacora-app escuchando", "addr", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case <-ctx.Done():
		logger.Info("señal de apagado recibida, iniciando graceful shutdown")
	case err := <-serveErr:
		if err != nil {
			return err
		}
	}

	// Graceful shutdown: deja terminar requests en curso (incluidas conexiones
	// SSE de larga duración, ver Fase 2 tarea 7) antes de cerrar el proceso —
	// protocolo de despliegue sin pérdida de sesión, spec/09-alta-disponibilidad-2-nodos.md
	// sección 9.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
