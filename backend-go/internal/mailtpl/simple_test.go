package mailtpl

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readGolden(t *testing.T, jsonPath string, into any) string {
	t.Helper()
	raw, err := os.ReadFile(jsonPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(strings.TrimSuffix(jsonPath, ".json") + ".html")
	if err != nil {
		t.Fatal(err)
	}
	return string(want)
}

func sameAsLegacy(t *testing.T, got, want string) {
	t.Helper()
	if got == want {
		return
	}
	i := 0
	for i < len(got) && i < len(want) && got[i] == want[i] {
		i++
	}
	lo := max(0, i-120)
	t.Fatalf("difiere del legacy en el byte %d:\n2.0:    %q\nlegacy: %q", i, got[lo:min(len(got), i+120)], want[lo:min(len(want), i+120)])
}

// TestPasswordRecoveryMatchesLegacy: mismo correo que buildPasswordRecoveryEmail.
func TestPasswordRecoveryMatchesLegacy(t *testing.T) {
	files, _ := filepath.Glob("testdata/password/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			var c struct{ ResetURL, AppTitle, Subject, Text string }
			want := readGolden(t, f, &c)
			got := PasswordRecovery(c.ResetURL, c.AppTitle)
			sameAsLegacy(t, got.HTML, want)
			if got.Subject != c.Subject || got.Text != c.Text {
				t.Fatalf("asunto o texto distinto: %q / %q", got.Subject, got.Text)
			}
		})
	}
}

// TestShiftReminderMatchesLegacy: mismo correo que buildReminderHtml.
func TestShiftReminderMatchesLegacy(t *testing.T) {
	files, _ := filepath.Glob("testdata/reminder/*.json")
	if len(files) == 0 {
		t.Fatal("faltan los casos de referencia")
	}
	for _, f := range files {
		t.Run(filepath.Base(f), func(t *testing.T) {
			var c struct{ AppTitle, ReminderText string }
			want := readGolden(t, f, &c)
			sameAsLegacy(t, ShiftReminder(c.AppTitle, "Revisión", c.ReminderText).HTML, want)
		})
	}
}

func TestBrandedSubject(t *testing.T) {
	for _, c := range [][3]string{{"Bitácora CDC", "Recordatorio", "[Bitácora CDC] Recordatorio"}, {" ", "Recordatorio", "Recordatorio"}, {"Bitácora CDC", "", "Bitácora CDC"}} {
		if got := BrandedSubject(c[0], c[1]); got != c[2] {
			t.Fatalf("%q", got)
		}
	}
}
