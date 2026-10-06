package handler

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Eliminar una organización (pedido del dueño 2026-10-05, canvas v22): en vez
// de un error "no se puede eliminar", el popup muestra lo asociado y cada
// cosa se resuelve ahí mismo. Servicios, equipos y activos deben quedar
// resueltos (mover, renombrar o eliminar si no tienen historial); los tickets
// se pueden mover si se quiere, si no quedan en el histórico con el nombre de
// la organización; los contactos no dependen de ella. La organización queda
// archivada: desaparece de listas y selectores y tickets/contactos conservan
// su nombre.

type orgDependentItemDTO struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Code      string    `json:"code,omitempty"`
	Detail    string    `json:"detail"`
	Deletable bool      `json:"deletable"`
}

type orgDependentTicketDTO struct {
	ID        uuid.UUID `json:"id"`
	Number    string    `json:"number"`
	Title     string    `json:"title"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

type orgDependentsDTO struct {
	Services []orgDependentItemDTO   `json:"services"`
	Teams    []orgDependentItemDTO   `json:"teams"`
	Assets   []orgDependentItemDTO   `json:"assets"`
	Tickets  []orgDependentTicketDTO `json:"tickets"`
	Contacts int64                   `json:"contacts"`
}

func plural(n int64, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return fmt.Sprintf("%d %s", n, many)
}

// historyDetail: "124 entradas · 3 tickets" o "Sin historial".
func historyDetail(parts ...string) string {
	var out []string
	for _, p := range parts {
		if p != "" && !strings.HasPrefix(p, "0 ") {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return "Sin historial"
	}
	return strings.Join(out, " · ")
}

func (h *OrganizationsHandler) dependents(ctx context.Context, q *db.Queries, id uuid.UUID) (orgDependentsDTO, error) {
	out := orgDependentsDTO{Services: []orgDependentItemDTO{}, Teams: []orgDependentItemDTO{}, Assets: []orgDependentItemDTO{}, Tickets: []orgDependentTicketDTO{}}
	services, err := q.ListOrgServicesForDelete(ctx, id)
	if err != nil {
		return out, err
	}
	for _, s := range services {
		out.Services = append(out.Services, orgDependentItemDTO{
			ID: s.ID, Name: s.Name, Code: s.Code, Deletable: s.Entries+s.Tickets+s.Windows == 0,
			Detail: historyDetail(plural(s.Entries, "entrada", "entradas"), plural(s.Tickets, "ticket", "tickets"), plural(s.Windows, "mantención", "mantenciones")),
		})
	}
	org := pgtype.UUID{Bytes: id, Valid: true}
	teams, err := q.ListOrgTeamsForDelete(ctx, org)
	if err != nil {
		return out, err
	}
	for _, t := range teams {
		detail := plural(t.Members, "integrante", "integrantes")
		if t.Services > 0 {
			detail += " · escalamiento de " + plural(t.Services, "servicio", "servicios")
		}
		if hist := historyDetail(plural(t.Tickets, "ticket", "tickets"), plural(t.Rotations, "rotación de guardia", "rotaciones de guardia")); hist != "Sin historial" {
			detail += " · " + hist
		}
		out.Teams = append(out.Teams, orgDependentItemDTO{ID: t.ID, Name: t.Name, Detail: detail, Deletable: t.Tickets+t.Rotations == 0})
	}
	assets, err := q.ListOrgAssetsForDelete(ctx, org)
	if err != nil {
		return out, err
	}
	for _, a := range assets {
		out.Assets = append(out.Assets, orgDependentItemDTO{
			ID: a.ID, Name: a.Name, Code: a.Code, Deletable: a.Entries+a.Tickets+a.Windows+a.Children == 0,
			Detail: a.Type + " · " + historyDetail(plural(a.Entries, "entrada", "entradas"), plural(a.Tickets, "ticket", "tickets"), plural(a.Windows, "mantención", "mantenciones"), plural(a.Children, "activo dependiente", "activos dependientes")),
		})
	}
	tickets, err := q.ListOrgTicketsForDelete(ctx, id)
	if err != nil {
		return out, err
	}
	for _, t := range tickets {
		out.Tickets = append(out.Tickets, orgDependentTicketDTO{ID: t.ID, Number: t.TicketNumber, Title: t.Title, Status: t.Status, CreatedAt: t.CreatedAt.Time})
	}
	out.Contacts, err = q.CountOrgContacts(ctx, id)
	return out, err
}

// Dependents es GET /api/organizations/{id}/dependents: lo que el popup muestra.
func (h *OrganizationsHandler) Dependents(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	if org, err := h.Queries.GetOrganization(r.Context(), id); err != nil || org.ArchivedAt.Valid {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	dep, err := h.dependents(r.Context(), h.Queries, id)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo revisar la organización")
		return
	}
	writeData(w, http.StatusOK, dep)
}

type orgDeleteAction struct {
	Kind string     `json:"kind"` // service | team | asset | ticket
	ID   uuid.UUID  `json:"id"`
	Op   string     `json:"op"` // move | delete | rename
	To   *uuid.UUID `json:"to,omitempty"`
	Name string     `json:"name,omitempty"`
}

type orgDeleteRequest struct {
	// MoveTo: "Todo de una", mueve los servicios, equipos y activos que
	// queden sin resolver (los tickets solo se mueven uno por uno).
	MoveTo  *uuid.UUID        `json:"moveTo,omitempty"`
	Actions []orgDeleteAction `json:"actions"`
}

// errOrgDelete es un problema que el usuario puede corregir en el popup.
type errOrgDelete struct{ msg string }

func (e errOrgDelete) Error() string { return e.msg }

// Delete es DELETE /api/organizations/{id}: aplica lo decidido en el popup
// (todo o nada) y archiva la organización.
func (h *OrganizationsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	var req orgDeleteRequest
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
			return
		}
	}
	ctx := r.Context()
	org, err := h.Queries.GetOrganization(ctx, id)
	if err != nil || org.ArchivedAt.Valid {
		problemdetails.Write(w, r, 404, "not-found", "organización no encontrada")
		return
	}
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo eliminar la organización")
		return
	}
	defer tx.Rollback(ctx)
	q := h.Queries.WithTx(tx)
	summary, err := h.applyOrgDelete(ctx, q, id, req)
	var userErr errOrgDelete
	if errors.As(err, &userErr) {
		problemdetails.Write(w, r, http.StatusConflict, "organization-in-use", userErr.msg)
		return
	}
	if err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo eliminar la organización")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, 500, "internal-error", "no se pudo eliminar la organización")
		return
	}
	summary["organizationId"] = id.String()
	summary["name"] = org.Name
	h.AuditLog.Log(ctx, "organization.delete", audit.LevelWarn, audit.Success(), summary)
	w.WriteHeader(http.StatusNoContent)
}

func (h *OrganizationsHandler) targetOrg(ctx context.Context, q *db.Queries, from uuid.UUID, to *uuid.UUID) (uuid.UUID, error) {
	if to == nil || *to == from {
		return uuid.Nil, errOrgDelete{"elige otra organización a la que mover"}
	}
	target, err := q.GetOrganization(ctx, *to)
	if err != nil || target.ArchivedAt.Valid {
		return uuid.Nil, errOrgDelete{"la organización de destino no existe"}
	}
	return target.ID, nil
}

func (h *OrganizationsHandler) applyOrgDelete(ctx context.Context, q *db.Queries, id uuid.UUID, req orgDeleteRequest) (map[string]any, error) {
	org := pgtype.UUID{Bytes: id, Valid: true}
	counts := map[string]int{}
	for _, a := range req.Actions {
		n, err := h.applyOrgAction(ctx, q, id, org, a)
		if err != nil {
			return nil, err
		}
		if n == 0 {
			return nil, errOrgDelete{"algo cambió mientras decidías: vuelve a abrir el popup"}
		}
		counts[a.Kind+"."+a.Op]++
	}
	if req.MoveTo != nil {
		to, err := h.targetOrg(ctx, q, id, req.MoveTo)
		if err != nil {
			return nil, err
		}
		dep, err := h.dependents(ctx, q, id)
		if err != nil {
			return nil, err
		}
		toOrg := pgtype.UUID{Bytes: to, Valid: true}
		for _, s := range dep.Services {
			if _, err := q.MoveServiceToOrganization(ctx, db.MoveServiceToOrganizationParams{ToOrg: to, ID: s.ID, FromOrg: id}); err != nil {
				return nil, moveErr(err, "servicio", s.Name)
			}
		}
		for _, t := range dep.Teams {
			if _, err := q.MoveTeamToOrganization(ctx, db.MoveTeamToOrganizationParams{ToOrg: toOrg, ID: t.ID, FromOrg: org}); err != nil {
				return nil, moveErr(err, "equipo", t.Name)
			}
		}
		for _, a := range dep.Assets {
			if _, err := q.MoveAssetToOrganization(ctx, db.MoveAssetToOrganizationParams{ToOrg: toOrg, ID: a.ID, FromOrg: org}); err != nil {
				return nil, moveErr(err, "activo", a.Name)
			}
		}
		counts["moveTo"] = len(dep.Services) + len(dep.Teams) + len(dep.Assets)
	}
	for _, step := range []func(context.Context, pgtype.UUID) error{q.ReleaseOrganizationGroups, q.ReleaseOrganizationVia, q.DeleteOrganizationRaci, q.DeleteOrganizationGroups} {
		if err := step(ctx, org); err != nil {
			return nil, err
		}
	}
	n, err := q.ArchiveOrganization(ctx, id)
	if err != nil {
		return nil, err
	}
	if n == 0 {
		dep, _ := h.dependents(ctx, q, id)
		return nil, errOrgDelete{"todavía tiene " + pendingSummary(dep) + ": resuélvelos antes de eliminarla"}
	}
	summary := map[string]any{"actions": counts}
	if req.MoveTo != nil {
		summary["movedTo"] = req.MoveTo.String()
	}
	return summary, nil
}

func pendingSummary(d orgDependentsDTO) string {
	var parts []string
	if n := int64(len(d.Services)); n > 0 {
		parts = append(parts, plural(n, "servicio", "servicios"))
	}
	if n := int64(len(d.Teams)); n > 0 {
		parts = append(parts, plural(n, "equipo", "equipos"))
	}
	if n := int64(len(d.Assets)); n > 0 {
		parts = append(parts, plural(n, "activo", "activos"))
	}
	return strings.Join(parts, ", ")
}

func moveErr(err error, kind, name string) error {
	if isUniqueViolation(err) {
		return errOrgDelete{fmt.Sprintf("ya existe un %s llamado «%s» en la organización de destino: renómbralo antes de moverlo", kind, name)}
	}
	return err
}

func (h *OrganizationsHandler) applyOrgAction(ctx context.Context, q *db.Queries, id uuid.UUID, org pgtype.UUID, a orgDeleteAction) (int64, error) {
	name := strings.TrimSpace(a.Name)
	if a.Op == "rename" && name == "" {
		return 0, errOrgDelete{"el nombre no puede quedar vacío"}
	}
	var to uuid.UUID
	if a.Op == "move" {
		var err error
		if to, err = h.targetOrg(ctx, q, id, a.To); err != nil {
			return 0, err
		}
	}
	toOrg := pgtype.UUID{Bytes: to, Valid: true}
	switch a.Kind + "." + a.Op {
	case "service.move":
		n, err := q.MoveServiceToOrganization(ctx, db.MoveServiceToOrganizationParams{ToOrg: to, ID: a.ID, FromOrg: id})
		return n, moveErr(err, "servicio", a.Name)
	case "service.rename":
		n, err := q.RenameService(ctx, db.RenameServiceParams{Name: name, ID: a.ID, Org: id})
		if isUniqueViolation(err) {
			return 0, errOrgDelete{"ya hay un servicio llamado «" + name + "» en esta organización"}
		}
		return n, err
	case "service.delete":
		if err := q.DeleteServiceRaci(ctx, pgtype.UUID{Bytes: a.ID, Valid: true}); err != nil {
			return 0, err
		}
		if err := q.DeleteServicePolicies(ctx, pgtype.UUID{Bytes: a.ID, Valid: true}); err != nil {
			return 0, err
		}
		n, err := q.DeleteServiceWithoutHistory(ctx, db.DeleteServiceWithoutHistoryParams{ID: a.ID, Org: id})
		if err == nil && n == 0 {
			return 0, errOrgDelete{"un servicio con historial no se elimina: muévelo a otra organización"}
		}
		return n, err
	case "team.move":
		n, err := q.MoveTeamToOrganization(ctx, db.MoveTeamToOrganizationParams{ToOrg: toOrg, ID: a.ID, FromOrg: org})
		return n, moveErr(err, "equipo", a.Name)
	case "team.rename":
		return q.RenameTeam(ctx, db.RenameTeamParams{Name: name, ID: a.ID, Org: org})
	case "team.delete":
		if err := q.DeleteTeamRaci(ctx, a.ID); err != nil {
			return 0, err
		}
		if err := q.DeleteTeamSteps(ctx, a.ID); err != nil {
			return 0, err
		}
		n, err := q.DeleteTeamWithoutHistory(ctx, db.DeleteTeamWithoutHistoryParams{ID: a.ID, Org: org})
		if err == nil && n == 0 {
			return 0, errOrgDelete{"un equipo con tickets o rotaciones de guardia no se elimina: muévelo a otra organización"}
		}
		return n, err
	case "asset.move":
		n, err := q.MoveAssetToOrganization(ctx, db.MoveAssetToOrganizationParams{ToOrg: toOrg, ID: a.ID, FromOrg: org})
		return n, moveErr(err, "activo", a.Name)
	case "asset.rename":
		return q.RenameAsset(ctx, db.RenameAssetParams{Name: name, ID: a.ID, Org: org})
	case "asset.delete":
		if err := q.DeleteAssetRaci(ctx, pgtype.UUID{Bytes: a.ID, Valid: true}); err != nil {
			return 0, err
		}
		if err := q.DeleteAssetPolicies(ctx, pgtype.UUID{Bytes: a.ID, Valid: true}); err != nil {
			return 0, err
		}
		n, err := q.DeleteAssetWithoutHistory(ctx, db.DeleteAssetWithoutHistoryParams{ID: a.ID, Org: org})
		if err == nil && n == 0 {
			return 0, errOrgDelete{"un activo con historial no se elimina: muévelo a otra organización"}
		}
		return n, err
	case "ticket.move":
		return q.MoveTicketToOrganization(ctx, db.MoveTicketToOrganizationParams{ToOrg: to, ID: a.ID, FromOrg: id})
	}
	// Tickets y contactos nunca se borran desde aquí.
	return 0, errOrgDelete{"acción no permitida: " + a.Kind + " " + a.Op}
}
