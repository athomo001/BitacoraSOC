package glpi

import (
	"context"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Tickets de GLPI para la Ticketera (10d.1, spec/18): se leen aquí; lo que
// la app escribe (10d.2) está en write.go. La
// búsqueda (search/Ticket) trae los números de lo que cambió en las entidades
// marcadas; cada ticket se lee después con sus grupos, técnicos, seguimientos,
// tareas y solución.

const Ticket = "Ticket"

// Opciones de búsqueda de Ticket (CommonITILObject::rawSearchOptions); son
// las mismas en GLPI 9.5, 10 y 11.
const (
	searchID      = "2"
	searchStatus  = "12"
	searchDateMod = "19"
	searchEntity  = "80"
)

// DateLayout es como GLPI escribe las fechas (en la hora de GLPI, sin zona).
const DateLayout = "2006-01-02 15:04:05"

// ErrNotFound: el ticket no existe en GLPI (se purgó) o el usuario no lo ve.
var ErrNotFound = errors.New("no está en GLPI")

// Group es un grupo técnico de GLPI (los que se pueden asignar a un ticket).
type Group struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}

// Groups lee los grupos a los que se les asignan tickets (is_assign).
func Groups(ctx context.Context, s *Session) ([]Group, error) {
	rows, err := s.List(ctx, "Group", nil)
	if err != nil {
		return nil, err
	}
	out := []Group{}
	for _, r := range rows {
		if _, ok := r["is_assign"]; ok && Int(r["is_assign"]) != 1 {
			continue
		}
		name := Str(r["completename"])
		if name == "" {
			name = Str(r["name"])
		}
		out = append(out, Group{ID: Int(r["id"]), Name: name})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// TicketQuery dice qué tickets buscar.
type TicketQuery struct {
	// Entities: las entidades marcadas; cada una con sus hijas.
	Entities []int
	// ModifiedAfter: solo los cambiados después (fecha de GLPI). Vacío = la
	// primera carga: los abiertos y los cambiados después de Since.
	ModifiedAfter string
	Since         string
	// Trashed: los de la papelera.
	Trashed bool
}

// SearchTicketIDs devuelve los números de los tickets que cumplen la búsqueda.
func SearchTicketIDs(ctx context.Context, s *Session, q TicketQuery) ([]int, error) {
	if len(q.Entities) == 0 {
		return nil, nil
	}
	v := url.Values{}
	for i, id := range q.Entities {
		p := fmt.Sprintf("criteria[0][criteria][%d]", i)
		if i > 0 {
			v.Set(p+"[link]", "OR")
		}
		v.Set(p+"[field]", searchEntity)
		v.Set(p+"[searchtype]", "under")
		v.Set(p+"[value]", strconv.Itoa(id))
	}
	v.Set("criteria[1][link]", "AND")
	if q.ModifiedAfter != "" {
		v.Set("criteria[1][field]", searchDateMod)
		v.Set("criteria[1][searchtype]", "morethan")
		v.Set("criteria[1][value]", q.ModifiedAfter)
	} else {
		v.Set("criteria[1][criteria][0][field]", searchStatus)
		v.Set("criteria[1][criteria][0][searchtype]", "equals")
		v.Set("criteria[1][criteria][0][value]", "notold")
		v.Set("criteria[1][criteria][1][link]", "OR")
		v.Set("criteria[1][criteria][1][field]", searchDateMod)
		v.Set("criteria[1][criteria][1][searchtype]", "morethan")
		v.Set("criteria[1][criteria][1][value]", q.Since)
	}
	v.Set("forcedisplay[0]", searchID)
	if q.Trashed {
		v.Set("is_deleted", "1")
	}
	rows, err := s.Search(ctx, Ticket, v)
	if err != nil {
		return nil, err
	}
	seen := map[int]bool{}
	out := []int{}
	for _, r := range rows {
		if id := Int(r[searchID]); id > 0 && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out, nil
}

// Search recorre una búsqueda de GLPI (search/<itemtype>) página por página.
func (s *Session) Search(ctx context.Context, itemtype string, query url.Values) ([]map[string]any, error) {
	var all []map[string]any
	for start := 0; ; start += pageSize {
		q := url.Values{}
		for k, v := range query {
			q[k] = v
		}
		q.Set("range", fmt.Sprintf("%d-%d", start, start+pageSize-1))
		var page struct {
			TotalCount int              `json:"totalcount"`
			Data       []map[string]any `json:"data"`
		}
		_, err := s.do(ctx, http.MethodGet, "search/"+itemtype, q, nil, &page, nil)
		var api *APIError
		if errors.As(err, &api) && api.Code == "ERROR_RANGE_EXCEED_TOTAL" {
			break
		}
		if err != nil {
			return nil, err
		}
		all = append(all, page.Data...)
		if len(page.Data) < pageSize || start+len(page.Data) >= page.TotalCount {
			break
		}
	}
	return all, nil
}

// Note es un seguimiento, una tarea o la solución de un ticket.
type Note struct {
	Kind    string // followup | task | solution
	ID      int
	UserID  int
	Content string
	Private bool
	Date    string
	// Seconds: el tiempo dedicado de una tarea.
	Seconds int
	// Ours: lo escribió la app (lleva SyncMarker); no se trae de vuelta.
	Ours bool
}

// TicketData es un ticket de GLPI con lo que la Ticketera toma de él. Las
// fechas vienen como las escribe GLPI (DateLayout); vacías = sin dato.
type TicketData struct {
	ID       int
	Name     string
	Content  string
	EntityID int
	Type     int
	Status   int
	Urgency  int
	Impact   int
	Priority int
	Deleted  bool

	Date            string
	DateMod         string
	TimeToOwn       string
	TimeToResolve   string
	TakeIntoAccount string
	SolveDate       string
	CloseDate       string
	BeginWaiting    string

	// Groups y Techs: los grupos y técnicos asignados (type 2 en GLPI).
	Groups []int
	Techs  []int
	Notes  []Note
}

// FetchTicket lee un ticket con sus grupos, técnicos, seguimientos, tareas y
// solución. ErrNotFound si no está en GLPI.
func FetchTicket(ctx context.Context, s *Session, id int) (TicketData, error) {
	var r map[string]any
	err := s.Get(ctx, fmt.Sprintf("%s/%d", Ticket, id), nil, &r)
	var api *APIError
	if errors.As(err, &api) && (api.Status == http.StatusNotFound || api.Code == "ERROR_ITEM_NOT_FOUND") {
		return TicketData{}, ErrNotFound
	}
	if err != nil {
		return TicketData{}, err
	}
	t := TicketData{ID: Int(r["id"]), Name: Str(r["name"]), Content: Text(Str(r["content"])), EntityID: Int(r["entities_id"]),
		Type: Int(r["type"]), Status: Int(r["status"]), Urgency: Int(r["urgency"]), Impact: Int(r["impact"]), Priority: Int(r["priority"]),
		Deleted: Int(r["is_deleted"]) == 1, Date: Str(r["date"]), DateMod: Str(r["date_mod"]), TimeToOwn: Str(r["time_to_own"]),
		TimeToResolve: Str(r["time_to_resolve"]), TakeIntoAccount: Str(r["takeintoaccountdate"]), SolveDate: Str(r["solvedate"]),
		CloseDate: Str(r["closedate"]), BeginWaiting: Str(r["begin_waiting_date"])}
	if t.ID == 0 {
		t.ID = id
	}
	if t.TakeIntoAccount == "" && t.Date != "" {
		// GLPI anterior a 10 guarda solo la demora (segundos desde la apertura).
		if delay := Int(r["takeintoaccount_delay_stat"]); delay > 0 {
			if at, err := time.Parse(DateLayout, t.Date); err == nil {
				t.TakeIntoAccount = at.Add(time.Duration(delay) * time.Second).Format(DateLayout)
			}
		}
	}
	sub := func(itemtype string) ([]map[string]any, error) {
		return s.List(ctx, fmt.Sprintf("%s/%d/%s", Ticket, id, itemtype), nil)
	}
	groups, err := sub("Group_Ticket")
	if err != nil {
		return t, fmt.Errorf("grupos del ticket %d: %w", id, err)
	}
	for _, g := range groups {
		if Int(g["type"]) == 2 {
			t.Groups = append(t.Groups, Int(g["groups_id"]))
		}
	}
	users, err := sub("Ticket_User")
	if err != nil {
		return t, fmt.Errorf("técnicos del ticket %d: %w", id, err)
	}
	for _, u := range users {
		if Int(u["type"]) == 2 && Int(u["users_id"]) > 0 {
			t.Techs = append(t.Techs, Int(u["users_id"]))
		}
	}
	followups, err := sub("ITILFollowup")
	if err != nil {
		return t, fmt.Errorf("seguimientos del ticket %d: %w", id, err)
	}
	for _, f := range followups {
		t.Notes = append(t.Notes, Note{Kind: "followup", ID: Int(f["id"]), UserID: Int(f["users_id"]), Content: Text(Str(f["content"])),
			Private: Int(f["is_private"]) == 1, Date: firstDate(f, "date", "date_creation"), Ours: IsOurs(Str(f["content"]))})
	}
	tasks, err := sub("TicketTask")
	if err != nil {
		return t, fmt.Errorf("tareas del ticket %d: %w", id, err)
	}
	for _, k := range tasks {
		user := Int(k["users_id_tech"])
		if user == 0 {
			user = Int(k["users_id"])
		}
		t.Notes = append(t.Notes, Note{Kind: "task", ID: Int(k["id"]), UserID: user, Content: Text(Str(k["content"])),
			Private: Int(k["is_private"]) == 1, Date: firstDate(k, "begin", "date", "date_creation"), Seconds: Int(k["actiontime"])})
	}
	solutions, err := sub("ITILSolution")
	if err != nil {
		return t, fmt.Errorf("solución del ticket %d: %w", id, err)
	}
	for _, x := range solutions {
		if Int(x["status"]) == 4 {
			continue // solución rechazada: el ticket volvió a abrirse
		}
		t.Notes = append(t.Notes, Note{Kind: "solution", ID: Int(x["id"]), UserID: Int(x["users_id"]), Content: Text(Str(x["content"])),
			Date: firstDate(x, "date_creation", "date_mod"), Ours: IsOurs(Str(x["content"]))})
	}
	return t, nil
}

func firstDate(r map[string]any, fields ...string) string {
	for _, f := range fields {
		if v := Str(r[f]); v != "" {
			return v
		}
	}
	return ""
}

// User es una persona de GLPI: su nombre para mostrar y su correo.
type User struct {
	Name  string
	Email string
}

// FetchUser lee el nombre y el correo principal de un usuario de GLPI.
func FetchUser(ctx context.Context, s *Session, id int) (User, error) {
	var r map[string]any
	if err := s.Get(ctx, fmt.Sprintf("User/%d", id), nil, &r); err != nil {
		return User{}, err
	}
	u := User{Name: strings.TrimSpace(Str(r["firstname"]) + " " + Str(r["realname"]))}
	if u.Name == "" {
		u.Name = Str(r["name"])
	}
	emails, err := s.List(ctx, fmt.Sprintf("User/%d/UserEmail", id), nil)
	if err != nil {
		return u, nil // sin correo: se muestra solo el nombre
	}
	for _, e := range emails {
		if mail := Str(e["email"]); mail != "" && (u.Email == "" || Int(e["is_default"]) == 1) {
			u.Email = mail
		}
	}
	return u, nil
}

// ParseDate lee una fecha de GLPI en su zona horaria (la del área).
func ParseDate(raw string, loc *time.Location) (time.Time, bool) {
	if raw == "" || strings.HasPrefix(raw, "0000") {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(DateLayout, raw, loc)
	return t, err == nil
}

var (
	reBreak  = regexp.MustCompile(`(?i)<\s*(br\s*/?|/p|/div|/li|/tr|/h[1-6])\s*>`)
	reItem   = regexp.MustCompile(`(?i)<\s*li[^>]*>`)
	reTag    = regexp.MustCompile(`<[^>]*>`)
	reSpaces = regexp.MustCompile(`[ \t]+\n`)
	reBlank  = regexp.MustCompile(`\n{3,}`)
)

// Text pasa el HTML de GLPI a texto: GLPI 10 guarda el contenido con las
// marcas codificadas («&#60;p&#62;»), así que primero se decodifica.
func Text(s string) string {
	for i := 0; i < 2 && strings.Contains(s, "&"); i++ {
		s = html.UnescapeString(s)
	}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = reBreak.ReplaceAllString(s, "\n")
	s = reItem.ReplaceAllString(s, "- ")
	s = reTag.ReplaceAllString(s, "")
	s = html.UnescapeString(s)
	s = strings.ReplaceAll(s, " ", " ")
	s = reSpaces.ReplaceAllString(s, "\n")
	s = reBlank.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}
