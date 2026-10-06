package handler

import (
	"strings"
	"testing"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

func ptr[T any](v T) *T { return &v }

func TestShiftReminderInputMerge(t *testing.T) {
	base := func() db.ShiftReminder {
		return db.ShiftReminder{Label: "Cierre", ReminderText: "Completa el checklist", FrequencyType: "hours", IntervalHours: 4, Enabled: true}
	}

	r := base()
	in := shiftReminderInput{FrequencyType: ptr("fixed"), FixedTimes: ptr([]string{"19:30", " 07:30", "19:30"})}
	if reason := in.merge(&r); reason != "" {
		t.Fatalf("válido rechazado: %s", reason)
	}
	if strings.Join(r.FixedTimes, ",") != "07:30,19:30" {
		t.Fatalf("horas sin limpiar/ordenar: %v", r.FixedTimes)
	}
	if r.TargetShiftIds == nil {
		t.Fatal("targetShiftIds debe quedar como lista vacía, no nil")
	}

	bad := []shiftReminderInput{
		{Label: ptr("  ")},
		{ReminderText: ptr("")},
		{FrequencyType: ptr("weekly")},
		{IntervalHours: ptr[int32](0)},
		{IntervalHours: ptr[int32](25)},
		{FrequencyType: ptr("fixed")}, // sin horas
		{FrequencyType: ptr("fixed"), FixedTimes: ptr([]string{"24:00"})},
		{Label: ptr(strings.Repeat("x", 151))},
	}
	for i, in := range bad {
		r := base()
		if reason := in.merge(&r); reason == "" {
			t.Errorf("caso %d debería rechazarse: %+v", i, in)
		}
	}
}

func TestReminderMailEscapesText(t *testing.T) {
	m := reminderMail("Bitácora Ops", db.ShiftReminder{Label: "Colas <phishing>", ReminderText: "Línea 1\r\n\r\n<script>x</script>"})
	subject, body := m.Subject, m.HTML
	if subject != "[Bitácora Ops] Colas <phishing>" {
		t.Fatalf("asunto: %q", subject)
	}
	if strings.Contains(body, "<script>") || !strings.Contains(body, "&lt;script&gt;") {
		t.Fatalf("el texto del admin debe ir escapado: %s", body)
	}
}
