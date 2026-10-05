package mailtpl

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type shiftCaseService struct {
	ServiceID       string  `json:"serviceId"`
	ServiceTitle    string  `json:"serviceTitle"`
	Status          string  `json:"status"`
	Observation     string  `json:"observation"`
	ParentServiceID *string `json:"parentServiceId"`
}

type shiftCaseChecklist struct {
	CreatedAt   time.Time          `json:"createdAt"`
	ChecklistID string             `json:"checklistId"`
	Services    []shiftCaseService `json:"services"`
}

type shiftCase struct {
	Shift struct {
		Name              string `json:"name"`
		StartTime         string `json:"startTime"`
		EndTime           string `json:"endTime"`
		EmailReportConfig struct {
			IncludeChecklist bool `json:"includeChecklist"`
			IncludeEntries   bool `json:"includeEntries"`
		} `json:"emailReportConfig"`
	} `json:"shift"`
	ChecklistEntry *shiftCaseChecklist `json:"checklistEntry"`
	ChecklistExit  *shiftCaseChecklist `json:"checklistExit"`
	Entries        []struct {
		EntryType  string    `json:"entryType"`
		Content    string    `json:"content"`
		CreatedAt  time.Time `json:"createdAt"`
		ClientName string    `json:"clientName"`
	} `json:"entries"`
	PeriodStart *time.Time `json:"periodStart"`
	PeriodEnd   *time.Time `json:"periodEnd"`
	AppTitle    string     `json:"appTitle"`
	FaviconURL  string     `json:"faviconUrl"`
}

func (c *shiftCaseChecklist) toChecklist() *ShiftChecklist {
	if c == nil {
		return nil
	}
	out := &ShiftChecklist{CreatedAt: c.CreatedAt, ChecklistID: c.ChecklistID}
	for _, s := range c.Services {
		parent := ""
		if s.ParentServiceID != nil {
			parent = *s.ParentServiceID
		}
		out.Services = append(out.Services, ShiftService{ServiceID: s.ServiceID, Title: s.ServiceTitle, Status: s.Status, Observation: s.Observation, ParentID: parent})
	}
	return out
}

// TestShiftReportMatchesLegacy: el Reporte de Turno es el mismo HTML que arma
// generateReportHTML del legacy (testdata/shift, hecho con su código).
func TestShiftReportMatchesLegacy(t *testing.T) {
	loc, err := time.LoadLocation("America/Santiago")
	if err != nil {
		t.Skip("sin zona horaria America/Santiago:", err)
	}
	files, _ := filepath.Glob("testdata/shift/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".json")
		t.Run(name, func(t *testing.T) {
			raw, _ := os.ReadFile(f)
			var c shiftCase
			if err := json.Unmarshal(raw, &c); err != nil {
				t.Fatal(err)
			}
			opts := ShiftReportOptions{
				ShiftName: c.Shift.Name, StartTime: c.Shift.StartTime, EndTime: c.Shift.EndTime,
				IncludeChecklist: c.Shift.EmailReportConfig.IncludeChecklist, IncludeEntries: c.Shift.EmailReportConfig.IncludeEntries,
				Entry: c.ChecklistEntry.toChecklist(), Exit: c.ChecklistExit.toChecklist(),
				PeriodStart: c.PeriodStart, PeriodEnd: c.PeriodEnd, AppTitle: c.AppTitle, FaviconURL: c.FaviconURL, Location: loc,
			}
			for _, e := range c.Entries {
				opts.Entries = append(opts.Entries, ShiftEntry{EntryType: e.EntryType, Content: e.Content, CreatedAt: e.CreatedAt, ClientName: e.ClientName})
			}
			got, err := RenderShiftReport(opts)
			if err != nil {
				t.Fatal(err)
			}
			want, _ := os.ReadFile(strings.TrimSuffix(f, ".json") + ".html")
			if got != string(want) {
				i := 0
				for i < len(got) && i < len(want) && got[i] == want[i] {
					i++
				}
				lo := max(0, i-160)
				t.Fatalf("difiere del legacy en el byte %d:\n2.0:    %q\nlegacy: %q", i, got[lo:min(len(got), i+160)], string(want[lo:min(len(want), i+160)]))
			}
		})
	}
}

func TestShiftReportSubject(t *testing.T) {
	got := ShiftReportSubject("Reporte CDC [FECHA] [turno]", "Bitácora CDC", "03-10-2026", "Turno A", "18:20")
	if got != "[Bitácora CDC] Reporte CDC 03-10-2026 Turno A" {
		t.Fatalf("asunto: %q", got)
	}
}
