package main

import (
	"io"
	"log/slog"
	"testing"
)

func TestRateLimitDisabled(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	cases := []struct {
		env, baseURL string
		want         bool
	}{
		{"", "http://127.0.0.1:8081", false},
		{"false", "http://localhost", false},
		{"true", "http://127.0.0.1:8081", true},
		{"1", "http://localhost", true},
		{"TRUE", "http://[::1]:8081", true},
		{"true", "https://bitacora.synet.cl", false},
		{"true", "http://10.0.0.5", false},
		{"true", "http://localhost.evil.com", false},
	}
	for _, c := range cases {
		t.Setenv("RATE_LIMIT_DISABLED", c.env)
		if got := rateLimitDisabled(c.baseURL, logger); got != c.want {
			t.Errorf("RATE_LIMIT_DISABLED=%q con %s: got %v, want %v", c.env, c.baseURL, got, c.want)
		}
	}
}
