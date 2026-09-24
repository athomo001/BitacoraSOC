package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
)

// UserDTO es lo único que sale por HTTP de un db.User — nunca el modelo
// crudo (PasswordHash/MfaSecretEncrypted/ResetPasswordTokenHash jamás
// salen, estructuralmente, porque el campo no existe acá). Ver
// spec/07-backend-arquitectura-go.md sección 6.6.
type UserDTO struct {
	ID                 uuid.UUID `json:"id"`
	Username           string    `json:"username"`
	Email              string    `json:"email"`
	FullName           *string   `json:"fullName,omitempty"`
	Phone              *string   `json:"phone,omitempty"`
	Birthday           *string   `json:"birthday,omitempty"`
	AvatarURL          *string   `json:"avatarUrl,omitempty"`
	Role               string    `json:"role"`
	CargoLabel         *string   `json:"cargoLabel,omitempty"`
	MFAEnabled         bool      `json:"mfaEnabled"`
	MustChangePassword bool      `json:"mustChangePassword"`
	Active             bool      `json:"active"`
	CreatedAt          time.Time `json:"createdAt"`
}

func toUserDTO(u db.User) UserDTO {
	dto := UserDTO{
		ID:                 u.ID,
		Username:           u.Username,
		Email:              u.Email,
		Role:               string(u.Role),
		MFAEnabled:         u.MfaEnabled,
		MustChangePassword: u.MustChangePassword,
		Active:             u.Active,
	}
	if u.FullName.Valid {
		dto.FullName = &u.FullName.String
	}
	if u.Phone.Valid {
		dto.Phone = &u.Phone.String
	}
	if u.Birthday.Valid {
		birthday := u.Birthday.Time.Format("2006-01-02")
		dto.Birthday = &birthday
	}
	if u.AvatarUrl.Valid {
		dto.AvatarURL = &u.AvatarUrl.String
	}
	if u.CargoLabel.Valid {
		dto.CargoLabel = &u.CargoLabel.String
	}
	if u.CreatedAt.Valid {
		dto.CreatedAt = u.CreatedAt.Time
	}
	return dto
}

// writeData envuelve la respuesta de éxito en {data, meta?} — convención
// global cerrada en spec/04-contratos-api.md. Nombrado distinto del
// writeJSON de health_handler.go (Fase 2, sin envoltorio: los health checks
// no son un recurso REST, se dejan como estaban ya verificados).
func writeData(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

func writeDataMeta(w http.ResponseWriter, status int, data any, meta any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data, "meta": meta})
}

func writeNoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

// decodeJSON decodifica el body de r en dst con un tope de 1MB — mismo
// principio que sqlc/pgx rechazando payloads inesperados por tipo
// (spec/07-backend-arquitectura-go.md sección 2): un JSON gigante no debe
// tumbar el handler antes de siquiera validarlo por forma.
func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1MB
	return json.NewDecoder(r.Body).Decode(dst)
}
