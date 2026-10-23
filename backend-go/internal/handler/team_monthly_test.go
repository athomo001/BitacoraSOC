package handler

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/agenda"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/quality"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestComputeMonthly(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	ana, beto, ida := uuid.New(), uuid.New(), uuid.New()
	day := func(s string) pgtype.Date { d, _ := agenda.ParseDate(s); return pgtype.Date{Time: d, Valid: true} }
	at := func(y int, m time.Month, d, h int) pgtype.Timestamptz {
		return pgtype.Timestamptz{Time: time.Date(y, m, d, h, 0, 0, 0, loc), Valid: true}
	}
	occ := func(user uuid.UUID, status, due string, closed pgtype.Timestamptz) db.ListMonthOccurrencesRow {
		r := db.ListMonthOccurrencesRow{ID: uuid.New(), Status: status, DueDate: day(due), ClosedAt: closed}
		if user != uuid.Nil {
			r.UserID = pgUUIDOf(user)
		}
		return r
	}
	none := pgtype.Timestamptz{}
	in := monthlyInput{
		month: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), loc: loc, dayEnd: agenda.Clock{Hour: 20}, cal: agenda.DefaultCalendar(),
		now:    time.Date(2026, 10, 5, 9, 0, 0, 0, loc), // el mes ya cerró
		people: []monthlyPersonDTO{{ID: ana, Name: "Ana", Level: "N1"}, {ID: beto, Name: "Beto", Level: "N2"}},
		names:  map[uuid.UUID]string{ida: "Ida (ya no está en el área)"},
		occs: []db.ListMonthOccurrencesRow{
			occ(ana, "done", "2026-09-10", at(2026, 9, 10, 19)), // a tiempo (antes de las 20:00)
			occ(ana, "done", "2026-09-11", at(2026, 9, 14, 9)),  // hecha tarde
			occ(ana, "skipped", "2026-09-15", at(2026, 9, 15, 9)),
			occ(beto, "pending", "2026-09-22", none),             // quedó abierta y atrasada
			occ(beto, "done", "2026-09-29", at(2026, 10, 2, 10)), // se cerró después del mes: cuenta como abierta
			occ(uuid.Nil, "pending", "2026-09-30", none),         // nadie la tomó: solo en el total
			occ(ida, "done", "2026-09-03", at(2026, 9, 3, 12)),
		},
		tickets: []db.ListMonthResolvedTicketsRow{
			{AssignedUserID: pgUUIDOf(ana), ResolvedAt: at(2026, 9, 5, 10), SlaDueAt: at(2026, 9, 5, 12)},
			{AssignedUserID: pgUUIDOf(ana), ResolvedAt: at(2026, 9, 6, 10), SlaDueAt: at(2026, 9, 6, 8)},
			{AssignedUserID: pgUUIDOf(beto), ResolvedAt: at(2026, 9, 7, 10)}, // sin SLA: dentro
		},
		absences: map[uuid.UUID]int{beto: 2},
		areaCode: "INF", areaName: "Infraestructura",
	}
	d := computeMonthly(in)
	by := map[uuid.UUID]monthlyPersonDTO{}
	for _, p := range d.People {
		by[p.ID] = p
	}
	a, b := by[ana], by[beto]
	if a.Tasks != 3 || a.OnTime != 1 || a.DoneLate != 1 || a.Skipped != 1 || a.onTimePct() != 50 {
		t.Errorf("Ana: %+v", a)
	}
	if a.Tickets != 2 || a.TicketsSLA != 1 || a.slaPct() != 50 {
		t.Errorf("Ana tickets: %+v", a)
	}
	if b.Tasks != 2 || b.OpenLate != 2 || b.onTimePct() != 0 || b.AbsentDays != 2 || b.slaPct() != 100 {
		t.Errorf("Beto: %+v", b)
	}
	if by[ida].Name != "Ida (ya no está en el área)" || by[ida].OnTime != 1 {
		t.Errorf("Ida: %+v", by[ida])
	}
	if d.Total.Tasks != 7 || d.Total.OpenLate != 3 || d.Total.OnTime != 2 {
		t.Errorf("total: %+v", d.Total)
	}
	if d.BizDays != 22 {
		t.Errorf("días hábiles de septiembre 2026 sin feriados: %d", d.BizDays)
	}
}

func TestFreezeAt_PrimerDiaHabil(t *testing.T) {
	loc, _ := time.LoadLocation("America/Santiago")
	cal := agenda.DefaultCalendar()
	cal.Holidays["2026-11-02"] = "feriado de prueba"
	ac := agendaCal{cal: cal, loc: loc, start: agenda.Clock{Hour: 8}}
	// Octubre 2026: el 1 de noviembre es domingo y el 2 es feriado → martes 3 a las 08:00.
	got := freezeAt(time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), ac)
	if got.In(loc).Format("2006-01-02 15:04") != "2026-11-03 08:00" {
		t.Fatalf("congela %v", got.In(loc))
	}
}

func TestComputeMonthly_MetasCumplidas(t *testing.T) {
	ana, otra := uuid.New(), uuid.New()
	in := monthlyInput{month: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), loc: time.UTC, dayEnd: agenda.Clock{Hour: 20}, cal: agenda.DefaultCalendar(),
		now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC), people: []monthlyPersonDTO{{ID: ana, Name: "Ana"}}, names: map[uuid.UUID]string{},
		absences: map[uuid.UUID]int{}, goals: map[uuid.UUID]int{ana: 2, otra: 5}, areaName: "SOC"}
	d := computeMonthly(in)
	if len(d.People) != 1 || d.People[0].GoalsDone != 2 || d.Total.GoalsDone != 2 {
		t.Fatalf("las metas de alguien de otra área no suman: %+v %+v", d.People, d.Total)
	}
}

// 10f: las entradas y la calidad del mes por persona; el total suma las
// entradas y promedia los puntajes de quienes se evaluaron.
func TestComputeMonthly_Bitacora(t *testing.T) {
	ana, beto, ida := uuid.New(), uuid.New(), uuid.New()
	in := monthlyInput{
		month: time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC), loc: time.UTC, cal: agenda.DefaultCalendar(), now: time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC),
		people: []monthlyPersonDTO{{ID: ana, Name: "Ana"}, {ID: beto, Name: "Beto"}, {ID: ida, Name: "Ida"}},
		quality: map[uuid.UUID]quality.Result{
			ana:  {Entries: 40, Evaluated: true, Score: 80},
			beto: {Entries: 30, Evaluated: true, Score: 61},
			ida:  {Entries: 4},
		},
		areaName: "SOC",
	}
	d := computeMonthly(in)
	got := map[string][2]int{}
	for _, p := range d.People {
		got[p.Name] = [2]int{p.Entries, p.Quality}
	}
	if got["Ana"] != [2]int{40, 80} || got["Beto"] != [2]int{30, 61} || got["Ida"] != [2]int{4, -1} {
		t.Fatalf("por persona: %v", got)
	}
	if d.Total.Entries != 74 || d.Total.Quality != 71 || d.Version != monthlyVersion {
		t.Fatalf("total: %+v", d.Total)
	}
	// Sin Bitácora (área que no la usa): sin puntajes.
	in.quality = nil
	if d := computeMonthly(in); d.Total.Quality != -1 || d.People[0].Quality != -1 || d.Total.Entries != 0 {
		t.Fatalf("sin Bitácora: %+v", d.Total)
	}
}
