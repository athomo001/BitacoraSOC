// Package glpitest es un GLPI falso (API clásica, apirest.php) para las
// pruebas: sesión con App-Token + User-Token, listas paginadas con
// Content-Range, papelera (is_deleted) y errores con el formato de GLPI.
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
}

// New arranca el GLPI falso. Ciérralo con Close.
func New(appToken, userToken string) *Server {
	s := &Server{AppToken: appToken, UserToken: userToken, Rows: map[string][]map[string]any{}, Fail: map[string]string{}}
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
		if r.Header.Get("Authorization") != "user_token "+s.UserToken {
			writeErr(w, http.StatusUnauthorized, "ERROR_GLPI_LOGIN_USER_TOKEN", "parameter user_token seems invalid")
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"session_token": "sess-1"})
		return
	}
	if r.Header.Get("Session-Token") != "sess-1" {
		writeErr(w, http.StatusUnauthorized, "ERROR_SESSION_TOKEN_INVALID", "session_token seems invalid")
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
		_ = json.NewEncoder(w).Encode(map[string]any{"session": map[string]any{"glpiname": "bitacora-lectura"}})
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
	data := []map[string]any{}
	for _, row := range s.Rows[itemtype] {
		if (fmt.Sprint(row["is_deleted"]) == "1") != deleted {
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
