// Package glpitest es un GLPI falso (API clásica, apirest.php) para las
// pruebas: sesión con App-Token + User-Token, listas paginadas con
// Content-Range, papelera (is_deleted) y errores con el formato de GLPI.
// Con WriteToken también acepta escrituras (10d.2), solo en esa sesión.
package glpitest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

// Server es el GLPI falso. Rows: itemtype → filas, tal como las devuelve
// GLPI (con "is_deleted": 1 las de la papelera). También sub-ítems
// ("Ticket/7/ITILFollowup"); uno sin filas responde vacío.
type Server struct {
	*httptest.Server
	AppToken  string
	UserToken string

	mu     sync.Mutex
	Rows   map[string][]map[string]any
	Fail   map[string]string // itemtype → código de error (403)
	Killed int
	Calls  []string
	// Searches: las consultas recibidas en search/<itemtype>.
	Searches []url.Values
	// WriteToken: el User-Token de escritura; solo su sesión puede escribir.
	WriteToken string
	// Posts: lo que se escribió (POST y PUT), en orden.
	Posts []Post
	// FailWrite: itemtype → estado HTTP con que falla la próxima escritura.
	FailWrite map[string]int
	nextID    int
	clock     int
}

// Post es una escritura recibida.
type Post struct {
	Method   string
	Itemtype string
	Input    map[string]any
}

// WriteUserID es el usuario de GLPI del token de escritura.
const WriteUserID = 77

// New arranca el GLPI falso. Ciérralo con Close.
func New(appToken, userToken string) *Server {
	s := &Server{AppToken: appToken, UserToken: userToken, Rows: map[string][]map[string]any{}, Fail: map[string]string{},
		FailWrite: map[string]int{}, nextID: 9000}
	s.Server = httptest.NewServer(http.HandlerFunc(s.serve))
	return s
}

// URL de la API, como la escribe el admin.
func (s *Server) APIURL() string { return s.Server.URL + "/apirest.php" }

