package glpi

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
)

// Escribir en GLPI (10d.2, spec/18 §4): comentar un ticket, crear uno y
// resolver, cerrar o reabrir una copia. Usa el User-Token de escritura, que
// es otro usuario de GLPI que el de solo lectura.

// SyncMarker va en todo lo que la app escribe en GLPI (la misma marca del
// legacy, utils/glpi-dispatch.js): es un comentario HTML que GLPI no muestra
// y que la sincronización usa para no traer de vuelta lo propio.
const SyncMarker = "<!-- bitacora-soc-sync -->"

// IsOurs dice si un contenido de GLPI lo escribió la app. GLPI 10 guarda el
// HTML codificado («&lt;!-- … --&gt;»), así que se decodifica antes.
func IsOurs(raw string) bool {
	for i := 0; i < 3; i++ {
		if strings.Contains(raw, SyncMarker) {
			return true
		}
		if !strings.Contains(raw, "&") {
			return false
		}
		raw = html.UnescapeString(raw)
	}
	return strings.Contains(raw, SyncMarker)
}

// HTML pasa un texto de la app a lo que GLPI muestra (saltos de línea como
// <br>) y le agrega la marca de la app.
func HTML(text string) string {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(text), "\r\n", "\n"), "\n")
	for i, l := range lines {
		lines[i] = html.EscapeString(l)
	}
	return "<p>" + strings.Join(lines, "<br>") + "</p>\n" + SyncMarker
}

type created struct {
	ID      any    `json:"id"`
	Message string `json:"message"`
}

func (s *Session) add(ctx context.Context, itemtype string, input map[string]any) (int, error) {
	var out created
	if _, err := s.do(ctx, http.MethodPost, itemtype, nil, map[string]any{"input": input}, &out, nil); err != nil {
		return 0, err
	}
	id := Int(out.ID)
	if id <= 0 {
		msg := strings.TrimSpace(Text(out.Message))
		if msg == "" {
			msg = "GLPI no devolvió el número del ítem creado"
		}
		return 0, errors.New(msg)
	}
	return id, nil
}

// AddFollowup agrega un seguimiento a un ticket y devuelve su número.
func AddFollowup(ctx context.Context, s *Session, ticketID int, text string, private bool) (int, error) {
	return s.add(ctx, "ITILFollowup", map[string]any{"itemtype": Ticket, "items_id": ticketID, "content": HTML(text), "is_private": boolInt(private)})
}

// NewTicket es lo que se crea en GLPI desde la app.
type NewTicket struct {
	Name     string
	Content  string
	EntityID int
	// Type: 1 incidente, 2 requerimiento.
	Type    int
	Urgency int
	Impact  int
	// GroupID: el grupo técnico asignado (0 = ninguno).
	GroupID int
	// RequesterID: el solicitante (0 = el usuario del token).
	RequesterID int
}

// CreateTicket crea un ticket y devuelve su número.
func CreateTicket(ctx context.Context, s *Session, t NewTicket) (int, error) {
	input := map[string]any{"name": t.Name, "content": HTML(t.Content), "entities_id": t.EntityID, "type": t.Type,
		"urgency": t.Urgency, "impact": t.Impact}
	if t.GroupID > 0 {
		input["_groups_id_assign"] = t.GroupID
	}
	if t.RequesterID > 0 {
		input["_users_id_requester"] = t.RequesterID
	}
	return s.add(ctx, Ticket, input)
}

// Solve deja la solución en el ticket (GLPI lo pasa a «Resuelto»).
func Solve(ctx context.Context, s *Session, ticketID int, text string) (int, error) {
	return s.add(ctx, "ITILSolution", map[string]any{"itemtype": Ticket, "items_id": ticketID, "content": HTML(text)})
}

// Estados de un ticket de GLPI que la app pone en una copia.
const (
	StatusAssigned = 2
	StatusClosed   = 6
)

// SetStatus cambia el estado de un ticket (cerrar o reabrir una copia).
func SetStatus(ctx context.Context, s *Session, ticketID, status int) error {
	_, err := s.do(ctx, http.MethodPut, fmt.Sprintf("%s/%d", Ticket, ticketID), nil, map[string]any{"input": map[string]any{"status": status}}, nil, nil)
	return err
}

// searchUserEmail es la opción de búsqueda del correo de un usuario.
const searchUserEmail = "5"

// FindUserByEmail busca el usuario de GLPI con ese correo (0 si no hay).
func FindUserByEmail(ctx context.Context, s *Session, email string) (int, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return 0, nil
	}
	v := url.Values{}
	v.Set("criteria[0][field]", searchUserEmail)
	v.Set("criteria[0][searchtype]", "equals")
	v.Set("criteria[0][value]", email)
	v.Set("forcedisplay[0]", searchID)
	rows, err := s.Search(ctx, "User", v)
	if err != nil {
		return 0, err
	}
	for _, r := range rows {
		if id := Int(r[searchID]); id > 0 {
			return id, nil
		}
	}
	return 0, nil
}

// Whoami es con quién quedó abierta la sesión, para «Probar» sin escribir.
type Whoami struct {
	User    string
	Profile string
}

// WhoAmI lee el usuario y el perfil activo de la sesión.
func WhoAmI(ctx context.Context, s *Session) (Whoami, error) {
	var out struct {
		Session map[string]any `json:"session"`
	}
	if err := s.Get(ctx, "getFullSession", nil, &out); err != nil {
		return Whoami{}, err
	}
	w := Whoami{User: Str(out.Session["glpiname"])}
	if p, ok := out.Session["glpiactiveprofile"].(map[string]any); ok {
		w.Profile = Str(p["name"])
	}
	return w, nil
}

// Permanent dice si un error de GLPI no se arregla reintentando (falta un
// permiso, el ticket está cerrado o no existe): se marca «No se envió».
func Permanent(err error) bool {
	var api *APIError
	if !errors.As(err, &api) {
		return false
	}
	switch api.Status {
	case http.StatusUnauthorized, http.StatusRequestTimeout, http.StatusTooManyRequests:
		return false
	}
	return api.Status >= 400 && api.Status < 500
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
