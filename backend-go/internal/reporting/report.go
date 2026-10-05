package reporting

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/mailtpl"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Recipients limpia la lista de destinatarios configurada en el turno:
// sin vacíos ni duplicados (sin distinguir mayúsculas).
func Recipients(configured []string) []string {
	seen := make(map[string]bool, len(configured))
	out := make([]string, 0, len(configured))
	for _, raw := range configured {
		address := strings.TrimSpace(raw)
		key := strings.ToLower(address)
		if address == "" || seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, address)
	}
	return out
}

// Brand es lo que el correo toma de la marca de la app (título y favicon).
type Brand struct{ AppTitle, FaviconURL string }

// ShiftMail es el "Reporte de Turno" listo para enviar.
type ShiftMail struct{ Subject, HTML string }

// BuildShiftMail junta los datos del cierre como loadShiftReportData del
// legacy: el checklist de cierre, el de inicio más reciente del mismo turno
// dentro de la ventana, y las entradas entre ambos.
func BuildShiftMail(ctx context.Context, q *db.Queries, closure db.ShiftClosure, shift db.WorkShift, brand Brand) (ShiftMail, error) {
	loc, err := time.LoadLocation(shift.Timezone)
	if err != nil {
		loc, _ = time.LoadLocation("America/Santiago")
	}
	exitCheck, err := q.GetShiftCheckForReport(ctx, closure.ClosureCheckID)
	if err != nil {
		return ShiftMail{}, fmt.Errorf("no se pudo cargar el checklist de cierre: %w", err)
	}
	exit, err := loadChecklist(ctx, q, exitCheck.ID, exitCheck.ChecklistTemplateID, exitCheck.TemplateName, exitCheck.CheckDate.Time)
	if err != nil {
		return ShiftMail{}, err
	}
	periodStart, periodEnd := closure.ShiftStartAt.Time, exitCheck.CheckDate.Time
	var entry *mailtpl.ShiftChecklist
	startCheck, err := q.GetLatestStartCheckInWindow(ctx, db.GetLatestStartCheckInWindowParams{
		WorkShiftID: shift.ID, CheckDate: closure.ShiftStartAt, CheckDate_2: exitCheck.CheckDate,
	})
	if err == nil {
		if entry, err = loadChecklist(ctx, q, startCheck.ID, startCheck.ChecklistTemplateID, startCheck.TemplateName, startCheck.CheckDate.Time); err != nil {
			return ShiftMail{}, err
		}
		periodStart = startCheck.CheckDate.Time
	}
	rows, err := q.ListEntriesForShiftReport(ctx, db.ListEntriesForShiftReportParams{
		CreatedAt: pgtype.Timestamptz{Time: periodStart, Valid: true}, CreatedAt_2: pgtype.Timestamptz{Time: periodEnd, Valid: true},
	})
	if err != nil {
		return ShiftMail{}, fmt.Errorf("no se pudieron cargar las entradas del turno: %w", err)
	}
	entries := make([]mailtpl.ShiftEntry, 0, len(rows))
	for _, r := range rows {
		entries = append(entries, mailtpl.ShiftEntry{
			EntryType: r.EntryType, Content: r.Content, ClientName: r.ClientName, CreatedAt: r.CreatedAt.Time,
			Time: r.CreatedAt.Time.In(loc).Format("15:04"),
		})
	}
	startTime, endTime := clock(shift.StartTime), clock(shift.EndTime)
	html, err := mailtpl.RenderShiftReport(mailtpl.ShiftReportOptions{
		ShiftName: shift.Name, StartTime: startTime, EndTime: endTime,
		IncludeChecklist: shift.EmailIncludeChecklist, IncludeEntries: shift.EmailIncludeEntries,
		Entry: entry, Exit: exit, Entries: entries,
		PeriodStart: &periodStart, PeriodEnd: &periodEnd,
		AppTitle: brand.AppTitle, FaviconURL: brand.FaviconURL, Location: loc,
	})
	if err != nil {
		return ShiftMail{}, err
	}
	subject := mailtpl.ShiftReportSubject(shift.EmailSubjectTemplate, brand.AppTitle, periodEnd.In(loc).Format("02-01-2006"), shift.Name, endTime)
	return ShiftMail{Subject: subject, HTML: html}, nil
}

func loadChecklist(ctx context.Context, q *db.Queries, checkID, templateID uuid.UUID, templateName string, at time.Time) (*mailtpl.ShiftChecklist, error) {
	services, err := q.ListShiftCheckServicesForReport(ctx, checkID)
	if err != nil {
		return nil, fmt.Errorf("no se pudieron cargar los servicios del checklist: %w", err)
	}
	out := &mailtpl.ShiftChecklist{CreatedAt: at, ChecklistID: templateID.String(), ChecklistName: templateName}
	for _, s := range services {
		out.Services = append(out.Services, mailtpl.ShiftService{
			ServiceID: uuidText(s.ChecklistItemID), Title: s.ServiceTitle, Status: s.Status,
			Observation: s.Observation, ParentID: uuidText(s.ParentItemID),
		})
	}
	return out, nil
}

func uuidText(v pgtype.UUID) string {
	if !v.Valid {
		return ""
	}
	return uuid.UUID(v.Bytes).String()
}

// clock deja una hora del día como "HH:MM" (startTime/endTime del legacy).
func clock(t pgtype.Time) string {
	minutes := t.Microseconds / 60_000_000
	return fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
}
