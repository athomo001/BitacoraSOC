//go:build integration

// Notificaciones (9.5) contra la base real, dentro de una transacción que se deshace.
//
//	BITACORA_TEST_DSN="postgres://bitacora:…@127.0.0.1:25432/bitacora?sslmode=disable" \
//	  go test -tags=integration ./internal/handler/ -run TestNotifications
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/middleware"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotifications_CampanaAvisosYAcuse(t *testing.T) {
	dsn := os.Getenv("BITACORA_TEST_DSN")
	if dsn == "" {
		t.Skip("BITACORA_TEST_DSN no definido")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // la transacción se deshace siempre
	q := db.New(tx)
	n := fmt.Sprintf("n%d", time.Now().UnixNano())
	id := func(sql string, args ...any) uuid.UUID {
		t.Helper()
		var out uuid.UUID
		if err := tx.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return out
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	const n1, n3 = "a0000000-0000-4000-8000-000000000101", "a0000000-0000-4000-8000-000000000103"
	area := id(`INSERT INTO areas (code, name) VALUES ($1, 'Infra '||$1) RETURNING id`, "inf"+n)
	person := func(level string, caps []string) uuid.UUID {
		g := id(`INSERT INTO permission_groups (code, name, capabilities, profile, level_id) VALUES ($1, $1, $2, 'resolutor', $3) RETURNING id`, "g"+uuid.NewString()[:8]+n, caps, level)
		id(`INSERT INTO permission_group_areas (permission_group_id, area_id) VALUES ($1, $2) RETURNING area_id`, g, area)
		u := id(`INSERT INTO users (username, email, password_hash) VALUES ($1, $1 || '@test.local', 'x') RETURNING id`, "u"+uuid.NewString()[:8]+n)
		id(`INSERT INTO user_permission_groups (user_id, permission_group_id) VALUES ($1, $2) RETURNING user_id`, u, g)
		return u
	}
	jefa := person(n3, []string{CapAreaLead})
	ana := person(n1, []string{})
	pedro := person(n1, []string{})
	exec(`DELETE FROM holidays; UPDATE agenda_tasks SET active = false; UPDATE agenda_settings SET work_days = '{1,2,3,4,5}', day_start = '08:00', day_end = '20:00', timezone = 'America/Santiago'`)
	exec(`UPDATE notification_settings SET digest_time = '08:00', locked_kinds = '{agenda.late,notice}', group_minutes = 15, last_digest_day = NULL`)

	loc, _ := time.LoadLocation("America/Santiago")
	now := time.Date(2026, 10, 14, 15, 0, 0, 0, loc) // miércoles
	log := audit.NewLogger(&recordedAudit{}, slog.Default())
	notify := &Notifier{Queries: q, AuditLog: log, Now: func() time.Time { return now }}
	ag := &AgendaHandler{Queries: q, AuditLog: log, Notify: notify, Now: func() time.Time { return now }}
	nh := &NotificationsHandler{Queries: q, AuditLog: log, Notify: notify}
	call := func(user uuid.UUID, fn func(http.ResponseWriter, *http.Request), method, path string, body any, pathID string) *httptest.ResponseRecorder {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			_ = json.NewEncoder(&buf).Encode(body)
		}
		r := httptest.NewRequest(method, path, &buf).WithContext(middleware.WithUser(ctx, middleware.AuthenticatedUser{ID: user, Username: "x", Role: "user"}))
		if pathID != "" {
			r.SetPathValue("id", pathID)
		}
		w := httptest.NewRecorder()
		fn(w, r)
		return w
	}
	bell := func(user uuid.UUID) []notificationDTO {
		t.Helper()
		var out struct {
			Data struct{ Items []notificationDTO }
		}
		w := call(user, nh.List, "GET", "/api/notifications?filter=all", nil, "")
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return out.Data.Items
	}
	find := func(list []notificationDTO, kind string) *notificationDTO {
		for i := range list {
			if list[i].Kind == kind {
				return &list[i]
			}
		}
		return nil
	}

	// Pedro apaga el emergente de «te asignaron»; Ana no.
	if w := call(pedro, nh.PutPrefs, "PUT", "/x", map[string]any{"kinds": map[string]any{NotifAgendaAssigned: map[string]bool{"toast": false}}, "digest": true}, ""); w.Code != 200 {
		t.Fatalf("preferencias: %d %s", w.Code, w.Body)
	}
	// Tampoco se puede apagar el atraso (lo fija el admin).
	w := call(pedro, nh.GetPrefs, "GET", "/x", nil, "")
	if !strings.Contains(w.Body.String(), `"kind":"agenda.late","toast":true,"email":true,"emailAllowed":true,"toastAllowed":true,"locked":true`) {
		t.Fatalf("el atraso debe quedar fijo: %s", w.Body)
	}

	// La jefa asigna a N1 una tarea para hoy con aviso del mismo día.
	w = call(jefa, ag.CreateTask, "POST", "/api/agenda/tasks", map[string]any{"name": "Respaldo " + n, "areaId": area, "assigneeKind": "level", "assigneeId": n1,
		"recurrence": map[string]any{"kind": "once", "date": "2026-10-14"}, "warnDays": []int{0}}, "")
	if w.Code != 201 {
		t.Fatalf("crear tarea: %d %s", w.Code, w.Body)
	}
	a := find(bell(ana), NotifAgendaAssigned)
	p := find(bell(pedro), NotifAgendaAssigned)
	if a == nil || p == nil || !a.Toast || p.Toast || !strings.Contains(a.Title, "N1") {
		t.Fatalf("asignación al nivel: ana %+v · pedro %+v", a, p)
	}
	if find(bell(jefa), NotifAgendaAssigned) != nil {
		t.Fatal("quien asigna no se avisa a sí mismo")
	}

	// «Vence hoy» sale una vez (en horario hábil) y se agrupa con otro igual.
	if err := ag.Alerts(ctx); err != nil {
		t.Fatal(err)
	}
	if err := ag.Alerts(ctx); err != nil {
		t.Fatal(err)
	}
	notify.Send(ctx, []uuid.UUID{ana}, NotifMsg{Kind: NotifAgendaDue, Title: "Vence hoy: otra", GroupKey: "agenda.due:2026-10-14",
		GroupTitle: func(c int) string { return fmt.Sprintf("%d tareas vencen hoy", c) }})
	due := find(bell(ana), NotifAgendaDue)
	if due == nil || due.Count != 2 || due.Title != "2 tareas vencen hoy" {
		t.Fatalf("vence hoy agrupado: %+v", due)
	}

	// A las 21:00 está atrasada: se avisa una sola vez.
	now = time.Date(2026, 10, 14, 21, 0, 0, 0, loc)
	_ = ag.Alerts(ctx)
	_ = ag.Alerts(ctx)
	late := 0
	for _, x := range bell(ana) {
		if x.Kind == NotifAgendaLate {
			late++
		}
	}
	if late != 1 {
		t.Fatalf("atraso avisado %d veces", late)
	}

	// Marcar todas leídas.
	w = call(ana, nh.Read, "POST", "/x", map[string]any{}, "")
	if !strings.Contains(w.Body.String(), `"unread":0`) {
		t.Fatalf("leídas: %s", w.Body)
	}

	// Aviso con acuse: Ana no puede enviarlo; la jefa sí (por ser jefatura).
	notice := map[string]any{"title": "Cambio de procedimiento " + n, "body": "Desde el **lunes**…", "audience": map[string]any{"kind": "level", "areaIds": []uuid.UUID{area}, "levelIds": []string{n1}}}
	if w := call(ana, nh.CreateNotice, "POST", "/x", notice, ""); w.Code != 403 {
		t.Fatalf("Ana sin permiso: %d", w.Code)
	}
	if w := call(jefa, nh.CreateNotice, "POST", "/x", notice, ""); w.Code != 201 || !strings.Contains(w.Body.String(), `"total":2,"read":0`) {
		t.Fatalf("crear aviso: %d %s", w.Code, w.Body)
	}
	var pending struct{ Data []pendingNoticeDTO }
	w = call(pedro, nh.Pending, "GET", "/x", nil, "")
	_ = json.Unmarshal(w.Body.Bytes(), &pending)
	if len(pending.Data) != 1 {
		t.Fatalf("pendientes de Pedro: %s", w.Body)
	}
	if w := call(pedro, nh.ReadNotice, "POST", "/x", nil, pending.Data[0].ID.String()); w.Code != 204 {
		t.Fatalf("leído: %d", w.Code)
	}
	w = call(jefa, nh.Sent, "GET", "/x", nil, "")
	if !strings.Contains(w.Body.String(), `"total":2,"read":1`) {
		t.Fatalf("avance: %s", w.Body)
	}
	w = call(jefa, nh.Recipients, "GET", "/x", nil, pending.Data[0].ID.String())
	if !strings.Contains(w.Body.String(), `"readAt"`) {
		t.Fatalf("quién leyó: %s", w.Body)
	}

	// Ventana de mantenimiento del área que ya empezó: se avisa a la gente del área.
	exec(`INSERT INTO maintenance_windows (area_id, title, starts_at, ends_at, created_by) VALUES ($1, 'Parches '||$2, now() - interval '5 minutes', now() + interval '2 hours', $3)`, area, n, jefa)
	if err := notify.Windows(ctx); err != nil {
		t.Fatal(err)
	}
	if x := find(bell(pedro), NotifWindow); x == nil || !strings.Contains(x.Title, "Empieza la ventana") {
		t.Fatalf("aviso de ventana: %+v", x)
	}

	// Resumen diario: el día se marca una sola vez.
	now = time.Date(2026, 10, 15, 8, 30, 0, 0, loc)
	if err := ag.Digest(ctx); err != nil {
		t.Fatal(err)
	}
	var day time.Time
	if err := tx.QueryRow(ctx, `SELECT last_digest_day FROM notification_settings`).Scan(&day); err != nil || day.Format("2006-01-02") != "2026-10-15" {
		t.Fatalf("día del resumen: %v %v", day, err)
	}
	if n, _ := q.ClaimDigestDay(ctx, pgDate(day)); n != 0 {
		t.Fatal("el resumen del día no se repite")
	}
}
