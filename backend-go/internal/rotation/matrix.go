package rotation

import "sort"

// Condition refleja el ENUM telework_condition (03-esquema-db.sql).
type Condition string

const (
	ConditionTelework           Condition = "telework"
	ConditionOffice             Condition = "office"
	ConditionGuardia            Condition = "guardia"
	ConditionVacation           Condition = "vacation"
	ConditionMedicalLeave       Condition = "medical_leave"
	ConditionMedicalAppointment Condition = "medical_appointment"
	ConditionTraining           Condition = "training"
)

// ConditionMeta es la presentación de una condición en la matriz y en la
// página TV. El label/marker vienen portados de STATUS_META de
// ../BitacoraSOC-legacy/backend/src/utils/telework-matrix.js, pero el color
// NO: la paleta legacy quedó explícitamente descartada a favor de la paleta
// industrial semáforo (spec/02-alcance-y-roadmap.md sección 4, spec/06-
// frontend-arquitectura-y-ui.md sección 1.1) — acá se usan los mismos 5
// tokens `--status-*` que el resto del rewrite, no hex inventado ni
// heredado. `guardia` no tiene precedente legacy (el ENUM es nuevo de este
// rewrite, para poder reflejar en la misma grilla a alguien que está de
// guardia por el motor de rotación) — marcador, color y prioridad son una
// decisión propia de esta fase. Priority es informativo (ascendente = más
// relevante): el esquema ya garantiza una sola condición por usuario/día
// (UNIQUE(user_id, assigned_date)), así que no hay conflicto real que
// desempatar por celda, solo documenta el orden de relevancia igual que el
// DAY_PRIORITY legacy.
type ConditionMeta struct {
	Label    string
	Marker   string
	Color    string
	Priority int
}

var conditionMeta = map[Condition]ConditionMeta{
	ConditionMedicalLeave:       {Label: "Licencia Médica", Marker: "🩹", Color: "#da3633", Priority: 0}, // --status-critical
	ConditionVacation:           {Label: "Vacaciones", Marker: "🌴", Color: "#da3633", Priority: 0},      // --status-critical
	ConditionMedicalAppointment: {Label: "Trámite Médico", Marker: "🏥", Color: "#d29922", Priority: 1},  // --status-warning
	ConditionTraining:           {Label: "Capacitación", Marker: "🎓", Color: "#8957e5", Priority: 2},    // --status-system
	ConditionGuardia:            {Label: "Guardia", Marker: "🛡️", Color: "#1f6feb", Priority: 3},        // --status-carrier
	ConditionTelework:           {Label: "Teletrabajo", Marker: "🏠", Color: "#238636", Priority: 4},     // --status-ok
	ConditionOffice:             {Label: "En Oficina", Marker: "", Color: "#8b949e", Priority: 5},       // --text-secondary (neutro, sin novedad)
}

// Meta devuelve la presentación de una condición; una condición desconocida
// (o vacía, día sin asignación cargada) se trata como "office" — una celda
// nunca queda sin presentación.
func Meta(c Condition) ConditionMeta {
	if m, ok := conditionMeta[c]; ok {
		return m
	}
	return conditionMeta[ConditionOffice]
}

// RowInput es lo que el handler ya resolvió para un usuario de la matriz: su
// nombre y las condiciones que tuvo en la semana (a lo más una por día,
// gracias a la restricción UNIQUE del esquema).
type RowInput struct {
	Key        string
	Name       string
	Conditions []Condition
}

// HasSpecial dice si al menos un día de la semana no es "office" (o no tiene
// asignación cargada) — se usa para ordenar primero a quien tiene novedades,
// HU-4b.
func HasSpecial(conditions []Condition) bool {
	for _, c := range conditions {
		if c != ConditionOffice && c != "" {
			return true
		}
	}
	return false
}

// SortRows ordena la grilla: quienes tienen alguna novedad esta semana
// primero, después alfabético por nombre — mismo criterio que `computeRows`
// del legacy telework-matrix.js ("hasSpecial primero, luego nombre").
func SortRows(rows []RowInput) []RowInput {
	out := append([]RowInput(nil), rows...)
	sort.SliceStable(out, func(i, j int) bool {
		hi, hj := HasSpecial(out[i].Conditions), HasSpecial(out[j].Conditions)
		if hi != hj {
			return hi
		}
		return out[i].Name < out[j].Name
	})
	return out
}
