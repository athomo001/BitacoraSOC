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
	"github.com/athomo001/BitacoraSOC/backend-go/internal/reporting"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/scheduler"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/web"
)

// Capacidades de permission_groups usadas en las rutas (HU-PERM-1).
const (
	capDirectoryWrite  = "directory:write"
	capDirectoryDelete = "directory:delete"
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
	// Admin por defecto opcional (BOOTSTRAP_ADMIN_* en .env): solo actúa si el
	// setup todavía no se hizo; si ya hay setup, no toca nada.
	if envAdmin, ok := handler.EnvBootstrapFromEnv(); ok {
		setupHandler.BootstrapFromEnv(ctx, envAdmin, logger)
	}
	authHandler := &handler.AuthHandler{
		Queries: queries, JWT: jwtIssuer, Crypto: cryptoBox,
		LoginLimiter: loginLimiter, AuditLog: auditLog, PublicBaseURL: publicBaseURL,
	}
	usersHandler := &handler.UsersHandler{Queries: queries, Crypto: cryptoBox, AuditLog: auditLog}
	permissionGroupsHandler := &handler.PermissionGroupsHandler{Queries: queries, AuditLog: auditLog}
	auditLogHandler := &handler.AuditLogHandler{Queries: queries}
	backupsHandler := &handler.BackupsHandler{Pool: pool, Queries: queries, AuditLog: auditLog}
	systemHandler := &handler.SystemHandler{
		Queries: queries, APILimiter: anonymousAPILimiter, AuditLog: auditLog,
		ResetSecret: handler.ResetSecretFromEnv(),
	}
	configHandler := &handler.ConfigHandler{Queries: queries, AuditLog: auditLog, Hub: hub}
	systemFeaturesHandler := &handler.SystemFeaturesHandler{Queries: queries, AuditLog: auditLog, Hub: hub}
	territorialUnitsHandler := &handler.TerritorialUnitsHandler{Pool: pool, Queries: queries, AuditLog: auditLog}
	organizationsHandler := &handler.OrganizationsHandler{Queries: queries, AuditLog: auditLog}
	directoryHandler := &handler.DirectoryHandler{Pool: pool, Queries: queries, Crypto: cryptoBox, AuditLog: auditLog}
	smtpConfigHandler := &handler.SMTPConfigHandler{Queries: queries, Crypto: cryptoBox, AuditLog: auditLog}
	escalationHandler := &handler.EscalationHandler{Queries: queries, Crypto: cryptoBox, AuditLog: auditLog, Modules: &repository.ModuleAccess{Queries: queries}}
	teamsHandler := &handler.TeamsHandler{Queries: queries, AuditLog: auditLog, NOCEnabled: func(r *http.Request) bool {
		flags, err := (&repository.ModuleAccess{Queries: queries}).InstanceFlags(r.Context())
		return err == nil && flags.NOC
	}}
	rotationHandler := &handler.RotationHandler{Queries: queries, AuditLog: auditLog}
	checklistsHandler := &handler.ChecklistsHandler{Pool: pool, Queries: queries, AuditLog: auditLog, Crypto: cryptoBox}
	dotacionHandler := &handler.DotacionHandler{Queries: queries, AuditLog: auditLog, PublicBaseURL: publicBaseURL, Sender: func(ctx context.Context) (*mail.Sender, error) {
		sender, _, err := handler.BuildMailSender(ctx, queries, cryptoBox)
		return sender, err
	}}
	entriesHandler := &handler.EntriesHandler{Pool: pool, Queries: queries, AuditLog: auditLog}
	ticketsHandler := &handler.TicketsHandler{Pool: pool, Queries: queries, AuditLog: auditLog}
	entriesHandler.Tickets = ticketsHandler
	notesHandler := &handler.NotesHandler{Queries: queries, AuditLog: auditLog}
	draftsHandler := &handler.DraftsHandler{Queries: queries, AuditLog: auditLog, Hub: hub}

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
	ticketAuthed := func(h http.HandlerFunc) http.Handler {
		return authed(func(w http.ResponseWriter, r *http.Request) {
			ticketsHandler.RequireEnabled(w, r, h)
		})
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
	socAuthed := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireModule(moduleAccess, modules.SOC)(h))))
	}
	socAdmin := func(h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireModule(moduleAccess, modules.SOC)(middleware.RequireRole("admin")(h)))))
	}
	// Permiso por capacidad de permission_groups (HU-PERM-1); admin pasa siempre.
	withCapability := func(capability string, h http.HandlerFunc) http.Handler {
		return authMW.RequireAuth(apiRateLimit(middleware.RequireNotForcedPasswordChange(middleware.RequireCapability(moduleAccess, capability)(h))))
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
	mux.Handle("PATCH /api/users/me", authedAllowForced(authHandler.UpdateMyProfile))
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
	mux.Handle("GET /api/audit-logs/export", adminOrAuditor(auditLogHandler.Export))
	mux.Handle("GET /api/backups/history", admin(backupsHandler.History))
	mux.Handle("POST /api/backups/create", admin(backupsHandler.Create))
	mux.Handle("POST /api/backups/export-delta", authed(backupsHandler.ExportDelta))
	mux.Handle("POST /api/backups/import-delta", admin(backupsHandler.ImportDelta))
	mux.Handle("GET /api/backups/{id}/download", admin(backupsHandler.Download))
	mux.Handle("DELETE /api/backups/{id}", admin(backupsHandler.Delete))

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

	// Organizaciones y catálogo de tecnologías (Fase 6) — núcleo compartido SOC/NOC.
	mux.Handle("GET /api/organizations", authed(organizationsHandler.List))
	mux.Handle("POST /api/organizations", admin(organizationsHandler.Create))
	mux.Handle("PATCH /api/organizations/{id}", admin(organizationsHandler.Patch))
	mux.Handle("GET /api/log-sources", authed(organizationsHandler.ListLogSources))
	mux.Handle("POST /api/log-sources", admin(organizationsHandler.CreateLogSource))
	mux.Handle("PATCH /api/log-sources/{id}", admin(organizationsHandler.PatchLogSource))

	// Directorio Global (Fase 6, HU-DIR-1/2): leer = cualquier sesión;
	// escribir = capacidad directory:write; borrar = directory:delete.
	mux.Handle("GET /api/directory", authed(directoryHandler.List))
	mux.Handle("GET /api/directory/search", authed(directoryHandler.Search))
	mux.Handle("GET /api/directory/{id}", authed(directoryHandler.Get))
	mux.Handle("POST /api/directory", withCapability(capDirectoryWrite, directoryHandler.Create))
	mux.Handle("PUT /api/directory/{id}", withCapability(capDirectoryWrite, directoryHandler.Update))
	mux.Handle("DELETE /api/directory/{id}", withCapability(capDirectoryDelete, directoryHandler.Delete))
	mux.Handle("POST /api/directory/import-csv", withCapability(capDirectoryWrite, directoryHandler.ImportCSV))
	mux.Handle("POST /api/directory/merge-duplicates", admin(directoryHandler.MergeDuplicates))
	mux.Handle("GET /api/contacts/{id}/channels", authed(directoryHandler.ListContactChannels))
	mux.Handle("POST /api/contacts/{id}/channels", withCapability(capDirectoryWrite, directoryHandler.AddContactChannel))
	mux.Handle("DELETE /api/contacts/{id}/channels/{channelId}", withCapability(capDirectoryWrite, directoryHandler.DeleteContactChannel))
	mux.Handle("GET /api/users/{id}/channels", authed(directoryHandler.ListUserChannels))
	mux.Handle("POST /api/users/{id}/channels", admin(directoryHandler.AddUserChannel))
	mux.Handle("DELETE /api/users/{id}/channels/{channelId}", admin(directoryHandler.DeleteUserChannel))

	// Equipos (Fase 6). Activos y cobertura territorial son del módulo NOC.
	mux.Handle("GET /api/team-groups", authed(teamsHandler.ListGroups))
	mux.Handle("POST /api/team-groups", admin(teamsHandler.CreateGroup))
	mux.Handle("GET /api/teams", authed(teamsHandler.List))
	mux.Handle("GET /api/teams/{id}", authed(teamsHandler.Get))
	mux.Handle("POST /api/teams", admin(teamsHandler.Create))
	mux.Handle("PATCH /api/teams/{id}", admin(teamsHandler.Patch))
	mux.Handle("POST /api/teams/{id}/members", admin(teamsHandler.AddMember))
	mux.Handle("DELETE /api/teams/{id}/members/{memberId}", admin(teamsHandler.RemoveMember))
	mux.Handle("GET /api/teams/{id}/coverage", nocAuthed(teamsHandler.ListCoverage))
	mux.Handle("POST /api/teams/{id}/coverage", nocAdmin(teamsHandler.AddCoverage))
	mux.Handle("DELETE /api/teams/{id}/coverage/{territorialUnitId}", nocAdmin(teamsHandler.RemoveCoverage))
	mux.Handle("GET /api/assets", nocAuthed(teamsHandler.ListAssets))
	mux.Handle("POST /api/assets", nocAdmin(teamsHandler.CreateAsset))
	mux.Handle("PATCH /api/assets/{id}", nocAdmin(teamsHandler.PatchAsset))

	// Correo SMTP (gap de la Fase 4 construido en la Fase 7: notify lo necesita).
	mux.Handle("GET /api/config/smtp", admin(smtpConfigHandler.Get))
	mux.Handle("PUT /api/config/smtp", admin(smtpConfigHandler.Put))
	mux.Handle("POST /api/config/smtp/test-send", admin(smtpConfigHandler.TestSend))

	// Motor de escalación (Fase 7). resolve/actions/notify/policies aplican el
	// gate de módulo según el scope del request (serviceId = SOC, assetId /
	// territorialUnitId = NOC), dentro del handler.
	mux.Handle("GET /api/services", socAuthed(escalationHandler.ListServices))
	mux.Handle("POST /api/services", socAdmin(escalationHandler.CreateService))
	mux.Handle("GET /api/escalation/resolve", authed(escalationHandler.Resolve))
	mux.Handle("POST /api/escalation/actions", authed(escalationHandler.RecordAction))
	mux.Handle("GET /api/escalation/actions", authed(escalationHandler.ListActions))
	mux.Handle("POST /api/escalation/notify", authed(escalationHandler.Notify))
	mux.Handle("GET /api/escalation/policies", authed(escalationHandler.ListPolicies))
	mux.Handle("POST /api/escalation/policies", admin(escalationHandler.CreatePolicy))
	mux.Handle("DELETE /api/escalation/policies/{id}", admin(escalationHandler.DeletePolicy))
	mux.Handle("POST /api/escalation/policies/{id}/steps", admin(escalationHandler.AddStep))
	mux.Handle("DELETE /api/escalation/policies/{id}/steps/{stepOrder}", admin(escalationHandler.DeleteStep))
	mux.Handle("GET /api/maintenance-windows", authed(escalationHandler.ListWindows))
	mux.Handle("POST /api/maintenance-windows", admin(escalationHandler.CreateWindow))
	mux.Handle("DELETE /api/maintenance-windows/{id}", admin(escalationHandler.DeleteWindow))
	mux.Handle("GET /api/raci-assignments", authed(escalationHandler.ListRaci))
	mux.Handle("POST /api/raci-assignments", admin(escalationHandler.CreateRaci))

	// Turnos y rotación de guardia (Fase 8, HU-4/HU-5) — núcleo siempre
	// activo, sin gate SOC/NOC. GET/POST/PATCH de rotation-slots no estaban
	// en el contrato original (faltaba forma de armar/pausar el rol semanal,
	// ver spec/04-contratos-api.md sección "Turnos") — agregados en esta fase.
	mux.Handle("GET /api/rotation-cycles", authed(rotationHandler.ListCycles))
	mux.Handle("POST /api/rotation-cycles", admin(rotationHandler.CreateCycle))
	mux.Handle("GET /api/rotation-slots/current", authed(rotationHandler.CurrentSlot))
	mux.Handle("GET /api/rotation-slots", authed(rotationHandler.ListSlots))
	mux.Handle("POST /api/rotation-slots", admin(rotationHandler.CreateSlot))
	mux.Handle("PATCH /api/rotation-slots/{id}", admin(rotationHandler.PatchSlot))
	mux.Handle("POST /api/rotation-overrides", admin(rotationHandler.CreateOverride))
	mux.Handle("GET /api/work-shifts", authed(rotationHandler.ListWorkShifts))
	mux.Handle("POST /api/work-shifts", admin(rotationHandler.CreateWorkShift))

	// Checklists y cierre de turno (Fase 11).
	mux.Handle("GET /api/checklist-templates/active", authed(checklistsHandler.ActiveTemplates))
	mux.Handle("GET /api/shift-checks", authed(checklistsHandler.List))
	mux.Handle("POST /api/shift-checks", authed(checklistsHandler.Create))
	mux.Handle("POST /api/shift-checks/abandoned", authed(checklistsHandler.Abandoned))
	mux.Handle("POST /api/shift-checks/close", authed(checklistsHandler.Close))
	mux.Handle("GET /api/shift-checks/handover", authed(checklistsHandler.Handover))
	mux.Handle("POST /api/shift-checks/closures/{id}/acknowledge", authed(checklistsHandler.Acknowledge))

	// Dotación, teletrabajo y pantalla TV (Fase 8, HU-4b/HU-5b) — núcleo
	// siempre activo.
	mux.Handle("GET /api/work-shifts/matrix", authed(dotacionHandler.Matrix))
	mux.Handle("POST /api/work-shifts/assignments", admin(dotacionHandler.CreateAssignment))
	mux.Handle("POST /api/public-shares/telework", admin(dotacionHandler.PublicShareAction))
	mux.Handle("GET /api/work-shifts/notification-schedules", admin(dotacionHandler.ListNotificationSchedules))
	mux.Handle("POST /api/work-shifts/notification-schedules", admin(dotacionHandler.CreateNotificationSchedule))
	mux.Handle("PATCH /api/work-shifts/notification-schedules/{id}", admin(dotacionHandler.PatchNotificationSchedule))
	mux.Handle("POST /api/work-shifts/notification-schedules/{id}/test", admin(dotacionHandler.TestNotificationSchedule))
	// Página pública sin login para la TV de sala (HU-4b) — primer endpoint
	// HTML del backend, fuera del envoltorio {data} y sin auth a propósito.
	mux.HandleFunc("GET /p/telework/{token}", dotacionHandler.PublicTeleworkPage)

	// Bitácora (Fase 9, HU-7 y siguientes) — núcleo siempre activo, sin gate
	// SOC/NOC (`scope` es un dato, no un permiso).
	mux.Handle("GET /api/entries", authed(entriesHandler.List))
	mux.Handle("POST /api/entries", authed(entriesHandler.Create))
	mux.Handle("GET /api/entries/export", authed(entriesHandler.Export))
	mux.Handle("POST /api/entries/upload-image", authed(entriesHandler.UploadImage))
	mux.Handle("PATCH /api/entries/bulk", admin(entriesHandler.BulkPatch))
	mux.Handle("GET /api/entries/{id}", authed(entriesHandler.Get))
	mux.Handle("PATCH /api/entries/{id}", authed(entriesHandler.Patch))
	mux.Handle("DELETE /api/entries/{id}", authed(entriesHandler.Delete))
	mux.Handle("POST /api/entries/{id}/comments", authed(entriesHandler.AddComment))
	mux.Handle("GET /api/attachments/{id}", authed(entriesHandler.ServeAttachment))

	// Ticketera nativa ITIL (Fase 10). El feature gate se evalúa por request:
	// apagar native_tickets revoca inmediatamente todas las rutas privadas.
	mux.Handle("GET /api/tickets", ticketAuthed(ticketsHandler.List))
	mux.Handle("POST /api/tickets", ticketAuthed(ticketsHandler.Create))
	mux.Handle("GET /api/tickets/{id}", ticketAuthed(ticketsHandler.Get))
	mux.Handle("PATCH /api/tickets/{id}", ticketAuthed(ticketsHandler.Patch))
	mux.Handle("POST /api/tickets/{id}/comments", ticketAuthed(ticketsHandler.AddComment))
	mux.Handle("GET /api/tickets/{id}/tasks", ticketAuthed(ticketsHandler.ListTasks))
	mux.Handle("POST /api/tickets/{id}/tasks", ticketAuthed(ticketsHandler.AddTask))
	mux.Handle("PATCH /api/tickets/{id}/tasks/{taskId}", ticketAuthed(ticketsHandler.PatchTask))
	mux.Handle("POST /api/entries/{id}/ticket-link", ticketAuthed(ticketsHandler.LinkEntry))
	mux.Handle("POST /api/entries/{id}/convert-to-ticket", ticketAuthed(ticketsHandler.ConvertEntry))
	mux.Handle("POST /api/entries/{id}/resolve", ticketAuthed(ticketsHandler.ResolveEntry))
	mux.Handle("GET /p/tickets/{token}", public(ticketsHandler.Public))

	// Notas Operativas (Fase 9): pizarrón admin + libreta personal.
	mux.Handle("GET /api/notes/admin", authed(notesHandler.GetAdmin))
	mux.Handle("PUT /api/notes/admin", admin(notesHandler.PutAdmin))
	mux.Handle("GET /api/notes/personal", authed(notesHandler.GetPersonal))
	mux.Handle("PUT /api/notes/personal", authed(notesHandler.PutPersonal))

	// Borradores (Autosave, HU-7d) y notificación de despliegue por SSE.
	mux.Handle("POST /api/drafts/sync", authed(draftsHandler.Sync))
	mux.Handle("GET /api/drafts", authed(draftsHandler.List))
	mux.Handle("DELETE /api/drafts/{id}", authed(draftsHandler.Delete))
	mux.Handle("POST /api/deployments/notify", admin(draftsHandler.NotifyDeployment))

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
	reportDispatcher := &reporting.Dispatcher{Queries: queries, Sender: func(ctx context.Context) (*mail.Sender, error) {
		sender, _, err := handler.BuildMailSender(ctx, queries, cryptoBox)
		return sender, err
	}, Schedules: func(ctx context.Context, sender *mail.Sender) error {
		return dotacionHandler.DispatchDueSchedules(ctx, sender)
	}}
	mux.Handle("POST /api/reports/shift/dispatch", admin(func(w http.ResponseWriter, r *http.Request) {
		if err := reportDispatcher.DispatchPending(r.Context()); err != nil {
			http.Error(w, "no se pudieron procesar los reportes pendientes", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	go scheduler.Run(ctx, time.Minute, reportDispatcher.DispatchPending)

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
