package ticketmail

import (
	"strings"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
)

// TicketData es lo que un aviso puede mostrar de un ticket. Los campos del
// equipo (equipo, responsable, creado por) nunca se usan en un aviso al cliente.
type TicketData struct {
	Number        string
	Title         string
	Priority      string // p1_critical…
	Status        string // new, in_progress…
	ClientName    string
	TeamName      string
	Responsible   string
	CreatedBy     string
	CreatedAt     string
	ResolutionDue string
	TeamURL       string
	TrackingURL   string
	Pin           string
	// Extra: el otro ticket al unir, "A → B" al cambiar cliente, quién se sumó.
	Extra string
}

var priorityShort = map[string]string{"p1_critical": "P1", "p2_high": "P2", "p3_medium": "P3", "p4_low": "P4"}

var statusLabel = map[string]string{
	"new": "Nuevo", "assigned": "Asignado", "in_progress": "En curso", "pending_vendor": "Espera proveedor",
	"resolved": "Resuelto", "closed": "Cerrado", "cancelled": "Cancelado",
}

// PriorityShort: "P1"… (vacío si no se conoce).
func PriorityShort(p string) string { return priorityShort[p] }

var clientEventLabel = map[string]string{
	ClientOpened: "Abierto", ClientComment: "Nuevo comentario", ClientPendingVendor: "En espera de proveedor",
	ClientResumed: "Retomado", ClientResolved: "Resuelto", ClientReopened: "Reabierto", ClientClosed: "Cerrado",
}

var clientIntro = map[string]string{
	ClientOpened:        "Registramos un ticket que afecta a su servicio. Puede seguir su avance con el enlace de abajo.",
	ClientComment:       "Hay novedades en su ticket:",
	ClientPendingVendor: "Seguimos: estamos esperando al proveedor.",
	ClientResumed:       "Retomamos el trabajo en su ticket.",
	ClientResolved:      "Su ticket quedó resuelto.",
	ClientReopened:      "Volvimos a abrir su ticket.",
	ClientClosed:        "Su ticket quedó cerrado.",
}

// Render arma el correo de un evento. comments: los comentarios visibles al
// cliente (agrupados) o la solución al resolver.
func Render(appTitle, event string, d TicketData, s Settings, comments []string) mailtpl.Mail {
	p := PriorityShort(d.Priority)
	if IsClient(event) {
		label := clientEventLabel[event]
		rows := [][2]string{{"Ticket", d.Number}, {"Estado", statusLabel[d.Status]}}
		if s.IncludePin && d.Pin != "" {
			rows = append(rows, [2]string{"PIN", d.Pin})
		}
		return mailtpl.Ticket(appTitle, mailtpl.TicketNotice{
			Subject: d.Number + " · " + label + ": " + d.Title,
			Title:   d.Title, Intro: clientIntro[event], Rows: rows, Comments: comments,
			ButtonText: "Ver el seguimiento", ButtonURL: d.TrackingURL,
			Footer: strings.TrimSpace(s.Signature),
		})
	}
	subject, title, intro := teamTexts(event, d, p)
	rows := [][2]string{{"Cliente", d.ClientName}, {"Prioridad", p}, {"Estado", statusLabel[d.Status]}}
	if d.TeamName != "" {
		rows = append(rows, [2]string{"Equipo", d.TeamName})
	}
	if d.Responsible != "" {
		rows = append(rows, [2]string{"Responsable", d.Responsible})
	}
	if d.CreatedBy != "" {
		rows = append(rows, [2]string{"Creado por", strings.TrimSpace(d.CreatedBy + " · " + d.CreatedAt)})
	}
	if d.ResolutionDue != "" {
		rows = append(rows, [2]string{"Vence", d.ResolutionDue})
	}
	n := mailtpl.TicketNotice{
		Subject: subject, Title: title, Intro: intro, Rows: rows,
		Footer: "Aviso automático de " + mailtpl.AppTitleForText(appTitle) + ". No responder a este correo.",
	}
	if s.TeamLink && d.TeamURL != "" {
		n.ButtonText, n.ButtonURL = "Abrir el ticket", d.TeamURL
	}
	return mailtpl.Ticket(appTitle, n)
}

func teamTexts(event string, d TicketData, p string) (subject, title, intro string) {
	head := d.Number + " · " + d.Title
	switch event {
	case TeamCreated:
		return "Nuevo ticket " + d.Number + " · " + p + " · " + d.Title, "Nuevo ticket", head
	case TeamAssigned:
		return "Te asignaron " + d.Number + " · " + p, "Te asignaron un ticket", head
	case TeamResolverAdded:
		return "Te sumaron a " + d.Number, "Te sumaron a un ticket", head
	case TeamSLAResponseBreached:
		return "SLA vencido · " + d.Number + " · " + p, "SLA de respuesta vencido", head + ": nadie respondió a tiempo."
	case TeamSLAResolutionWarning:
		return "SLA al 80 % · " + d.Number, "SLA de resolución por vencer", head + ": ya usó el 80 % del tiempo de resolución."
	case TeamSLAResolutionBreached:
		return "SLA vencido · " + d.Number + " · " + p, "SLA de resolución vencido", head
	case TeamReopened:
		return "Reabierto " + d.Number, "Ticket reabierto", head
	case TeamPendingVendor:
		return "En espera de proveedor · " + d.Number, "En espera de proveedor", head + ": el SLA queda en pausa."
	case TeamResolved:
		return "Resuelto " + d.Number, "Ticket resuelto", head
	case TeamMerged:
		return d.Extra + " se unió a " + d.Number, "Tickets unidos", d.Extra + " se unió a " + head + ", donde sigue el seguimiento."
	case TeamClientChanged:
		return "Cliente cambiado · " + d.Number, "Cliente cambiado", head + ": " + d.Extra + "."
	}
	return d.Number, d.Number, head
}
