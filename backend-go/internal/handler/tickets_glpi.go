package handler

import (
	"context"
	"strconv"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/glpi"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/jackc/pgx/v5/pgtype"
)

// Tickets de GLPI en la Ticketera (10d.1, spec/18): GLPI manda en ellos. En
// la app se ven, se filtran y se enlazan, pero no se editan, no tienen enlace
// público y la app no manda correos por ellos.

const ticketSourceGlpi = "glpi"

const glpiReadOnlyMessage = "este ticket vive en GLPI y se edita allá"

func isGlpiTicket(t db.Ticket) bool { return t.Source == ticketSourceGlpi }

// ticketGlpiDTO: de dónde viene un ticket de GLPI y cuándo se trajo.
type ticketGlpiDTO struct {
	ID         int        `json:"id"`
	URL        string     `json:"url,omitempty"`
	SyncedAt   *time.Time `json:"syncedAt,omitempty"`
	Deleted    bool       `json:"deleted"`
	LinkedOnly bool       `json:"linkedOnly"`
	Group      *string    `json:"group,omitempty"`
	Technician *string    `json:"technician,omitempty"`
}

// glpiAPIURL: la dirección de la API guardada, para armar «Abrir en GLPI».
func glpiAPIURL(ctx context.Context, q *db.Queries) string {
	if cfg, err := q.GetGlpiConfig(ctx); err == nil {
		return cfg.ApiUrl
	}
	return ""
}

// withGlpi completa el origen del ticket; los de GLPI no tienen acciones propias.
func withGlpi(v *ticketViewDTO, t db.Ticket, apiURL string) {
	if !isGlpiTicket(t) {
		return
	}
	v.Glpi = &ticketGlpiDTO{ID: int(t.GlpiID.Int32), SyncedAt: timestamptzPtr(t.GlpiSyncedAt), Deleted: t.GlpiDeleted, LinkedOnly: t.GlpiLinkedOnly,
		Group: textPtr(t.GlpiGroupName), Technician: textPtr(t.GlpiTechnician)}
	if apiURL != "" {
		v.Glpi.URL = glpi.WebURL(apiURL, glpi.Ticket, int(t.GlpiID.Int32))
	}
	v.AllowedTransitions = []string{}
	v.CanWork = false
}

// glpiNumber: el número de GLPI de un ticket traído de GLPI, como lo guardan
// las entradas de la Bitácora («48213»); vacío en los de la app.
func glpiNumber(t db.Ticket) pgtype.Text {
	if !isGlpiTicket(t) || !t.GlpiID.Valid {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strconv.Itoa(int(t.GlpiID.Int32)), Valid: true}
}

// glpiCopyOf: la copia en GLPI de un ticket de la app (10d.2), o nil.
func glpiCopyOf(ctx context.Context, q *db.Queries, t db.Ticket) *glpiCopyDTO {
	if !t.GlpiCopyID.Valid {
		return nil
	}
	id := int(t.GlpiCopyID.Int32)
	return &glpiCopyDTO{ID: id, URL: glpi.WebURL(glpiAPIURL(ctx, q), glpi.Ticket, id)}
}
