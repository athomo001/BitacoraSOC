package tickets

import (
	"fmt"
	"strings"
	"time"
)

// Numeración configurable (Administración → Ticketera; pedido del dueño
// 2026-10-16): prefijo, año opcional y dígitos, separados por guion.
//
//	TKT + yyyy + 5 → TKT-2026-00042
//	INF + none + 6 → INF-000042
//	SOC + yy   + 4 → SOC-26-0042
//
// Si el correlativo ya no cabe en los dígitos, crece (nunca se corta).
func FormatNumber(prefix, yearFormat string, digits int, n int64, now time.Time) string {
	parts := []string{prefix}
	switch yearFormat {
	case "yyyy":
		parts = append(parts, fmt.Sprintf("%04d", now.Year()))
	case "yy":
		parts = append(parts, fmt.Sprintf("%02d", now.Year()%100))
	}
	parts = append(parts, fmt.Sprintf("%0*d", digits, n))
	return strings.Join(parts, "-")
}
