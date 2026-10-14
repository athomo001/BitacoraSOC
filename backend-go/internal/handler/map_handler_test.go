package handler

import "testing"

func TestValidTilesURL(t *testing.T) {
	cases := map[string]bool{
		"https://tile.openstreetmap.org/{z}/{x}/{y}.png":   true,
		"http://mapas.local:8080/tiles/{z}/{x}/{y}.png":    true,
		"https://{s}.tiles.example.com/{z}/{x}/{y}@2x.png": true,
		"https://tiles.example.com/{z}/{x}.png":            false,
		"javascript:alert(1)//{z}/{x}/{y}":                 false,
		"ftp://tiles.example.com/{z}/{x}/{y}.png":          false,
		"/tiles/{z}/{x}/{y}.png":                           false,
		"":                                                 false,
	}
	for raw, want := range cases {
		if got := validTilesURL(raw); got != want {
			t.Errorf("validTilesURL(%q) = %v, quería %v", raw, got, want)
		}
	}
}
