package forward

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Target es un destino ya descifrado, listo para enviar.
type Target struct {
	Transport  string // udp | tcp | tls | http
	Host       string
	Port       int
	URL        string
	Format     string // json | rfc5424
	Batch      bool   // HTTP: un POST con NDJSON en vez de uno por evento
	CACert     string
	ClientCert string
	ClientKey  string
	Headers    map[string]string
	// Hostname va en el HOSTNAME de RFC 5424 (el nodo que envía).
	Hostname string
	Timeout  time.Duration
}

// Message es un evento de la cola: su JSON y lo que pide RFC 5424.
type Message struct {
	Payload []byte
	Event   string
	Level   string
	TS      time.Time
}

func (t Target) timeout() time.Duration {
	if t.Timeout > 0 {
		return t.Timeout
	}
	return 10 * time.Second
}

// Line arma lo que se escribe por evento: el JSON solo, o RFC 5424 con el
// JSON como mensaje (facility local0; severidad según el nivel).
func Line(format, hostname string, m Message) []byte {
	if format != "rfc5424" {
		return m.Payload
	}
	sev := 6
	switch m.Level {
	case "warn":
		sev = 4
	case "error":
		sev = 3
	}
	host := sanitizeHeader(hostname, 255)
	msgID := sanitizeHeader(m.Event, 32)
	ts := m.TS.UTC().Format("2006-01-02T15:04:05.000Z")
	var b bytes.Buffer
	fmt.Fprintf(&b, "<%d>1 %s %s bitacora - %s - ", 16*8+sev, ts, host, msgID)
	b.Write(m.Payload)
	return b.Bytes()
}

// sanitizeHeader: los campos de cabecera de RFC 5424 son ASCII imprimible
// sin espacios; vacío se escribe «-».
func sanitizeHeader(s string, max int) string {
	var b strings.Builder
	for _, r := range s {
		if r > 32 && r < 127 {
			b.WriteRune(r)
		}
		if b.Len() >= max {
			break
		}
	}
	if b.Len() == 0 {
		return "-"
	}
	return b.String()
}

func (t Target) tlsConfig(serverName string) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: serverName}
	if strings.TrimSpace(t.CACert) != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(t.CACert)) {
			return nil, errors.New("la CA propia no es un certificado PEM válido")
		}
		cfg.RootCAs = pool
	}
	if strings.TrimSpace(t.ClientCert) != "" || strings.TrimSpace(t.ClientKey) != "" {
		pair, err := tls.X509KeyPair([]byte(t.ClientCert), []byte(t.ClientKey))
		if err != nil {
			return nil, errors.New("el certificado o la llave de cliente (mTLS) no son válidos")
		}
		cfg.Certificates = []tls.Certificate{pair}
	}
	return cfg, nil
}

// Send manda los mensajes en orden y devuelve cuántos salieron. Si falla a
// la mitad, los que salieron cuentan y el resto se reintenta.
func Send(ctx context.Context, t Target, msgs []Message) (int, error) {
	if len(msgs) == 0 {
		return 0, nil
	}
	switch t.Transport {
	case "udp":
		return sendUDP(ctx, t, msgs)
	case "tcp", "tls":
		return sendStream(ctx, t, msgs)
	case "http":
		return sendHTTP(ctx, t, msgs)
	}
	return 0, fmt.Errorf("transporte desconocido: %s", t.Transport)
}

func (t Target) addr() string {
	return net.JoinHostPort(t.Host, strconv.Itoa(t.Port))
}

func sendUDP(ctx context.Context, t Target, msgs []Message) (int, error) {
	d := net.Dialer{Timeout: t.timeout()}
	conn, err := d.DialContext(ctx, "udp", t.addr())
	if err != nil {
		return 0, fmt.Errorf("no se pudo abrir %s: %w", t.addr(), err)
	}
	defer conn.Close()
	for i, m := range msgs {
		_ = conn.SetWriteDeadline(time.Now().Add(t.timeout()))
		if _, err := conn.Write(Line(t.Format, t.Hostname, m)); err != nil {
			return i, fmt.Errorf("no se pudo enviar a %s: %w", t.addr(), err)
		}
	}
	return len(msgs), nil
}

// sendStream: TCP o TLS con un evento por línea (encuadre por salto de línea,
// el que aceptan rsyslog, syslog-ng, Graylog, Wazuh y Logstash).
func sendStream(ctx context.Context, t Target, msgs []Message) (int, error) {
	d := &net.Dialer{Timeout: t.timeout()}
	var conn net.Conn
	var err error
	if t.Transport == "tls" {
		cfg, cerr := t.tlsConfig(t.Host)
		if cerr != nil {
			return 0, cerr
		}
		conn, err = (&tls.Dialer{NetDialer: d, Config: cfg}).DialContext(ctx, "tcp", t.addr())
	} else {
		conn, err = d.DialContext(ctx, "tcp", t.addr())
	}
	if err != nil {
		return 0, fmt.Errorf("no se pudo conectar a %s: %w", t.addr(), err)
	}
	defer conn.Close()
	for i, m := range msgs {
		_ = conn.SetWriteDeadline(time.Now().Add(t.timeout()))
		line := append(Line(t.Format, t.Hostname, m), '\n')
		if _, err := conn.Write(line); err != nil {
			return i, fmt.Errorf("se cortó la conexión con %s: %w", t.addr(), err)
		}
	}
	return len(msgs), nil
}

func sendHTTP(ctx context.Context, t Target, msgs []Message) (int, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	cfg, err := t.tlsConfig("")
	if err != nil {
		return 0, err
	}
	transport.TLSClientConfig = cfg
	client := &http.Client{Timeout: t.timeout(), Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	post := func(body []byte, contentType string) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.URL, bytes.NewReader(body))
		if err != nil {
			return fmt.Errorf("URL inválida: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "BitacoraOps-Forwarder/1")
		for k, v := range t.Headers {
			req.Header.Set(k, v)
		}
		resp, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("no se pudo conectar: %w", err)
		}
		defer resp.Body.Close()
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			msg := fmt.Sprintf("HTTP %s", resp.Status)
			if s := strings.TrimSpace(string(snippet)); s != "" {
				msg += ": " + s
			}
			return errors.New(msg)
		}
		return nil
	}
	if t.Batch {
		var body bytes.Buffer
		for _, m := range msgs {
			body.Write(Line(t.Format, t.Hostname, m))
			body.WriteByte('\n')
		}
		if err := post(body.Bytes(), "application/x-ndjson"); err != nil {
			return 0, err
		}
		return len(msgs), nil
	}
	contentType := "application/json"
	if t.Format == "rfc5424" {
		contentType = "text/plain; charset=utf-8"
	}
	for i, m := range msgs {
		if err := post(Line(t.Format, t.Hostname, m), contentType); err != nil {
			return i, err
		}
	}
	return len(msgs), nil
}
