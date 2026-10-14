package mail

import (
	"net/smtp"
	"testing"
)

// Office 365 anuncia "AUTH LOGIN XOAUTH2": hay que usar LOGIN, no PLAIN.
func TestServerAuthUsesLoginWhenPlainIsNotOffered(t *testing.T) {
	a := newServerAuth("noc@empresa.cl", "secreta", "smtp.office365.com")
	mech, initial, err := a.Start(&smtp.ServerInfo{Name: "smtp.office365.com", TLS: true, Auth: []string{"LOGIN", "XOAUTH2"}})
	if err != nil || mech != "LOGIN" || initial != nil {
		t.Fatalf("Start = %q, %q, %v", mech, initial, err)
	}
	if user, _ := a.Next([]byte("Username:"), true); string(user) != "noc@empresa.cl" {
		t.Fatalf("usuario: %q", user)
	}
	if pass, _ := a.Next([]byte("Password:"), true); string(pass) != "secreta" {
		t.Fatalf("contraseña: %q", pass)
	}
}

func TestServerAuthPrefersPlain(t *testing.T) {
	mech, _, err := newServerAuth("u", "p", "smtp.gmail.com").Start(&smtp.ServerInfo{Name: "smtp.gmail.com", TLS: true, Auth: []string{"LOGIN", "PLAIN", "XOAUTH2"}})
	if err != nil || mech != "PLAIN" {
		t.Fatalf("Start = %q, %v", mech, err)
	}
}

func TestServerAuthNeverSendsPasswordWithoutTLS(t *testing.T) {
	if _, _, err := newServerAuth("u", "p", "smtp.office365.com").Start(&smtp.ServerInfo{Name: "smtp.office365.com", Auth: []string{"LOGIN"}}); err == nil {
		t.Fatal("sin TLS no se manda la contraseña")
	}
}
