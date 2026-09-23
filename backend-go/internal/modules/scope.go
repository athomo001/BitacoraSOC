// Package modules resuelve la modularidad SOC/NOC (spec/01-arquitectura.md
// sección 5, HU-0/0b/PERM-2): qué módulo de dominio está activo en la
// instancia (app_config.soc/noc_module_enabled) y qué parte de eso ve cada
// usuario según sus permission_groups. Puro, sin DB — lo usan tanto
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

// Flags es el estado de la instancia (app_config).
type Flags struct {
	SOC bool
	NOC bool
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

// EffectiveScope une los module_scope de todos los grupos del usuario
// (soc/noc/both/none) y lo recorta por lo que la instancia tiene activo.
// admin no pasa por acá — siempre tiene acceso completo a lo que la
// instancia tenga activo (ver HU-PERM-1).
func EffectiveScope(instance Flags, groupScopes []string) Scope {
	hasSOC, hasNOC := false, false
	for _, s := range groupScopes {
		switch s {
		case "soc":
			hasSOC = true
		case "noc":
			hasNOC = true
		case "both":
			hasSOC, hasNOC = true, true
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
