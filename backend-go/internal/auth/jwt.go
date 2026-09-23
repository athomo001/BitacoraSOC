package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// Purpose distingue un JWT de acceso real de un token de propósito acotado
// (ej. el tempToken de MFA pendiente) — sin esto, un tempToken emitido tras
// el primer factor de login pasaría igual por middleware.Auth.RequireAuth y
// funcionaría como sesión completa, saltándose el segundo factor. Bug real
// encontrado al implementar el flujo de MFA (Fase 4), no una precaución
// teórica.
const (
	PurposeAccess     = "access"
	PurposeMFAPending = "mfa_pending"
)

// Claims son los datos propios de BitacoraSOC dentro del JWT — mínimos a
// propósito (Interface Segregation, spec/06-frontend-arquitectura-y-ui.md
// sección 7): lo justo para identificar al actor y auditar, nunca datos de
// negocio que quedarían obsoletos apenas cambien en la base.
type Claims struct {
	UserID   uuid.UUID
	Username string
	Role     string
	JTI      uuid.UUID
	// Purpose vacío en Issue() se normaliza a PurposeAccess — así el
	// llamador no tiene que acordarse de setearlo en el caso normal.
	Purpose string
}

type jwtClaims struct {
	jwt.RegisteredClaims
	Username string `json:"username"`
	Role     string `json:"role"`
	Purpose  string `json:"purpose"`
}

// JWTIssuer emite y verifica JWT firmados con HMAC-SHA256 y una llave
// compartida — spec/09-alta-disponibilidad-2-nodos.md: "autenticación JWT
// con clave compartida (cero logout en failover)" también aplica al nodo
// único, mismo mecanismo.
type JWTIssuer struct {
	key []byte
}

// NewJWTIssuer construye un issuer con la llave de firma (JWT_SIGNING_KEY).
func NewJWTIssuer(key []byte) *JWTIssuer {
	return &JWTIssuer{key: key}
}

// Issue emite un JWT para claims, válido durante ttl. Un JTI aleatorio nuevo
// por token permite revocar uno solo vía token_denylist sin invalidar el
// resto de las sesiones del mismo usuario.
func (i *JWTIssuer) Issue(claims Claims, ttl time.Duration) (string, error) {
	jti := uuid.New()
	now := time.Now()

	purpose := claims.Purpose
	if purpose == "" {
		purpose = PurposeAccess
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   claims.UserID.String(),
			ID:        jti.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
		Username: claims.Username,
		Role:     claims.Role,
		Purpose:  purpose,
	})

	signed, err := token.SignedString(i.key)
	if err != nil {
		return "", fmt.Errorf("auth: firmando JWT: %w", err)
	}
	return signed, nil
}

// Verify valida la firma y expiración de tokenString y devuelve sus claims.
func (i *JWTIssuer) Verify(tokenString string) (Claims, error) {
	var claims jwtClaims
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("auth: método de firma inesperado: %v", t.Header["alg"])
		}
		return i.key, nil
	})
	if err != nil {
		return Claims{}, fmt.Errorf("auth: verificando JWT: %w", err)
	}
	if !token.Valid {
		return Claims{}, errors.New("auth: JWT inválido")
	}

	userID, err := uuid.Parse(claims.Subject)
	if err != nil {
		return Claims{}, fmt.Errorf("auth: subject del JWT no es un UUID válido: %w", err)
	}
	jti, err := uuid.Parse(claims.ID)
	if err != nil {
		return Claims{}, fmt.Errorf("auth: jti del JWT no es un UUID válido: %w", err)
	}

	return Claims{
		UserID:   userID,
		Username: claims.Username,
		Role:     claims.Role,
		JTI:      jti,
		Purpose:  claims.Purpose,
	}, nil
}
