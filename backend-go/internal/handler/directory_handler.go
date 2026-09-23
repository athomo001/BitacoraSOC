package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DirectoryHandler cubre /api/directory/* y /api/contacts/:id/channels,
// /api/users/:id/channels (spec/04-contratos-api.md "Directorio Global de
// Contactos", HU-DIR-1/2). Portado de directoryContactController.js del
// legacy; los permisos por capacidad los pone main.go (RequireCapability).
//
// Modelo: los canales (contact_channels) son la fuente de verdad de cómo
// contactar a alguien; contacts.email/phone guardan la copia cifrada e
// indexada del canal preferido de cada tipo, para listar y buscar sin
// recorrer canales (ver syncPrimaryChannels).
type DirectoryHandler struct {
	Pool     *pgxpool.Pool
	Queries  *db.Queries
	Crypto   *crypto.Box
	AuditLog *audit.Logger
}

const (
	maxDirectoryQueryLength = 64 // mismo tope que el legacy
	defaultDirectoryPage    = 50
	maxDirectoryPage        = 500
	searchLimit             = 20
	maxCSVBytes             = 2 << 20 // 2MB, mismo tope que multer en el legacy
)

var channelTypes = map[string]bool{"call": true, "whatsapp": true, "sms": true, "email": true, "other": true}

// isPhoneChannel: tipos cuyo valor es un número (el preferido de estos alimenta contacts.phone).
func isPhoneChannel(t string) bool { return t == "call" || t == "whatsapp" || t == "sms" }

type channelDTO struct {
	ID          uuid.UUID `json:"id"`
	ChannelType string    `json:"channelType"`
	Value       string    `json:"value"`
	Label       *string   `json:"label,omitempty"`
	Preferred   bool      `json:"preferred"`
}

type contactDTO struct {
	ID               uuid.UUID    `json:"id"`
	OrganizationID   uuid.UUID    `json:"organizationId"`
	OrganizationName string       `json:"organizationName"`
	OrganizationType string       `json:"organizationType"`
	Name             string       `json:"name"`
	Position         *string      `json:"position,omitempty"`
	Specialty        *string      `json:"specialty,omitempty"`
	Scope            string       `json:"scope"`
	Source           string       `json:"source"`
	IsFavorite       bool         `json:"isFavorite"`
	Email            string       `json:"email"`
	Phone            string       `json:"phone"`
	Notes            *string      `json:"notes,omitempty"`
	Active           bool         `json:"active"`
	CreatedAt        time.Time    `json:"createdAt"`
	UpdatedAt        time.Time    `json:"updatedAt"`
	Channels         []channelDTO `json:"channels"`
}

// contactRow unifica ListDirectoryRow y GetDirectoryContactRow (mismas
// columnas, tipos distintos generados por sqlc).
type contactRow struct {
	ID               uuid.UUID
	OrganizationID   uuid.UUID
	OrganizationName string
	OrganizationType db.OrganizationType
	Name             string
	Position         pgtype.Text
	Specialty        pgtype.Text
	Scope            db.ContactScope
	Source           db.ContactSource
	IsFavorite       bool
	EmailEncrypted   pgtype.Text
	PhoneEncrypted   pgtype.Text
	Notes            pgtype.Text
	Active           bool
	CreatedAt        pgtype.Timestamptz
	UpdatedAt        pgtype.Timestamptz
}

func fromListRow(c db.ListDirectoryRow) contactRow {
	return contactRow{c.ID, c.OrganizationID, c.OrganizationName, c.OrganizationType, c.Name, c.Position, c.Specialty,
		c.Scope, c.Source, c.IsFavorite, c.EmailEncrypted, c.PhoneEncrypted, c.Notes, c.Active, c.CreatedAt, c.UpdatedAt}
}

func fromGetRow(c db.GetDirectoryContactRow) contactRow {
	return contactRow{c.ID, c.OrganizationID, c.OrganizationName, c.OrganizationType, c.Name, c.Position, c.Specialty,
		c.Scope, c.Source, c.IsFavorite, c.EmailEncrypted, c.PhoneEncrypted, c.Notes, c.Active, c.CreatedAt, c.UpdatedAt}
}

func (h *DirectoryHandler) decrypt(t pgtype.Text) string {
	if !t.Valid || t.String == "" {
		return ""
	}
	plain, err := h.Crypto.Decrypt(t.String)
	if err != nil {
		return "" // un dato ilegible no debe tumbar el listado completo
	}
	return plain
}

func (h *DirectoryHandler) toChannelDTO(c db.ContactChannel) channelDTO {
	return channelDTO{ID: c.ID, ChannelType: string(c.ChannelType), Value: h.decrypt(pgtype.Text{String: c.ValueEncrypted, Valid: true}), Label: textPtr(c.Label), Preferred: c.Preferred}
}

func (h *DirectoryHandler) toContactDTO(c contactRow, channels []db.ContactChannel) contactDTO {
	dto := contactDTO{
		ID: c.ID, OrganizationID: c.OrganizationID, OrganizationName: c.OrganizationName, OrganizationType: string(c.OrganizationType),
		Name: c.Name, Position: textPtr(c.Position), Specialty: textPtr(c.Specialty), Scope: string(c.Scope), Source: string(c.Source),
		IsFavorite: c.IsFavorite, Email: h.decrypt(c.EmailEncrypted), Phone: h.decrypt(c.PhoneEncrypted), Notes: textPtr(c.Notes),
		Active: c.Active, CreatedAt: c.CreatedAt.Time, UpdatedAt: c.UpdatedAt.Time, Channels: []channelDTO{},
	}
	for _, ch := range channels {
		dto.Channels = append(dto.Channels, h.toChannelDTO(ch))
	}
	return dto
}

// withChannels carga los canales de todos los contactos de una página en una sola query.
func (h *DirectoryHandler) withChannels(ctx context.Context, q *db.Queries, rows []contactRow) ([]contactDTO, error) {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	byContact := map[uuid.UUID][]db.ContactChannel{}
	if len(ids) > 0 {
		chans, err := q.ListChannelsForContacts(ctx, ids)
		if err != nil {
			return nil, err
		}
		for _, c := range chans {
			if c.ContactID.Valid {
				id := uuid.UUID(c.ContactID.Bytes)
				byContact[id] = append(byContact[id], c)
			}
		}
	}
	dtos := make([]contactDTO, 0, len(rows))
	for _, r := range rows {
		dtos = append(dtos, h.toContactDTO(r, byContact[r.ID]))
	}
	return dtos, nil
}

// searchFilter arma el texto (para ILIKE) y los índices ciegos (para igualdad
// exacta sobre correo/teléfono cifrados) de una búsqueda libre — la misma
// estrategia del legacy (regex en nombre/empresa, sha256 en correo/fono).
func (h *DirectoryHandler) searchFilter(raw string) (q, emailHash, phoneHash pgtype.Text) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return
	}
	q = pgtype.Text{String: escapeLike(raw), Valid: true}
	if strings.Contains(raw, "@") {
		emailHash = pgtype.Text{String: h.Crypto.BlindIndex(directory.NormalizeEmail(raw)), Valid: true}
	}
	if directory.LooksLikePhone(raw) {
		phoneHash = pgtype.Text{String: h.Crypto.BlindIndex(directory.NormalizePhone(raw)), Valid: true}
	}
	return
}

// List es GET /api/directory — convención global {data, meta{page,pageSize,total}}.
func (h *DirectoryHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	qs := r.URL.Query()
	if len([]rune(qs.Get("q"))) > maxDirectoryQueryLength {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "q no puede superar 64 caracteres")
		return
	}
	orgID, err := queryUUID(qs.Get("organizationId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
		return
	}
	var scope db.NullContactScope
	if s := qs.Get("scope"); s != "" {
		if s != "internal" && s != "external" {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "scope debe ser internal o external")
			return
		}
		scope = db.NullContactScope{ContactScope: db.ContactScope(s), Valid: true}
	}
	page := parsePositiveInt(qs.Get("page"), 1)
	pageSize := parsePositiveInt(qs.Get("pageSize"), defaultDirectoryPage)
	if pageSize > maxDirectoryPage {
		pageSize = maxDirectoryPage
	}
	q, emailHash, phoneHash := h.searchFilter(qs.Get("q"))
	specialty := queryText(qs.Get("specialty"))
	if specialty.Valid {
		specialty.String = escapeLike(specialty.String)
	}
	active := qs.Get("active") != "false"

	rows, err := h.Queries.ListDirectory(ctx, db.ListDirectoryParams{
		Active: active, OrganizationID: orgID, Scope: scope, Specialty: specialty, Favorite: queryBool(qs.Get("favorite")),
		Q: q, QEmailHash: emailHash, QPhoneHash: phoneHash, PageSize: int32(pageSize), PageOffset: int32((page - 1) * pageSize),
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo listar el directorio")
		return
	}
	total, err := h.Queries.CountDirectory(ctx, db.CountDirectoryParams{
		Active: active, OrganizationID: orgID, Scope: scope, Specialty: specialty, Favorite: queryBool(qs.Get("favorite")),
		Q: q, QEmailHash: emailHash, QPhoneHash: phoneHash,
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo contar el directorio")
		return
	}
	crow := make([]contactRow, 0, len(rows))
	for _, c := range rows {
		crow = append(crow, fromListRow(c))
	}
	dtos, err := h.withChannels(ctx, h.Queries, crow)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los canales")
		return
	}
	writeDataMeta(w, http.StatusOK, dtos, map[string]any{"page": page, "pageSize": pageSize, "total": total})
}

// Search es el typeahead GET /api/directory/search?q= (máx 20, favoritos primero).
func (h *DirectoryHandler) Search(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	raw := strings.TrimSpace(r.URL.Query().Get("q"))
	if raw == "" {
		writeData(w, http.StatusOK, []contactDTO{})
		return
	}
	if len([]rune(raw)) > maxDirectoryQueryLength {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "q no puede superar 64 caracteres")
		return
	}
	q, emailHash, phoneHash := h.searchFilter(raw)
	rows, err := h.Queries.ListDirectory(ctx, db.ListDirectoryParams{Active: true, Q: q, QEmailHash: emailHash, QPhoneHash: phoneHash, PageSize: searchLimit})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo buscar en el directorio")
		return
	}
	crow := make([]contactRow, 0, len(rows))
	for _, c := range rows {
		crow = append(crow, fromListRow(c))
	}
	dtos, err := h.withChannels(ctx, h.Queries, crow)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los canales")
		return
	}
	writeData(w, http.StatusOK, dtos)
}

func (h *DirectoryHandler) loadContact(ctx context.Context, q *db.Queries, id uuid.UUID) (contactDTO, error) {
	c, err := q.GetDirectoryContact(ctx, id)
	if err != nil {
		return contactDTO{}, err
	}
	dtos, err := h.withChannels(ctx, q, []contactRow{fromGetRow(c)})
	if err != nil {
		return contactDTO{}, err
	}
	return dtos[0], nil
}

func (h *DirectoryHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	dto, err := h.loadContact(r.Context(), h.Queries, id)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "contacto no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el contacto")
		return
	}
	writeData(w, http.StatusOK, dto)
}

type channelInput struct {
	ChannelType string  `json:"channelType"`
	Value       string  `json:"value"`
	Label       *string `json:"label"`
	Preferred   bool    `json:"preferred"`
}

// normalizeChannel valida y limpia un canal; el valor se guarda tal como lo
// escribió el analista (para mostrarlo), el índice se calcula normalizado.
func normalizeChannel(in channelInput) (channelInput, string) {
	in.ChannelType = strings.TrimSpace(in.ChannelType)
	in.Value = directory.Sanitize(in.Value, 180)
	if !channelTypes[in.ChannelType] {
		return in, "channelType debe ser call, whatsapp, sms, email u other"
	}
	if in.Value == "" {
		return in, "el valor del canal no puede estar vacío"
	}
	if in.ChannelType == "email" {
		in.Value = directory.NormalizeEmail(in.Value)
		if !directory.ValidEmail(in.Value) {
			return in, "correo con formato inválido: " + in.Value
		}
	}
	if isPhoneChannel(in.ChannelType) && directory.NormalizePhone(in.Value) == "" {
		return in, "teléfono sin dígitos: " + in.Value
	}
	return in, ""
}

func (h *DirectoryHandler) createChannel(ctx context.Context, q *db.Queries, contactID uuid.UUID, in channelInput) error {
	enc, err := h.Crypto.Encrypt(in.Value)
	if err != nil {
		return err
	}
	if in.Preferred {
		// A lo sumo un canal preferido por contacto (índice único del
		// esquema): es "la" forma preferida de contactarlo, no una por tipo.
		if err := q.ClearPreferredContactChannel(ctx, pgtype.UUID{Bytes: contactID, Valid: true}); err != nil {
			return err
		}
	}
	_, err = q.CreateContactChannel(ctx, db.CreateContactChannelParams{
		ContactID: pgtype.UUID{Bytes: contactID, Valid: true}, ChannelType: db.ContactChannelType(in.ChannelType),
		ValueEncrypted: enc, Label: nonEmptyText(in.Label), Preferred: in.Preferred,
	})
	return err
}

// syncPrimaryChannels recalcula contacts.email/phone (cifrado + índice ciego)
// a partir del canal preferido de cada tipo.
func (h *DirectoryHandler) syncPrimaryChannels(ctx context.Context, q *db.Queries, contactID uuid.UUID) error {
	chans, err := q.ListChannelsForContacts(ctx, []uuid.UUID{contactID})
	if err != nil {
		return err
	}
	params := db.SetContactPrimaryChannelsParams{ID: contactID}
	for _, c := range chans { // ya vienen ordenados: preferidos primero
		value := h.decrypt(pgtype.Text{String: c.ValueEncrypted, Valid: true})
		switch {
		case c.ChannelType == db.ContactChannelTypeEmail && !params.EmailHash.Valid:
			params.EmailEncrypted = pgtype.Text{String: c.ValueEncrypted, Valid: true}
			params.EmailHash = pgtype.Text{String: h.Crypto.BlindIndex(directory.NormalizeEmail(value)), Valid: true}
		case isPhoneChannel(string(c.ChannelType)) && !params.PhoneHash.Valid:
			params.PhoneEncrypted = pgtype.Text{String: c.ValueEncrypted, Valid: true}
			params.PhoneHash = pgtype.Text{String: h.Crypto.BlindIndex(directory.NormalizePhone(value)), Valid: true}
		}
	}
	return q.SetContactPrimaryChannels(ctx, params)
}

// setPrimaryValue implementa los campos de conveniencia email/phone del
// formulario legacy: reemplaza el valor del canal principal de ese tipo, lo
// crea si no existe, o lo borra si llega vacío.
func (h *DirectoryHandler) setPrimaryValue(ctx context.Context, q *db.Queries, contactID uuid.UUID, kind, value string) error {
	chans, err := q.ListChannelsForContacts(ctx, []uuid.UUID{contactID})
	if err != nil {
		return err
	}
	var current *db.ContactChannel
	for i := range chans {
		c := chans[i]
		if (kind == "email" && c.ChannelType == db.ContactChannelTypeEmail) || (kind == "phone" && isPhoneChannel(string(c.ChannelType))) {
			current = &c
			break
		}
	}
	if strings.TrimSpace(value) == "" {
		if current != nil {
			_, err = q.DeleteContactChannel(ctx, db.DeleteContactChannelParams{ID: current.ID, ContactID: pgtype.UUID{Bytes: contactID, Valid: true}})
		}
		return err
	}
	channelType := "email"
	if kind == "phone" {
		channelType = "call"
		if current != nil {
			channelType = string(current.ChannelType)
		}
	}
	in, problem := normalizeChannel(channelInput{ChannelType: channelType, Value: value, Preferred: len(chans) == 0})
	if problem != "" {
		return errors.New(problem)
	}
	if current == nil {
		return h.createChannel(ctx, q, contactID, in)
	}
	enc, err := h.Crypto.Encrypt(in.Value)
	if err != nil {
		return err
	}
	return q.UpdateChannelValue(ctx, db.UpdateChannelValueParams{ID: current.ID, ValueEncrypted: enc})
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// hasChannelValue dice si el contacto ya tiene un canal del MISMO tipo con el
// mismo valor normalizado. Llamada y WhatsApp al mismo número son canales
// distintos (se puede llamar sin WhatsApp y viceversa), así que no se funden.
func (h *DirectoryHandler) hasChannelValue(ctx context.Context, q *db.Queries, contactID uuid.UUID, in channelInput) (bool, error) {
	chans, err := q.ListChannelsForContacts(ctx, []uuid.UUID{contactID})
	if err != nil {
		return false, err
	}
	for _, c := range chans {
		if string(c.ChannelType) != in.ChannelType {
			continue
		}
		value := h.decrypt(pgtype.Text{String: c.ValueEncrypted, Valid: true})
		if (in.ChannelType == "email" && directory.NormalizeEmail(value) == in.Value) ||
			(isPhoneChannel(in.ChannelType) && directory.NormalizePhone(value) == directory.NormalizePhone(in.Value)) {
			return true, nil
		}
	}
	return false, nil
}

type contactInput struct {
	OrganizationID *uuid.UUID     `json:"organizationId"`
	Name           *string        `json:"name"`
	Position       *string        `json:"position"`
	Specialty      *string        `json:"specialty"`
	Scope          *string        `json:"scope"`
	IsFavorite     *bool          `json:"isFavorite"`
	Notes          *string        `json:"notes"`
	Email          *string        `json:"email"`
	Phone          *string        `json:"phone"`
	Channels       []channelInput `json:"channels"`
}

func sanitizedPtr(s *string, max int) *string {
	if s == nil {
		return nil
	}
	v := directory.Sanitize(*s, max)
	return &v
}

// validationError distingue un error de datos (400) de un error interno (500)
// dentro de una transacción.
type validationError struct{ msg string }

func (e validationError) Error() string { return e.msg }

func (h *DirectoryHandler) inTx(ctx context.Context, fn func(q *db.Queries) error) error {
	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(db.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h *DirectoryHandler) writeTxError(w http.ResponseWriter, r *http.Request, err error, fallback string) {
	var ve validationError
	switch {
	case errors.As(err, &ve):
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", ve.msg)
	case errors.Is(err, pgx.ErrNoRows):
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "no encontrado")
	default:
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", fallback)
	}
}

// Create es POST /api/directory (capacidad directory:write).
func (h *DirectoryHandler) Create(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req contactInput
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	name := sanitizedPtr(req.Name, 120)
	if name == nil || *name == "" || req.OrganizationID == nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "organizationId y name son obligatorios")
		return
	}
	scope := "external"
	if req.Scope != nil && *req.Scope == "internal" {
		scope = "internal"
	}

	var contactID uuid.UUID
	err := h.inTx(ctx, func(q *db.Queries) error {
		if _, err := q.GetOrganization(ctx, *req.OrganizationID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return validationError{"la organización indicada no existe"}
			}
			return err
		}
		var err error
		contactID, err = q.CreateContact(ctx, db.CreateContactParams{
			OrganizationID: *req.OrganizationID, Name: *name, Position: nonEmptyText(sanitizedPtr(req.Position, 120)),
			Specialty: nonEmptyText(sanitizedPtr(req.Specialty, 120)), Scope: db.ContactScope(scope), Source: db.ContactSourceManual,
			IsFavorite: req.IsFavorite != nil && *req.IsFavorite, Notes: nonEmptyText(req.Notes),
		})
		if err != nil {
			return err
		}
		for _, in := range req.Channels {
			clean, problem := normalizeChannel(in)
			if problem != "" {
				return validationError{problem}
			}
			if err := h.createChannel(ctx, q, contactID, clean); err != nil {
				return err
			}
		}
		// Los campos de conveniencia email/phone (formulario legacy) se
		// agregan como canales propios; en el alta nunca reemplazan un canal
		// enviado en channels (ej. phone + un WhatsApp distinto = 2 canales).
		for _, extra := range []channelInput{{ChannelType: "email", Value: deref(req.Email)}, {ChannelType: "call", Value: deref(req.Phone)}} {
			if strings.TrimSpace(extra.Value) == "" {
				continue
			}
			clean, problem := normalizeChannel(extra)
			if problem != "" {
				return validationError{problem}
			}
			dup, err := h.hasChannelValue(ctx, q, contactID, clean)
			if err != nil {
				return err
			}
			if !dup {
				// Si no mandaron channels explícitos, el preferido es el
				// teléfono (lo primero que se usa al escalar); sin teléfono,
				// el correo. Con channels explícitos, deciden ellos.
				noExplicitChannels := len(req.Channels) == 0
				hasPhone := strings.TrimSpace(deref(req.Phone)) != ""
				clean.Preferred = noExplicitChannels && (extra.ChannelType == "call" || !hasPhone)
				if err := h.createChannel(ctx, q, contactID, clean); err != nil {
					return err
				}
			}
		}
		return h.syncPrimaryChannels(ctx, q, contactID)
	})
	if err != nil {
		h.writeTxError(w, r, err, "no se pudo crear el contacto")
		return
	}
	dto, err := h.loadContact(ctx, h.Queries, contactID)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "contacto creado pero no se pudo leer")
		return
	}
	// Sin PII en la auditoría (el legacy registraba correo y teléfono en claro).
	h.AuditLog.Log(ctx, "directory.contact.create", audit.LevelInfo, audit.Success(), map[string]any{"contactId": contactID.String(), "organizationId": dto.OrganizationID.String()})
	writeData(w, http.StatusCreated, dto)
}

// Update es PUT /api/directory/:id (capacidad directory:write). Campos
// parciales. Un contacto sincronizado desde Usuarios (source=user_sync) solo
// admite teléfono, organización, ámbito y favorito — misma regla del legacy.
func (h *DirectoryHandler) Update(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req contactInput
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	err = h.inTx(ctx, func(q *db.Queries) error {
		current, err := q.GetDirectoryContact(ctx, id)
		if err != nil {
			return err
		}
		if current.Source == db.ContactSourceUserSync {
			req.Name, req.Email, req.Position, req.Specialty, req.Notes = nil, nil, nil, nil, nil
		}
		name := sanitizedPtr(req.Name, 120)
		if name != nil && *name == "" {
			return validationError{"el nombre no puede quedar vacío"}
		}
		params := db.UpdateContactParams{
			ID: id, OrganizationID: optionalUUID(req.OrganizationID), Name: nonEmptyText(name),
			Position: nonEmptyText(sanitizedPtr(req.Position, 120)), Specialty: nonEmptyText(sanitizedPtr(req.Specialty, 120)),
			IsFavorite: optionalBool(req.IsFavorite), Notes: nonEmptyText(req.Notes),
		}
		if req.Scope != nil {
			if *req.Scope != "internal" && *req.Scope != "external" {
				return validationError{"scope debe ser internal o external"}
			}
			params.Scope = db.NullContactScope{ContactScope: db.ContactScope(*req.Scope), Valid: true}
		}
		if _, err := q.UpdateContact(ctx, params); err != nil {
			if isForeignKeyViolation(err) {
				return validationError{"la organización indicada no existe"}
			}
			return err
		}
		for kind, value := range map[string]*string{"email": req.Email, "phone": req.Phone} {
			if value != nil {
				if err := h.setPrimaryValue(ctx, q, id, kind, *value); err != nil {
					return validationError{err.Error()}
				}
			}
		}
		return h.syncPrimaryChannels(ctx, q, id)
	})
	if err != nil {
		h.writeTxError(w, r, err, "no se pudo actualizar el contacto")
		return
	}
	dto, err := h.loadContact(ctx, h.Queries, id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el contacto")
		return
	}
	h.AuditLog.Log(ctx, "directory.contact.update", audit.LevelInfo, audit.Success(), map[string]any{"contactId": id.String()})
	writeData(w, http.StatusOK, dto)
}

// Delete es DELETE /api/directory/:id (admin o capacidad directory:delete).
// Borrado lógico. Los sincronizados desde Usuarios no se borran desde acá.
func (h *DirectoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	current, err := h.Queries.GetDirectoryContact(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !current.Active) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "contacto no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el contacto")
		return
	}
	if current.Source == db.ContactSourceUserSync {
		problemdetails.Write(w, r, http.StatusForbidden, "user-synced-contact", "los contactos sincronizados desde Usuarios no se eliminan desde el directorio")
		return
	}
	if _, err := h.Queries.SoftDeleteContact(ctx, id); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el contacto")
		return
	}
	h.AuditLog.Log(ctx, "directory.contact.delete", audit.LevelWarn, audit.Success(), map[string]any{"contactId": id.String(), "name": current.Name})
	writeNoContent(w)
}

// ===== Canales =====

func (h *DirectoryHandler) ListContactChannels(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	if _, err := h.Queries.GetDirectoryContact(r.Context(), id); err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "contacto no encontrado")
		return
	}
	chans, err := h.Queries.ListChannelsForContacts(r.Context(), []uuid.UUID{id})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los canales")
		return
	}
	dtos := make([]channelDTO, 0, len(chans))
	for _, c := range chans {
		dtos = append(dtos, h.toChannelDTO(c))
	}
	writeData(w, http.StatusOK, dtos)
}

func (h *DirectoryHandler) AddContactChannel(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req channelInput
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	clean, problem := normalizeChannel(req)
	if problem != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-channel", problem)
		return
	}
	err = h.inTx(ctx, func(q *db.Queries) error {
		if _, err := q.GetDirectoryContact(ctx, id); err != nil {
			return err
		}
		if err := h.createChannel(ctx, q, id, clean); err != nil {
			return err
		}
		return h.syncPrimaryChannels(ctx, q, id)
	})
	if err != nil {
		h.writeTxError(w, r, err, "no se pudo agregar el canal")
		return
	}
	h.AuditLog.Log(ctx, "directory.channel.create", audit.LevelInfo, audit.Success(), map[string]any{"contactId": id.String(), "channelType": clean.ChannelType})
	dto, _ := h.loadContact(ctx, h.Queries, id)
	writeData(w, http.StatusCreated, dto)
}

func (h *DirectoryHandler) DeleteContactChannel(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err1 := uuid.Parse(r.PathValue("id"))
	channelID, err2 := uuid.Parse(r.PathValue("channelId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	err := h.inTx(ctx, func(q *db.Queries) error {
		n, err := q.DeleteContactChannel(ctx, db.DeleteContactChannelParams{ID: channelID, ContactID: pgtype.UUID{Bytes: id, Valid: true}})
		if err != nil {
			return err
		}
		if n == 0 {
			return pgx.ErrNoRows
		}
		return h.syncPrimaryChannels(ctx, q, id)
	})
	if err != nil {
		h.writeTxError(w, r, err, "no se pudo eliminar el canal")
		return
	}
	h.AuditLog.Log(ctx, "directory.channel.delete", audit.LevelInfo, audit.Success(), map[string]any{"contactId": id.String()})
	writeNoContent(w)
}

// Canales de usuarios internos (miembros de equipo que son usuarios, no
// contactos del directorio) — mismo modelo, dueño user_id.

func (h *DirectoryHandler) ListUserChannels(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	chans, err := h.Queries.ListChannelsForUser(r.Context(), pgtype.UUID{Bytes: id, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudieron leer los canales")
		return
	}
	dtos := make([]channelDTO, 0, len(chans))
	for _, c := range chans {
		dtos = append(dtos, h.toChannelDTO(c))
	}
	writeData(w, http.StatusOK, dtos)
}

func (h *DirectoryHandler) AddUserChannel(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	var req channelInput
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	clean, problem := normalizeChannel(req)
	if problem != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-channel", problem)
		return
	}
	enc, err := h.Crypto.Encrypt(clean.Value)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo cifrar el canal")
		return
	}
	if clean.Preferred {
		if err := h.Queries.ClearPreferredUserChannel(ctx, pgtype.UUID{Bytes: id, Valid: true}); err != nil {
			problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo actualizar el canal preferido")
			return
		}
	}
	ch, err := h.Queries.CreateUserChannel(ctx, db.CreateUserChannelParams{
		UserID: pgtype.UUID{Bytes: id, Valid: true}, ChannelType: db.ContactChannelType(clean.ChannelType),
		ValueEncrypted: enc, Label: nonEmptyText(clean.Label), Preferred: clean.Preferred,
	})
	if isForeignKeyViolation(err) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "usuario no encontrado")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo crear el canal")
		return
	}
	h.AuditLog.Log(ctx, "user.channel.create", audit.LevelInfo, audit.Success(), map[string]any{"userId": id.String(), "channelType": clean.ChannelType})
	writeData(w, http.StatusCreated, h.toChannelDTO(ch))
}

func (h *DirectoryHandler) DeleteUserChannel(w http.ResponseWriter, r *http.Request) {
	id, err1 := uuid.Parse(r.PathValue("id"))
	channelID, err2 := uuid.Parse(r.PathValue("channelId"))
	if err1 != nil || err2 != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "id inválido")
		return
	}
	n, err := h.Queries.DeleteUserChannel(r.Context(), db.DeleteUserChannelParams{ID: channelID, UserID: pgtype.UUID{Bytes: id, Valid: true}})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar el canal")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "canal no encontrado")
		return
	}
	writeNoContent(w)
}

// ===== Import CSV (HU-DIR-2) =====

type importCSVResult struct {
	ImportedCount int                  `json:"importedCount"`
	UpdatedCount  int                  `json:"updatedCount"`
	Errors        []directory.RowError `json:"errors"`
}

// ImportCSV es POST /api/directory/import-csv (multipart: file, y opcional
// organizationId como organización por defecto para filas sin "Empresa").
// Upsert por correo (índice ciego) o por nombre+organización, como el legacy.
// Una fila con error se reporta y se omite; nunca aborta el resto.
func (h *DirectoryHandler) ImportCSV(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	r.Body = http.MaxBytesReader(w, r.Body, maxCSVBytes+64<<10)
	if err := r.ParseMultipartForm(maxCSVBytes); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "adjunta el CSV en el campo 'file' (máximo 2MB)")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "falta el archivo en el campo 'file'")
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxCSVBytes+1))
	if err != nil || len(raw) > maxCSVBytes {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "el archivo supera los 2MB")
		return
	}

	var defaultOrg *uuid.UUID
	if v := r.FormValue("organizationId"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "organizationId inválido")
			return
		}
		if _, err := h.Queries.GetOrganization(ctx, id); err != nil {
			problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "la organización por defecto no existe")
			return
		}
		defaultOrg = &id
	}

	rows, parseErrors := directory.ParseCSV(string(raw))
	if len(rows) == 0 {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-csv", "no se encontraron filas válidas para importar"+firstRowError(parseErrors))
		return
	}
	res := importCSVResult{Errors: append([]directory.RowError{}, parseErrors...)}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo abrir la transacción")
		return
	}
	defer tx.Rollback(ctx)
	orgCache := map[string]uuid.UUID{}

	for _, row := range rows {
		created, rowErr := h.importRow(ctx, tx, row, defaultOrg, orgCache)
		switch {
		case rowErr != "":
			res.Errors = append(res.Errors, directory.RowError{Line: row.Line, Reason: rowErr})
		case created:
			res.ImportedCount++
		default:
			res.UpdatedCount++
		}
	}
	if err := tx.Commit(ctx); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo confirmar la importación")
		return
	}
	level := audit.LevelInfo
	if len(res.Errors) > 0 {
		level = audit.LevelWarn
	}
	h.AuditLog.Log(ctx, "directory.import_csv", level, audit.Success(), map[string]any{
		"importedCount": res.ImportedCount, "updatedCount": res.UpdatedCount, "errorCount": len(res.Errors),
	})
	writeData(w, http.StatusOK, res)
}

func firstRowError(errs []directory.RowError) string {
	if len(errs) == 0 {
		return ""
	}
	return ": " + errs[0].Reason
}

// importRow procesa una fila en su propio savepoint: si falla, se deshace
// sola sin abortar la transacción del resto del archivo.
func (h *DirectoryHandler) importRow(ctx context.Context, tx pgx.Tx, row directory.Row, defaultOrg *uuid.UUID, orgCache map[string]uuid.UUID) (created bool, rowErr string) {
	sp, err := tx.Begin(ctx)
	if err != nil {
		return false, "error interno"
	}
	defer sp.Rollback(ctx)
	q := db.New(sp)

	var orgID uuid.UUID
	switch {
	case row.Organization != "":
		key := strings.ToLower(row.Organization)
		if cached, ok := orgCache[key]; ok {
			orgID = cached
		} else {
			org, err := q.FindOrganizationByNameOrCode(ctx, row.Organization)
			if err != nil {
				return false, "la organización '" + row.Organization + "' no existe (créala primero o usa su código)"
			}
			orgID, orgCache[key] = org.ID, org.ID
		}
	case defaultOrg != nil:
		orgID = *defaultOrg
	default:
		return false, "sin organización: completa la columna Empresa o elige una organización por defecto"
	}

	var existingID uuid.UUID
	var existingSource db.ContactSource
	found := false
	if row.Email != "" {
		if c, err := q.FindContactByEmailHash(ctx, pgtype.Text{String: h.Crypto.BlindIndex(row.Email), Valid: true}); err == nil {
			existingID, existingSource, found = c.ID, c.Source, true
		}
	}
	if !found {
		if c, err := q.FindContactByNameAndOrg(ctx, db.FindContactByNameAndOrgParams{OrganizationID: orgID, Name: row.Name}); err == nil {
			existingID, existingSource, found = c.ID, c.Source, true
		}
	}
	if found && existingSource == db.ContactSourceUserSync {
		return false, "contacto sincronizado desde Usuarios: no se actualiza por CSV"
	}

	scope := db.ContactScope(row.Scope)
	contactID := existingID
	if found {
		fav := row.IsFavorite
		if _, err := q.UpdateContact(ctx, db.UpdateContactParams{
			ID: existingID, OrganizationID: pgtype.UUID{Bytes: orgID, Valid: true}, Name: pgtype.Text{String: row.Name, Valid: true},
			Position: nonEmptyText(&row.Position), Specialty: nonEmptyText(&row.Specialty),
			Scope: db.NullContactScope{ContactScope: scope, Valid: true}, IsFavorite: optionalBool(&fav),
		}); err != nil {
			return false, "no se pudo actualizar: " + err.Error()
		}
	} else {
		contactID, err = q.CreateContact(ctx, db.CreateContactParams{
			OrganizationID: orgID, Name: row.Name, Position: nonEmptyText(&row.Position), Specialty: nonEmptyText(&row.Specialty),
			Scope: scope, Source: db.ContactSourceCsvImport, IsFavorite: row.IsFavorite,
		})
		if err != nil {
			return false, "no se pudo crear: " + err.Error()
		}
	}
	for kind, value := range map[string]string{"email": row.Email, "phone": row.Phone} {
		if value != "" {
			if err := h.setPrimaryValue(ctx, q, contactID, kind, value); err != nil {
				return false, err.Error()
			}
		}
	}
	if err := h.syncPrimaryChannels(ctx, q, contactID); err != nil {
		return false, "error interno al indexar canales"
	}
	if err := sp.Commit(ctx); err != nil {
		return false, "error interno"
	}
	return !found, ""
}

// ===== Consolidación de duplicados =====

type mergeResult struct {
	ConsolidatedCount int `json:"consolidatedCount"`
	MergedContacts    int `json:"mergedContacts"`
}

// MergeDuplicates es POST /api/directory/merge-duplicates (admin): une
// contactos con el mismo correo, el mismo teléfono (índices ciegos) o el
// mismo nombre dentro de la misma organización (directory.GroupDuplicates).
// El principal es el más completo (a igualdad, el más antiguo; y siempre el
// sincronizado desde Usuarios si hay uno). Los demás le ceden canales y
// membresías de equipo y quedan desactivados (no se borran).
func (h *DirectoryHandler) MergeDuplicates(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var res mergeResult
	err := h.inTx(ctx, func(q *db.Queries) error {
		list, err := q.ListContactsForDedupe(ctx)
		if err != nil {
			return err
		}
		byID := map[string]db.ListContactsForDedupeRow{}
		records := make([]directory.Record, 0, len(list))
		for _, c := range list {
			byID[c.ID.String()] = c
			records = append(records, directory.Record{
				ID: c.ID.String(), EmailHash: c.EmailHash.String, PhoneHash: c.PhoneHash.String,
				NormName: directory.NormalizeName(c.Name), OrganizationID: c.OrganizationID.String(),
			})
		}
		for _, group := range directory.GroupDuplicates(records) {
			primary := byID[group[0]]
			for _, id := range group[1:] {
				c := byID[id]
				better := c.Completeness > primary.Completeness
				if primary.Source != db.ContactSourceUserSync && (c.Source == db.ContactSourceUserSync || better) {
					primary = c
				}
			}
			for _, id := range group {
				dup := byID[id]
				if dup.ID == primary.ID {
					continue
				}
				if err := q.FillContactFromDuplicate(ctx, db.FillContactFromDuplicateParams{PrimaryID: primary.ID, DuplicateID: dup.ID}); err != nil {
					return err
				}
				if err := q.MoveContactChannels(ctx, db.MoveContactChannelsParams{PrimaryID: pgtype.UUID{Bytes: primary.ID, Valid: true}, DuplicateID: pgtype.UUID{Bytes: dup.ID, Valid: true}}); err != nil {
					return err
				}
				if err := q.MoveTeamMemberships(ctx, db.MoveTeamMembershipsParams{PrimaryID: pgtype.UUID{Bytes: primary.ID, Valid: true}, DuplicateID: pgtype.UUID{Bytes: dup.ID, Valid: true}}); err != nil {
					return err
				}
				if err := q.DeactivateLeftoverMemberships(ctx, pgtype.UUID{Bytes: dup.ID, Valid: true}); err != nil {
					return err
				}
				if _, err := q.SoftDeleteContact(ctx, dup.ID); err != nil {
					return err
				}
				res.MergedContacts++
			}
			if err := h.dedupeChannels(ctx, q, primary.ID); err != nil {
				return err
			}
			if err := h.syncPrimaryChannels(ctx, q, primary.ID); err != nil {
				return err
			}
			res.ConsolidatedCount++
		}
		return nil
	})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo consolidar el directorio")
		return
	}
	h.AuditLog.Log(ctx, "directory.merge_duplicates", audit.LevelWarn, audit.Success(), map[string]any{
		"consolidatedCount": res.ConsolidatedCount, "mergedContacts": res.MergedContacts,
	})
	writeData(w, http.StatusOK, res)
}

// dedupeChannels quita canales repetidos (mismo tipo y valor normalizado) que
// quedan al juntar dos contactos que tenían el mismo correo o teléfono.
func (h *DirectoryHandler) dedupeChannels(ctx context.Context, q *db.Queries, contactID uuid.UUID) error {
	chans, err := q.ListChannelsForContacts(ctx, []uuid.UUID{contactID})
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, c := range chans {
		value := h.decrypt(pgtype.Text{String: c.ValueEncrypted, Valid: true})
		key := string(c.ChannelType) + "|" + directory.NormalizeEmail(value)
		if isPhoneChannel(string(c.ChannelType)) {
			key = string(c.ChannelType) + "|" + directory.NormalizePhone(value)
		}
		if seen[key] {
			if _, err := q.DeleteContactChannel(ctx, db.DeleteContactChannelParams{ID: c.ID, ContactID: pgtype.UUID{Bytes: contactID, Valid: true}}); err != nil {
				return err
			}
			continue
		}
		seen[key] = true
	}
	return nil
}
