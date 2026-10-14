package mail

import (
	"errors"
	"net/smtp"
	"slices"
	"strings"
)

// serverAuth elige el método de login que anuncia el servidor: PLAIN si lo
// ofrece y, si no, LOGIN. Office 365 (smtp.office365.com) solo ofrece LOGIN y
// XOAUTH2, y responde "504 5.7.4 Unrecognized authentication type" a PLAIN:
// el legacy (nodemailer) elegía LOGIN solo y la 2.0 usaba siempre PLAIN.
//
// Igual que smtp.PlainAuth, nunca manda la contraseña sin TLS salvo a localhost.
type serverAuth struct {
	username, password, host string
	plain                    smtp.Auth
	step                     int
}

func newServerAuth(username, password, host string) smtp.Auth {
	return &serverAuth{username: username, password: password, host: host, plain: smtp.PlainAuth("", username, password, host)}
}

func isLocalhost(name string) bool {
	return name == "localhost" || name == "127.0.0.1" || name == "::1"
}

func (a *serverAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if slices.ContainsFunc(server.Auth, func(m string) bool { return strings.EqualFold(m, "PLAIN") }) || len(server.Auth) == 0 {
		return a.plain.Start(server)
	}
	if !slices.ContainsFunc(server.Auth, func(m string) bool { return strings.EqualFold(m, "LOGIN") }) {
		return "", nil, errors.New("mail: el servidor no ofrece login PLAIN ni LOGIN (ofrece " + strings.Join(server.Auth, ", ") + ")")
	}
	if !server.TLS && !isLocalhost(server.Name) {
		return "", nil, errors.New("mail: conexión sin cifrar, no se envía la contraseña")
	}
	if server.Name != a.host {
		return "", nil, errors.New("mail: nombre de servidor distinto al configurado")
	}
	a.plain = nil
	a.step = 0
	return "LOGIN", nil, nil
}

// Next responde a las preguntas del servidor en LOGIN ("Username:", "Password:").
func (a *serverAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if a.plain != nil {
		return a.plain.Next(fromServer, more)
	}
	if !more {
		return nil, nil
	}
	prompt := strings.ToLower(string(fromServer))
	a.step++
	switch {
	case strings.Contains(prompt, "user"):
		return []byte(a.username), nil
	case strings.Contains(prompt, "pass"):
		return []byte(a.password), nil
	case a.step == 1:
		return []byte(a.username), nil
	case a.step == 2:
		return []byte(a.password), nil
	}
	return nil, errors.New("mail: pregunta de login inesperada")
}

// auth es el login de este Sender (nil = servidor sin autenticación).
func (s *Sender) auth() smtp.Auth {
	if s.cfg.Username == "" {
		return nil
	}
	return newServerAuth(s.cfg.Username, s.cfg.Password, s.cfg.Host)
}
