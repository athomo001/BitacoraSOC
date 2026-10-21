package forward

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestClassify(t *testing.T) {
	cases := map[string]string{
		"entry.created": GroupEntries, "entry.deleted": GroupEntries,
		"escalation.incident.opened": GroupEscalation, "escalation.action": GroupEscalation,
		"ticket.sla_breached": GroupTickets, "ticket.glpi_synced": GroupTickets,
		"auth.login.failed": GroupAudit, "config.forward.update": GroupAudit, "escalation.policy.create": GroupAudit,
	}
	for ev, want := range cases {
		if got := Classify(ev); got != want {
			t.Errorf("Classify(%q) = %q, quería %q", ev, got, want)
		}
	}
}

func TestSubscriptionsWants(t *testing.T) {
	s := subscriptions{audit: true, minRank: Rank("warn"), tickets: true}
	if s.wants(GroupAudit, "info") || !s.wants(GroupAudit, "warn") || !s.wants(GroupAudit, "error") {
		t.Error("la auditoría tiene que respetar el nivel mínimo")
	}
	if !s.wants(GroupTickets, "info") || s.wants(GroupEntries, "error") {
		t.Error("los grupos de operación no miran el nivel")
	}
}

func TestLineRFC5424(t *testing.T) {
	ts := time.Date(2026, 10, 21, 14, 3, 11, 402_000_000, time.UTC)
	got := string(Line("rfc5424", "bitacora 1", Message{Payload: []byte(`{"a":1}`), Event: "ticket.sla_breached", Level: "warn", TS: ts}))
	want := `<132>1 2026-10-21T14:03:11.402Z bitacora1 bitacora - ticket.sla_breached - {"a":1}`
	if got != want {
		t.Fatalf("RFC 5424:\n got %s\nwant %s", got, want)
	}
	if string(Line("json", "x", Message{Payload: []byte(`{"a":1}`)})) != `{"a":1}` {
		t.Fatal("JSON va tal cual")
	}
	if !strings.HasPrefix(string(Line("rfc5424", "", Message{Level: "error"})), "<131>1 0001-01-01T00:00:00.000Z - bitacora - - - ") {
		t.Fatal("los campos vacíos van como «-»")
	}
}

func TestBackoff(t *testing.T) {
	if Backoff(0) != time.Second || Backoff(3) != 8*time.Second || Backoff(40) != maxBackoff {
		t.Fatalf("backoff: %v %v %v", Backoff(0), Backoff(3), Backoff(40))
	}
}

func msgs(n int) []Message {
	out := make([]Message, n)
	for i := range out {
		out[i] = Message{Payload: []byte(`{"n":` + strconv.Itoa(i) + `}`), Event: "entry.created", Level: "info", TS: time.Now()}
	}
	return out
}

// lineServer recibe líneas por TCP (o TLS) y las junta.
func lineServer(t *testing.T, ln net.Listener) (*sync.WaitGroup, *[]string) {
	t.Helper()
	var mu sync.Mutex
	lines := []string{}
	wg := &sync.WaitGroup{}
	wg.Add(1)
	go func() {
		defer wg.Done()
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		sc := bufio.NewScanner(conn)
		for sc.Scan() {
			mu.Lock()
			lines = append(lines, sc.Text())
			mu.Unlock()
		}
	}()
	return wg, &lines
}

func TestSendTCP(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	wg, lines := lineServer(t, ln)
	port := ln.Addr().(*net.TCPAddr).Port
	n, err := Send(context.Background(), Target{Transport: "tcp", Host: "127.0.0.1", Port: port, Format: "json"}, msgs(3))
	if err != nil || n != 3 {
		t.Fatalf("enviados %d, err %v", n, err)
	}
	wg.Wait()
	if len(*lines) != 3 || (*lines)[2] != `{"n":2}` {
		t.Fatalf("llegó: %v", *lines)
	}
}

func TestSendTCPSinConexion(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	n, err := Send(context.Background(), Target{Transport: "tcp", Host: "127.0.0.1", Port: port, Timeout: time.Second}, msgs(2))
	if err == nil || n != 0 || !strings.Contains(err.Error(), "no se pudo conectar") {
		t.Fatalf("quería un error de conexión, n=%d err=%v", n, err)
	}
}

