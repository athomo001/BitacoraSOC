package modules

import "testing"

func TestEffectiveScope(t *testing.T) {
	cases := []struct {
		name        string
		instance    Flags
		groupScopes []string
		want        Scope
	}{
		{"sin grupos no ve nada", Flags{SOC: true, NOC: true}, nil, ScopeNone},
		{"grupo both con instancia completa", Flags{SOC: true, NOC: true}, []string{"both"}, ScopeBoth},
		{"grupo both recortado por instancia solo-NOC", Flags{NOC: true}, []string{"both"}, ScopeNOC},
		{"grupo soc en instancia solo-NOC no ve nada", Flags{NOC: true}, []string{"soc"}, ScopeNone},
		{"union de grupos soc+noc", Flags{SOC: true, NOC: true}, []string{"soc", "noc"}, ScopeBoth},
		{"grupo none no suma nada", Flags{SOC: true, NOC: true}, []string{"none", "soc"}, ScopeSOC},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectiveScope(tc.instance, tc.groupScopes); got != tc.want {
				t.Fatalf("EffectiveScope() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestScopeIncludes(t *testing.T) {
	if !ScopeBoth.Includes(NOC) || !ScopeBoth.Includes(SOC) {
		t.Fatal("both debe incluir SOC y NOC")
	}
	if ScopeSOC.Includes(NOC) {
		t.Fatal("soc no debe incluir NOC")
	}
	if ScopeNone.Includes(SOC) {
		t.Fatal("none no incluye nada")
	}
}

func TestFlagsEnabled(t *testing.T) {
	f := Flags{SOC: false, NOC: true}
	if f.Enabled(SOC) || !f.Enabled(NOC) {
		t.Fatalf("Enabled() inconsistente con Flags %+v", f)
	}
}
