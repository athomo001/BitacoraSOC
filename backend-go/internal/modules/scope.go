// Package modules resuelve la modularidad SOC/NOC (spec/01-arquitectura.md
// sección 5, HU-0/0b/PERM-2): qué módulo de dominio está activo en la
// instancia (el `active` de las áreas SOC y NOC, 000033) y qué parte de eso
// ve cada usuario según las áreas de sus permission_groups. Puro, sin DB — lo usan tanto
// GET /api/users/me/capabilities como el middleware RequireModule, para que
// "lo que el frontend muestra" y "lo que el backend deja pasar" salgan de
// la misma regla y no puedan divergir.
package modules

// Module es un módulo de dominio gateable.
type Module string

const (
	SOC Module = "soc"
	NOC Module = "noc"
)

// Flags es el estado de la instancia: si las áreas SOC y NOC están activas.
type Flags struct {
	SOC bool
	NOC bool
}

// FlagsFromAreas arma Flags a partir de las áreas activas, por código.
func FlagsFromAreas(active map[string]bool) Flags {
	return Flags{SOC: active[string(SOC)], NOC: active[string(NOC)]}
}

// Enabled dice si el módulo está activo a nivel de instancia.
func (f Flags) Enabled(m Module) bool {
	switch m {
	case SOC:
		return f.SOC
	case NOC:
		return f.NOC
	}
	return false
}

// Scope es el alcance efectivo de un usuario, ya cruzado con Flags.
type Scope string

const (
	ScopeNone Scope = "none"
	ScopeSOC  Scope = "soc"
	ScopeNOC  Scope = "noc"
	ScopeBoth Scope = "both"
)

// Includes dice si el alcance cubre el módulo.
func (s Scope) Includes(m Module) bool {
	return s == ScopeBoth || string(s) == string(m)
}

// EffectiveScope une las áreas de todos los grupos del usuario (sus
// códigos: "soc", "noc", "ti"…) y lo recorta por lo que la instancia tiene
// activo. Solo SOC y NOC son módulos de dominio: las demás áreas no abren
// la bitácora ni el escalamiento. admin no pasa por acá — siempre tiene
// acceso completo a lo que la instancia tenga activo (ver HU-PERM-1).
func EffectiveScope(instance Flags, areaCodes []string) Scope {
	hasSOC, hasNOC := false, false
	for _, s := range areaCodes {
		switch s {
		case string(SOC):
			hasSOC = true
		case string(NOC):
			hasNOC = true
		}
	}
	hasSOC = hasSOC && instance.SOC
	hasNOC = hasNOC && instance.NOC

	switch {
	case hasSOC && hasNOC:
		return ScopeBoth
	case hasSOC:
		return ScopeSOC
	case hasNOC:
		return ScopeNOC
	}
	return ScopeNone
}