// Set reemplaza las filas de un itemtype.
func (s *Server) Set(itemtype string, rows ...map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Rows[itemtype] = rows
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode([]string{code, msg})
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/apirest.php"), "/")
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Calls = append(s.Calls, r.Method+" "+path)
	if s.AppToken != "" && r.Header.Get("App-Token") != s.AppToken {
		writeErr(w, http.StatusBadRequest, "ERROR_WRONG_APP_TOKEN_PARAMETER", "parameter app_token seems wrong")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if path == "initSession" {
		auth := r.Header.Get("Authorization")
		switch {
		case auth == "user_token "+s.UserToken:
			_ = json.NewEncoder(w).Encode(map[string]string{"session_token": "sess-1"})
		case s.WriteToken != "" && auth == "user_token "+s.WriteToken:
			_ = json.NewEncoder(w).Encode(map[string]string{"session_token": "sess-w"})
		default:
			writeErr(w, http.StatusUnauthorized, "ERROR_GLPI_LOGIN_USER_TOKEN", "parameter user_token seems invalid")
		}
		return
	}
	session := r.Header.Get("Session-Token")
	if session != "sess-1" && session != "sess-w" {
		writeErr(w, http.StatusUnauthorized, "ERROR_SESSION_TOKEN_INVALID", "session_token seems invalid")
		return
	}
	if (r.Method == http.MethodPost || r.Method == http.MethodPut) && path != "changeActiveEntities" {
		s.write(w, r, path, session == "sess-w")
		return
	}
	switch path {
	case "killSession":
		s.Killed++
		_, _ = w.Write([]byte("true"))
		return
	case "changeActiveEntities":
		_, _ = w.Write([]byte("true"))
		return
	case "getFullSession":
		name, profile := "bitacora-lectura", "Observador"
		if session == "sess-w" {
			name, profile = "bitacora-escritura", "Técnico"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"glpiname": name, "glpiactiveprofile": map[string]any{"name": profile}}})
		return
	case "getMyEntities":
		_ = json.NewEncoder(w).Encode(map[string]any{"myentities": []map[string]any{{"id": 0}, {"id": 1}}})
		return
	case "getGlpiConfig":
		_ = json.NewEncoder(w).Encode(map[string]any{"cfg_glpi": map[string]any{"version": "11.0.1"}})
		return
	}
	if code, ok := s.Fail[path]; ok {
		writeErr(w, http.StatusForbidden, code, "You don't have permission to perform this action.")
		return
	}
	q := r.URL.Query()
	if itemtype, ok := strings.CutPrefix(path, "search/"); ok {
		s.search(w, itemtype, q)
		return
	}
	parts := strings.Split(path, "/")
	if len(parts) == 2 { // un ítem por su número
		for _, row := range s.Rows[parts[0]] {
			if fmt.Sprint(row["id"]) == parts[1] {
				_ = json.NewEncoder(w).Encode(row)
				return
			}
		}
		writeErr(w, http.StatusNotFound, "ERROR_ITEM_NOT_FOUND", "Item not found")
		return
	}
	rows, ok := s.Rows[path]
	if !ok && len(parts) != 3 && strings.Contains(path, "/") {
		writeErr(w, http.StatusNotFound, "ERROR_RESOURCE_NOT_FOUND_NOR_COMMONDBTM", "resource not found")
		return
	}
	deleted := q.Get("is_deleted") == "true"
	var list []map[string]any
	for _, row := range rows {
		if (fmt.Sprint(row["is_deleted"]) == "1") == deleted {
			list = append(list, row)
		}
	}
	start, end := 0, 49
	if rg := q.Get("range"); rg != "" {
		a, b, _ := strings.Cut(rg, "-")
		start, _ = strconv.Atoi(a)
		end, _ = strconv.Atoi(b)
	}
	total := len(list)
	if total > 0 && start >= total {
		writeErr(w, http.StatusBadRequest, "ERROR_RANGE_EXCEED_TOTAL", "Provided range exceed total count of data")
		return
	}
	if end >= total {
		end = total - 1
	}
	page := []map[string]any{}
	if total > 0 {
		page = list[start : end+1]
	}
	if q.Get("only_id") == "true" {
		ids := make([]map[string]any, 0, len(page))
		for _, row := range page {
			ids = append(ids, map[string]any{"id": row["id"]})
		}
		page = ids
	}
	w.Header().Set("Content-Range", fmt.Sprintf("%d-%d/%d", start, end, total))
	w.Header().Set("Accept-Range", path+" 990")
	if total > 0 && end < total-1 {
		w.WriteHeader(http.StatusPartialContent)
	}
	_ = json.NewEncoder(w).Encode(page)
}

// search imita search/<itemtype>: devuelve el número (opción 2) de las filas
// de ese itemtype, las de la papelera con is_deleted=1. Si la búsqueda pide
// «cambiados después de» (criteria[1][value]), compara con date_mod; las
// entidades no se filtran (la app las vuelve a revisar).
func (s *Server) search(w http.ResponseWriter, itemtype string, q url.Values) {
	s.Searches = append(s.Searches, q)
	deleted := q.Get("is_deleted") == "1"
	after := q.Get("criteria[1][value]")
	email := ""
	if itemtype == "User" && q.Get("criteria[0][field]") == "5" {
		email = q.Get("criteria[0][value]")
	}
	data := []map[string]any{}
	for _, row := range s.Rows[itemtype] {
		if (fmt.Sprint(row["is_deleted"]) == "1") != deleted {
			continue
		}
		if email != "" && !strings.EqualFold(fmt.Sprint(row["email"]), email) {
			continue
		}
		if after != "" && fmt.Sprint(row["date_mod"]) <= after {
			continue
		}
		data = append(data, map[string]any{"2": row["id"]})
	}
	total := len(data)
	start, end := 0, 49
	if rg := q.Get("range"); rg != "" {
		a, b, _ := strings.Cut(rg, "-")
		start, _ = strconv.Atoi(a)
		end, _ = strconv.Atoi(b)
	}
	if start >= total {
		data = []map[string]any{}
	} else {
		if end >= total {
			end = total - 1
		}
		data = data[start : end+1]
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"totalcount": total, "count": len(data), "data": data})
}

