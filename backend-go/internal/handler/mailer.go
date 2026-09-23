package handler

import (
	"context"
	"fmt"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
)

// buildMailSender arma un mail.Sender a partir de smtp_config, descifrando
// la contraseña en el momento (nunca queda en texto plano fuera de esta
// llamada) — ver spec/07-backend-arquitectura-go.md sección 6.6.
func buildMailSender(ctx context.Context, queries *db.Queries, box *crypto.Box) (*mail.Sender, string, error) {
	config, err := queries.GetSMTPConfig(ctx)
	if err != nil {
		return nil, "", fmt.Errorf("handler: SMTP no configurado: %w", err)
	}

	password := ""
	if config.PasswordEncrypted.Valid && config.PasswordEncrypted.String != "" {
		password, err = box.Decrypt(config.PasswordEncrypted.String)
		if err != nil {
			return nil, "", fmt.Errorf("handler: descifrando password de smtp_config: %w", err)
		}
	}

	username := ""
	if config.Username.Valid {
		username = config.Username.String
	}

	sender := mail.NewSender(mail.Config{
		Host:        config.Host,
		Port:        int(config.Port),
		Username:    username,
		Password:    password,
		FromAddress: config.FromAddress,
		RequireTLS:  config.RequireTls,
	})
	return sender, config.FromAddress, nil
}
