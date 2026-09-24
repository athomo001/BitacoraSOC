package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// DraftsHandler generaliza el autosave de personal_notes a cualquier
// formulario largo (HU-7d: bitácora, y lo que necesite la Fase 11 para
// checklist) para que un reinicio o despliegue de bitacora-app no pierda
// trabajo en curso. También expone el banner de despliegue (`deployment_ready`)
// sobre el mismo hub SSE genérico de la Fase 2 — ver
// spec/09-alta-disponibilidad-2-nodos.md sección 9.
type DraftsHandler struct {
	Queries  *db.Queries
	AuditLog *audit.Logger
	Hub      eventPublisher
}

type draftDTO struct {
	ID        uuid.UUID `json:"id"`
	FormType  string    `json:"formType"`
	DraftKey  string    `json:"draftKey"`
	UpdatedAt time.Time `json:"updatedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type syncDraftRequest struct {
	FormType string          `json:"formType"`
	DraftKey string          `json:"draftKey"`
	Content  json.RawMessage `json:"content"`
}

func (h *DraftsHandler) Sync(w http.ResponseWriter, r *http.Request) {
	var req syncDraftRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	req.FormType = strings.TrimSpace(req.FormType)
	req.DraftKey = strings.TrimSpace(req.DraftKey)
	if req.FormType == "" || req.DraftKey == "" || len(req.Content) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "formType, draftKey y content son obligatorios")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	draft, err := h.Queries.UpsertDraft(ctx, db.UpsertDraftParams{
		UserID: user.ID, FormType: req.FormType, DraftKey: req.DraftKey, Content: req.Content,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar el borrador")
		return
	}
	writeData(w, http.StatusOK, toDraftDTO(draft))
}

func toDraftDTO(d db.EntryDraft) draftDTO {
	dto := draftDTO{ID: d.ID, FormType: d.FormType, DraftKey: d.DraftKey}
	if d.UpdatedAt.Valid {
		dto.UpdatedAt = d.UpdatedAt.Time
	}
	if d.ExpiresAt.Valid {
		dto.ExpiresAt = d.ExpiresAt.Time
	}
	return dto
}

type draftWithContentDTO struct {
	draftDTO
	Content json.RawMessage `json:"content"`
}

func (h *DraftsHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	formType := queryText(r.URL.Query().Get("formType"))
	rows, err := h.Queries.ListDrafts(ctx, db.ListDraftsParams{UserID: user.ID, FormType: formType})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron listar los borradores")
		return
	}
	items := make([]draftWithContentDTO, 0, len(rows))
	for _, d := range rows {
		items = append(items, draftWithContentDTO{draftDTO: toDraftDTO(d), Content: d.Content})
	}
	writeData(w, http.StatusOK, map[string]any{"items": items})
}

func (h *DraftsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-path", "id inválido")
		return
	}
	ctx := r.Context()
	user, _ := middleware.UserFromContext(ctx)
	affected, err := h.Queries.DeleteDraft(ctx, db.DeleteDraftParams{ID: id, UserID: user.ID})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo borrar el borrador")
		return
	}
	if affected == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "borrador no encontrado")
		return
	}
	writeNoContent(w)
}

type notifyDeploymentRequest struct {
	Version                 string `json:"version"`
	Message                 string `json:"message"`
	AutoRefreshAfterSeconds *int   `json:"autoRefreshAfterSeconds,omitempty"`
}

// NotifyDeployment publica `deployment_ready` en el hub SSE genérico —
// reusa publishSync (config_handler.go), cero infraestructura nueva de hub.
func (h *DraftsHandler) NotifyDeployment(w http.ResponseWriter, r *http.Request) {
	var req notifyDeploymentRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if strings.TrimSpace(req.Version) == "" || strings.TrimSpace(req.Message) == "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "version y message son obligatorios")
		return
	}
	publishSync(r.Context(), h.Hub, "deployment_ready", req)
	h.AuditLog.Log(r.Context(), "deployment.notified", audit.LevelInfo, audit.Success(), map[string]any{"version": req.Version})
	writeData(w, http.StatusAccepted, map[string]any{"status": "accepted"})
}
