package complements

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Tipos de ticket firmado (spec/11 §2).
const (
	// KindEmbed: enlace de un solo uso (60 s) que la app entrega al iframe.
	KindEmbed = "embed"
	// KindPreview: igual, pero para la vista previa de un ZIP sin publicar.
	KindPreview = "preview"
	// KindSession: la cookie del origen aislado (8 h), acotada a un complemento.
	KindSession = "session"
)

// Duraciones de spec/11 §2.
const (
	EmbedTTL   = 60 * time.Second
	SessionTTL = 8 * time.Hour
)

// Ticket es lo que viaja firmado en el enlace y en la cookie. Target es el
// slug del complemento, o el id de la subida en una vista previa.
type Ticket struct {
	Kind   string    `json:"k"`
	Target string    `json:"t"`
	UserID uuid.UUID `json:"u"`
	Role   string    `json:"r"`
	Nonce  uuid.UUID `json:"n"`
	Expiry int64     `json:"e"`
}

// Signer firma tickets con una llave derivada de JWT_SIGNING_KEY, distinta
// de la de los JWT: un ticket nunca pasa por una sesión ni al revés.
type Signer struct {
	key []byte
	now func() time.Time
}

// NewSigner deriva la llave de tickets a partir de la llave de firma.
func NewSigner(signingKey []byte) *Signer {
	mac := hmac.New(sha256.New, signingKey)
	mac.Write([]byte("bitacora-complements-ticket-v1"))
	return &Signer{key: mac.Sum(nil), now: time.Now}
}

// Issue firma un ticket nuevo del tipo pedido, con nonce propio.
func (s *Signer) Issue(kind, target string, userID uuid.UUID, role string, ttl time.Duration) (string, Ticket) {
	t := Ticket{Kind: kind, Target: target, UserID: userID, Role: role, Nonce: uuid.New(), Expiry: s.now().Add(ttl).Unix()}
	payload, _ := json.Marshal(t)
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.mac(body)), t
}

func (s *Signer) mac(body string) []byte {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(body))
	return m.Sum(nil)
}

// ErrTicket es un ticket inválido, vencido o de otro tipo/complemento.
var ErrTicket = errors.New("complements: ticket inválido")

// Verify comprueba firma, vencimiento, tipo y destino. El "un solo uso" lo
// garantiza quien llama, registrando el nonce (token_denylist).
func (s *Signer) Verify(raw, kind, target string) (Ticket, error) {
	body, sig, ok := strings.Cut(raw, ".")
	if !ok {
		return Ticket{}, ErrTicket
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(body)) {
		return Ticket{}, ErrTicket
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return Ticket{}, ErrTicket
	}
	var t Ticket
	if json.Unmarshal(payload, &t) != nil || t.Kind != kind || t.Target != target || s.now().Unix() > t.Expiry {
		return Ticket{}, ErrTicket
	}
	return t, nil
}
