// Package mailpittest: los tests de integración que mandan correo de verdad
// a Mailpit (un catcher SMTP) se saltan si no está corriendo, igual que los
// de la base sin BITACORA_TEST_DSN, en vez de fallar. Para correrlos:
//
//	docker run -d --rm --name mailpit-test -p 11025:1025 -p 18025:8025 axllent/mailpit
package mailpittest

import (
	"net"
	"testing"
	"time"
)

// SMTPAddr es donde escucha el SMTP de Mailpit en las pruebas.
const SMTPAddr = "127.0.0.1:11025"

// Require salta el test si Mailpit no responde en SMTPAddr.
func Require(t testing.TB) {
	t.Helper()
	conn, err := net.DialTimeout("tcp", SMTPAddr, time.Second)
	if err != nil {
		t.Skip("Mailpit no está corriendo en " + SMTPAddr + " (docker run -d --rm --name mailpit-test -p 11025:1025 -p 18025:8025 axllent/mailpit)")
	}
	_ = conn.Close()
}