// write imita las altas (POST <itemtype>) y los cambios (PUT <itemtype>/<id>):
// solo la sesión del token de escritura; el resto responde ERROR_RIGHT_MISSING.
func (s *Server) write(w http.ResponseWriter, r *http.Request, path string, canWrite bool) {
	var body struct {
		Input map[string]any `json:"input"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	parts := strings.Split(path, "/")
	itemtype := parts[0]
	if !canWrite {
		writeErr(w, http.StatusForbidden, "ERROR_RIGHT_MISSING", "You don't have permission to perform this action.")
		return
	}
	if status, ok := s.FailWrite[itemtype]; ok {
		delete(s.FailWrite, itemtype)
		writeErr(w, status, "ERROR_GLPI_ADD", "No se pudo guardar")
		return
	}
	s.Posts = append(s.Posts, Post{Method: r.Method, Itemtype: itemtype, Input: body.Input})
	s.clock++
	stamp := fmt.Sprintf("2026-10-21 12:%02d:%02d", s.clock/60%60, s.clock%60)
	bump := func(ticketID string) {
		for _, row := range s.Rows["Ticket"] {
			if fmt.Sprint(row["id"]) == ticketID {
				row["date_mod"] = stamp
			}
		}
	}
	if r.Method == http.MethodPut {
		if len(parts) != 2 {
			writeErr(w, http.StatusBadRequest, "ERROR_BAD_ARRAY", "id requerido")
			return
		}
		for _, row := range s.Rows[itemtype] {
			if fmt.Sprint(row["id"]) == parts[1] {
				for k, v := range body.Input {
					row[k] = v
				}
				row["date_mod"] = stamp
				_ = json.NewEncoder(w).Encode([]map[string]any{{parts[1]: true, "message": ""}})
				return
			}
		}
		writeErr(w, http.StatusNotFound, "ERROR_ITEM_NOT_FOUND", "Item not found")
		return
	}
	s.nextID++
	id := s.nextID
	switch itemtype {
	case "ITILFollowup", "ITILSolution":
		ticket := fmt.Sprint(body.Input["items_id"])
		found := false
		for _, row := range s.Rows["Ticket"] {
			if fmt.Sprint(row["id"]) == ticket {
				found = true
			}
		}
		if !found {
			writeErr(w, http.StatusBadRequest, "ERROR_GLPI_ADD", "El ticket no existe")
			return
		}
		row := map[string]any{"id": id, "users_id": WriteUserID, "content": body.Input["content"], "is_private": body.Input["is_private"],
			"date": stamp, "date_creation": stamp}
		if itemtype == "ITILSolution" {
			row["status"] = 2
			for _, t := range s.Rows["Ticket"] {
				if fmt.Sprint(t["id"]) == ticket {
					t["status"] = 5
				}
			}
		}
		key := "Ticket/" + ticket + "/" + itemtype
		s.Rows[key] = append(s.Rows[key], row)
		bump(ticket)
	case "Ticket":
		row := map[string]any{"id": id, "status": 1, "date": stamp, "date_mod": stamp}
		for k, v := range body.Input {
			if !strings.HasPrefix(k, "_") {
				row[k] = v
			}
		}
		s.Rows["Ticket"] = append(s.Rows["Ticket"], row)
		if g := body.Input["_groups_id_assign"]; g != nil {
			s.Rows[fmt.Sprintf("Ticket/%d/Group_Ticket", id)] = []map[string]any{{"id": id, "groups_id": g, "type": 2}}
		}
		if u := body.Input["_users_id_requester"]; u != nil {
			s.Rows[fmt.Sprintf("Ticket/%d/Ticket_User", id)] = []map[string]any{{"id": id, "users_id": u, "type": 1}}
		}
	default:
		s.Rows[itemtype] = append(s.Rows[itemtype], map[string]any{"id": id})
	}
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "message": ""})
}
