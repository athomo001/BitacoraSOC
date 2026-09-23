package auth_test

import (
	"testing"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/auth"
	"github.com/google/uuid"
)

func testIssuer(t *testing.T) *auth.JWTIssuer {
	t.Helper()
	return auth.NewJWTIssuer([]byte("llave-de-prueba-no-usar-en-produccion"))
}

func TestJWTIssuer_EmiteYVerifica(t *testing.T) {
	issuer := testIssuer(t)
	userID := uuid.New()

	token, err := issuer.Issue(auth.Claims{UserID: userID, Username: "ana", Role: "admin"}, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}

	claims, err := issuer.Verify(token)
	if err != nil {
		t.Fatalf("Verify() error inesperado: %v", err)
	}
	if claims.UserID != userID {
		t.Fatalf("UserID = %v, se esperaba %v", claims.UserID, userID)
	}
	if claims.Username != "ana" || claims.Role != "admin" {
		t.Fatalf("claims = %+v, no coinciden con lo emitido", claims)
	}
}

func TestJWTIssuer_RechazaTokenExpirado(t *testing.T) {
	issuer := testIssuer(t)
	token, err := issuer.Issue(auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user"}, -time.Minute)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	if _, err := issuer.Verify(token); err == nil {
		t.Fatal("Verify() con token expirado debería fallar, no devolvió error")
	}
}

func TestJWTIssuer_RechazaFirmaConOtraLlave(t *testing.T) {
	issuerA := auth.NewJWTIssuer([]byte("llave-a"))
	issuerB := auth.NewJWTIssuer([]byte("llave-b"))

	token, err := issuerA.Issue(auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user"}, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	if _, err := issuerB.Verify(token); err == nil {
		t.Fatal("Verify() con una llave distinta debería fallar, no devolvió error")
	}
}

func TestJWTIssuer_RechazaTokenManipulado(t *testing.T) {
	issuer := testIssuer(t)
	token, err := issuer.Issue(auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user"}, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	tampered := token[:len(token)-2] + "xx"
	if _, err := issuer.Verify(tampered); err == nil {
		t.Fatal("Verify() con token manipulado debería fallar, no devolvió error")
	}
}

func TestJWTIssuer_PurposeDefaultEsAccess(t *testing.T) {
	issuer := testIssuer(t)
	token, err := issuer.Issue(auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user"}, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	claims, err := issuer.Verify(token)
	if err != nil {
		t.Fatalf("Verify() error inesperado: %v", err)
	}
	if claims.Purpose != auth.PurposeAccess {
		t.Fatalf("Purpose = %q, se esperaba %q por defecto", claims.Purpose, auth.PurposeAccess)
	}
}

func TestJWTIssuer_PreservaPurposeExplicito(t *testing.T) {
	// El tempToken de MFA pendiente (POST /api/auth/login con MFA activo)
	// NO debe poder usarse como un token de acceso real — ver
	// middleware.Auth.RequireAuth, que rechaza cualquier Purpose distinto de
	// "access". Encontrado como bug real al implementar el flujo de MFA: un
	// tempToken sin este campo pasaría igual por RequireAuth.
	issuer := testIssuer(t)
	token, err := issuer.Issue(auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user", Purpose: auth.PurposeMFAPending}, 5*time.Minute)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	claims, err := issuer.Verify(token)
	if err != nil {
		t.Fatalf("Verify() error inesperado: %v", err)
	}
	if claims.Purpose != auth.PurposeMFAPending {
		t.Fatalf("Purpose = %q, se esperaba %q", claims.Purpose, auth.PurposeMFAPending)
	}
}

func TestJWTIssuer_JTIDistintoPorToken(t *testing.T) {
	issuer := testIssuer(t)
	claims := auth.Claims{UserID: uuid.New(), Username: "ana", Role: "user"}

	tokenA, err := issuer.Issue(claims, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}
	tokenB, err := issuer.Issue(claims, time.Hour)
	if err != nil {
		t.Fatalf("Issue() error inesperado: %v", err)
	}

	claimsA, err := issuer.Verify(tokenA)
	if err != nil {
		t.Fatalf("Verify(tokenA) error inesperado: %v", err)
	}
	claimsB, err := issuer.Verify(tokenB)
	if err != nil {
		t.Fatalf("Verify(tokenB) error inesperado: %v", err)
	}
	if claimsA.JTI == claimsB.JTI {
		t.Fatal("dos tokens del mismo usuario tienen el mismo JTI — token_denylist necesita JTIs únicos para revocar uno sin afectar al resto")
	}
}
