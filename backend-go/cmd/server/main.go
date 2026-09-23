// Punto de entrada del backend de BitacoraSOC (Go 1.27).
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

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/eventbus"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/handler"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/modules"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/ratelimit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/web"
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
	jwtSigningKey := os.Getenv("JWT_SIGNING_KEY")
	if jwtSigningKey == "" {
		return errors.New("JWT_SIGNING_KEY no configurada")
	}
	encryptionKeyB64 := os.Getenv("APP_ENCRYPTION_KEY")
	if encryptionKeyB64 == "" {
		return errors.New("APP_ENCRYPTION_KEY no configurada")
	}
	encryptionKey, err := crypto.LoadKeyFromEnv(encryptionKeyB64)
	if err != nil {
		return err
	}
	cryptoBox, err := crypto.New(encryptionKey)
	if err != nil {
		return err
	}
	publicBaseURL := os.Getenv("PUBLIC_BASE_URL")
	if publicBaseURL == "" {
		publicBaseURL = "http://localhost"
	}

	pool, err := repository.NewPool(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	queries := db.New(pool)

	// ===== Primitivos =====
	jwtIssuer := auth.NewJWTIssuer([]byte(jwtSigningKey))
	auditStore := &repository.AuditStore{Queries: queries}
	auditLog := audit.NewLogger(auditStore, logger)

	// ===== Hub SSE genérico (Fase 2) =====
	eventStore := &repository.EventStore{Queries: queries}
	hub := eventbus.NewHub()
	hub.Store = eventStore
	sse := &handler.SSEHandler{Hub: hub, Lister: eventStore}

	// ===== Rate limiting (Fase 4, spec/07-backend-arquitectura-go.md sección 6.3) =====
	loginLimiter := &ratelimit.LoginLimiter{
		Store:          &repository.LoginRateLimitStore{Queries: queries},
		MaxAttempts:    5,
		WindowDuration: 15 * time.Minute,
		Now:            time.Now,
	}
	anonymousAPILimiter := ratelimit.NewAPILimiter(300, 15*time.Minute)
	authenticatedAPILimiter := ratelimit.NewAPILimiter(1200, 15*time.Minute)

	// ===== Auth middleware =====
	authMW := middleware.NewAuth(jwtIssuer, &repository.UserLookup{Queries: queries}, &repository.TokenDenylist{Queries: queries}, auditLog)
	apiRateLimit := middleware.APIRateLimit(anonymousAPILimiter, authenticatedAPILimiter)

	// ===== Handlers =====
	health := &handler.HealthHandler{Queries: queries}
	setupHandler := &handler.SetupHandler{Queries: queries, JWT: jwtIssuer, AuditLog: auditLog}
	authHandler := &handler.AuthHandler{
		Queries: queries, JWT: jwtIssuer, Crypto: cryptoBox,
		LoginLimiter: loginLimiter, AuditLog: auditLog, PublicBaseURL: publicBaseURL,
	}
	usersHandler := &handler.UsersHandler{Queries: queries, Crypto: cryptoBox, AuditLog: auditLog}
	permissionGroupsHandler := &handler.PermissionGroupsHandler{Queries: queries, AuditLog: auditLog}
	auditLogHandler := &handler.AuditLogHandler{Queries: queries}
	systemHandler := &handler.SystemHandler{
		Queries: queries, APILimiter: anonymousAPILimiter, AuditLog: auditLog,
		ResetSecret: handler.ResetSecretFromEnv(),
	}
	configHandler := &handler.ConfigHandler{Queries: queries, AuditLog: auditLog, Hub: hub}
	systemFeaturesHandler := &handler.SystemFeaturesHandler{Queries: queries, AuditLog: auditLog, Hub: hub}
	territorialUnitsHandler := &handler.TerritorialUnitsHandler{Pool: pool, Queries: queries, AuditLog: auditLog}

	// Composición de middlewares por ruta — ver internal/middleware/auth.go:
	// RequireNotForcedPasswordChange NO se aplica a las 4 rutas que
	// spec/04-contratos-api.md permite mientras must_change_password=true.
	authed := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(h)))
	}
	authedAllowForced := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(h))
	}
	admin := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireRole("admin")(h))))
	}
	adminOrAuditor := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireRole("admin", "auditor")(h))))
	}
	public := func(h http.HandlerFunc) http.Handler {
		return apiRateLimit(h)
	}
	// Gate de módulo de dominio (HU-0/0b/PERM-2): 403 si la instancia tiene
	// el módulo apagado o el usuario no lo tiene en su alcance. Va dentro de
	// RequireAuth (necesita el usuario) y antes del chequeo de rol.
	moduleAccess := &repository.ModuleAccess{Queries: queries}
	nocAuthed := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireModule(moduleAccess, modules.NOC)(h))))
	}
	nocAdmin := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireModule(moduleAccess, modules.NOC)(middleware.RequireRole("admin")(h)))))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health/live", health.Live)
	mux.HandleFunc("GET /api/health/ready", health.Ready)
	mux.Handle("GET /api/stream/events", authed(sse.Stream))

	// Setup (Fase 4 tarea 0 — ver nota en spec/02-alcance-y-roadmap.md)
	mux.Handle("GET /api/setup/status", public(setupHandler.Status))
	mux.Handle("POST /api/setup/bootstrap", public(setupHandler.Bootstrap))

	// Auth
	mux.Handle("POST /api/auth/login", public(authHandler.Login))
	mux.Handle("POST /api/auth/mfa/authenticate", public(authHandler.MFAAuthenticate))
	mux.Handle("POST /api/auth/mfa/setup", authed(authHandler.MFASetup))
	mux.Handle("POST /api/auth/mfa/verify", authed(authHandler.MFAVerify))
	mux.Handle("POST /api/auth/mfa/disable", authed(authHandler.MFADisable))
	mux.Handle("POST /api/auth/logout", authedAllowForced(authHandler.Logout))
	mux.Handle("POST /api/auth/forgot-password", public(authHandler.ForgotPassword))
	mux.Handle("POST /api/auth/reset-password", public(authHandler.ResetPassword))
	mux.Handle("GET /api/users/me", authedAllowForced(authHandler.Me))
	mux.Handle("PUT /api/users/me/password", authedAllowForced(authHandler.ChangeMyPassword))
	mux.Handle("GET /api/users/me/capabilities", authed(permissionGroupsHandler.MyCapabilities))

	// Usuarios (admin)
	mux.Handle("GET /api/users", admin(usersHandler.List))
	mux.Handle("POST /api/users", admin(usersHandler.Create))
	mux.Handle("PATCH /api/users/{id}", admin(usersHandler.Patch))
	mux.Handle("DELETE /api/users/{id}", admin(usersHandler.Delete))
	mux.Handle("POST /api/users/force-reset-all", admin(usersHandler.ForceResetAll))
	mux.Handle("PUT /api/users/{id}/permission-groups", admin(permissionGroupsHandler.ReplaceUserGroups))

	// Grupos de permisos
	mux.Handle("GET /api/permission-groups", authed(permissionGroupsHandler.List))
	mux.Handle("POST /api/permission-groups", admin(permissionGroupsHandler.Create))
	mux.Handle("PATCH /api/permission-groups/{id}", admin(permissionGroupsHandler.Patch))

	// Válvula de emergencia — secreto compartido, no JWT (ver handler).
	mux.HandleFunc("POST /api/system/rate-limit-reset", systemHandler.RateLimitReset)

	// Auditoría
	mux.Handle("GET /api/audit-logs", adminOrAuditor(auditLogHandler.List))

	// Setup modular post-bootstrap y gobernanza de features (Fase 5)
	mux.Handle("PATCH /api/config/modules", admin(configHandler.PatchModules))
	mux.Handle("GET /api/system-features", authed(systemFeaturesHandler.List))
	mux.Handle("PATCH /api/system-features/{code}", admin(systemFeaturesHandler.Patch))

	// Territorio país-agnóstico (Fase 5). Las etiquetas no son del módulo
	// NOC en el contrato (el wizard las pide antes de que exista territorio);
	// las unidades sí.
	mux.Handle("GET /api/config/territorial-labels", authed(configHandler.GetTerritorialLabels))
	mux.Handle("PATCH /api/config/territorial-labels", admin(configHandler.PatchTerritorialLabels))
	mux.Handle("GET /api/territorial-units", nocAuthed(territorialUnitsHandler.List))
	mux.Handle("POST /api/territorial-units", nocAdmin(territorialUnitsHandler.Create))
	mux.Handle("PATCH /api/territorial-units/{id}", nocAdmin(territorialUnitsHandler.Patch))
	mux.Handle("POST /api/territorial-units/import", nocAdmin(territorialUnitsHandler.Import))
	mux.Handle("GET /api/territorial-units/import/template", nocAuthed(territorialUnitsHandler.ImportTemplate))

	// SPA de Angular embebida (Fase 3) — catch-all, siempre al final.
	spaHandler, err := web.Handler()
	if err != nil {
		return err
	}
	mux.Handle("/", spaHandler)

	// Metadata (request ID/IP/UA) envuelve absolutamente todo — incluso
	// rutas públicas, para que hasta un login fallido quede auditado con
	// contexto completo.
	rootHandler := middleware.Metadata(mux)

	srv := &http.Server{
		Addr:         addr,
		Handler:      rootHandler,
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
	// SSE de larga duración) antes de cerrar el proceso — protocolo de
	// despliegue sin pérdida de sesión, spec/09-alta-disponibilidad-2-nodos.md
	// sección 9.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