// pki arma una CA, un certificado de servidor para 127.0.0.1 y uno de cliente.
func pki(t *testing.T) (caPEM string, server tls.Certificate, clientCert, clientKey string) {
	t.Helper()
	key := func() *ecdsa.PrivateKey {
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		return k
	}
	caKey := key()
	caTpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "CA de prueba"}, IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	caDER, _ := x509.CreateCertificate(rand.Reader, caTpl, caTpl, &caKey.PublicKey, caKey)
	ca, _ := x509.ParseCertificate(caDER)
	issue := func(serial int64, cn string, usage x509.ExtKeyUsage, ip bool) ([]byte, *ecdsa.PrivateKey) {
		k := key()
		tpl := &x509.Certificate{SerialNumber: big.NewInt(serial), Subject: pkix.Name{CommonName: cn}, ExtKeyUsage: []x509.ExtKeyUsage{usage},
			KeyUsage: x509.KeyUsageDigitalSignature, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
		if ip {
			tpl.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
		}
		der, _ := x509.CreateCertificate(rand.Reader, tpl, ca, &k.PublicKey, caKey)
		return der, k
	}
	pemOf := func(typ string, b []byte) string { return string(pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: b})) }
	keyPEM := func(k *ecdsa.PrivateKey) string {
		b, _ := x509.MarshalECPrivateKey(k)
		return pemOf("EC PRIVATE KEY", b)
	}
	sDER, sKey := issue(2, "siem", x509.ExtKeyUsageServerAuth, true)
	server, err := tls.X509KeyPair([]byte(pemOf("CERTIFICATE", sDER)), []byte(keyPEM(sKey)))
	if err != nil {
		t.Fatal(err)
	}
	cDER, cKey := issue(3, "bitacora", x509.ExtKeyUsageClientAuth, false)
	return pemOf("CERTIFICATE", caDER), server, pemOf("CERTIFICATE", cDER), keyPEM(cKey)
}

func TestSendTLSConMTLS(t *testing.T) {
	caPEM, server, cert, key := pki(t)
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM([]byte(caPEM))
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{server}, ClientCAs: pool,
		ClientAuth: tls.RequireAndVerifyClientCert, MinVersion: tls.VersionTLS12})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	wg, lines := lineServer(t, ln)
	port := ln.Addr().(*net.TCPAddr).Port
	target := Target{Transport: "tls", Host: "127.0.0.1", Port: port, Format: "rfc5424", Hostname: "nodo-1", CACert: caPEM, ClientCert: cert, ClientKey: key}
	if n, err := Send(context.Background(), target, msgs(2)); err != nil || n != 2 {
		t.Fatalf("enviados %d, err %v", n, err)
	}
	wg.Wait()
	if len(*lines) != 2 || !strings.HasPrefix((*lines)[0], "<134>1 ") || !strings.HasSuffix((*lines)[0], `{"n":0}`) {
		t.Fatalf("llegó: %v", *lines)
	}

	// Sin la CA propia, el certificado del SIEM no se acepta.
	ln2, _ := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{server}, MinVersion: tls.VersionTLS12})
	defer ln2.Close()
	go func() {
		if c, err := ln2.Accept(); err == nil {
			_ = c.(*tls.Conn).Handshake()
			c.Close()
		}
	}()
	bad := Target{Transport: "tls", Host: "127.0.0.1", Port: ln2.Addr().(*net.TCPAddr).Port, Timeout: 2 * time.Second}
	if _, err := Send(context.Background(), bad, msgs(1)); err == nil {
		t.Fatal("sin la CA no tendría que conectar")
	}
}

func TestSendHTTP(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	var auth, ctype string
	fail := false
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		defer mu.Unlock()
		auth, ctype = r.Header.Get("Authorization"), r.Header.Get("Content-Type")
		if fail && len(bodies) == 1 {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("token inválido"))
			return
		}
		bodies = append(bodies, string(b))
	}))
	defer srv.Close()
	caPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: srv.Certificate().Raw}))
	target := Target{Transport: "http", URL: srv.URL + "/ingesta", Format: "json", CACert: caPEM, Headers: map[string]string{"Authorization": "Splunk abc"}}

	if n, err := Send(context.Background(), target, msgs(2)); err != nil || n != 2 || len(bodies) != 2 || bodies[1] != `{"n":1}` {
		t.Fatalf("uno por evento: n=%d err=%v %v", n, err, bodies)
	}
	if auth != "Splunk abc" || ctype != "application/json" {
		t.Fatalf("cabeceras: %q %q", auth, ctype)
	}

	bodies = nil
	target.Batch = true
	if n, err := Send(context.Background(), target, msgs(3)); err != nil || n != 3 || len(bodies) != 1 || strings.Count(bodies[0], "\n") != 3 || ctype != "application/x-ndjson" {
		t.Fatalf("en lote: n=%d err=%v %q %q", n, err, bodies, ctype)
	}

	// Falla a la mitad: los que salieron cuentan.
	bodies, fail, target.Batch = nil, true, false
	n, err := Send(context.Background(), target, msgs(3))
	if n != 1 || err == nil || !strings.Contains(err.Error(), "403") || !strings.Contains(err.Error(), "token inválido") {
		t.Fatalf("quería 1 enviado y un 403, n=%d err=%v", n, err)
	}
}
