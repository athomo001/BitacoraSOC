package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/audit"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/directory"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/problemdetails"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
)

// RACI por cliente (paridad con el legacy: Escalamiento → Matriz RACI y
// Administración → RACI). Una actividad (tópico, actividad, notas) tiene sus
// letras R/A/C/I; cada letra apunta a un equipo: una persona (equipo «raci»
// de un contacto del directorio), una lista de correo o una guardia.

var raciRoles = []string{"responsible", "accountable", "consulted", "informed"}

type raciMemberDTO struct {
	Name     string               `json:"name"`
	Channels []resolvedChannelDTO `json:"channels"`
}

type raciTeamDTO struct {
	ID      uuid.UUID       `json:"id"`
	Name    string          `json:"name"`
	Kind    string          `json:"kind"`
	Members []raciMemberDTO `json:"members"`
}

type raciActivityDTO struct {
	ID         uuid.UUID                `json:"id"`
	ClientID   uuid.UUID                `json:"clientId"`
	ClientName string                   `json:"clientName"`
	Topic      string                   `json:"topic"`
	Activity   string                   `json:"activity"`
	Notes      string                   `json:"notes"`
	Letters    map[string][]raciTeamDTO `json:"letters"`
}

// ListRaci es GET /api/raci?clientId=: las actividades con sus letras y,
// por equipo, sus integrantes con correo y teléfono (para copiar o llamar).
func (h *EscalationHandler) ListRaci(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	client, err := queryUUID(r.URL.Query().Get("clientId"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-parameter", "clientId inválido")
		return
	}
	acts, err := h.Queries.ListRaciActivities(ctx, client)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el RACI")
		return
	}
	out, err := h.raciDTOs(ctx, acts)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el RACI")
		return
	}
	writeData(w, http.StatusOK, out)
}

func (h *EscalationHandler) raciDTOs(ctx context.Context, acts []db.ListRaciActivitiesRow) ([]raciActivityDTO, error) {
	out := make([]raciActivityDTO, 0, len(acts))
	if len(acts) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, len(acts))
	for i, a := range acts {
		ids[i] = a.ID
	}
	letters, err := h.Queries.ListRaciLetters(ctx, ids)
	if err != nil {
		return nil, err
	}
	teams, err := h.raciTeams(ctx, letters)
	if err != nil {
		return nil, err
	}
	byActivity := map[uuid.UUID]map[string][]raciTeamDTO{}
	for _, l := range letters {
		if byActivity[l.ActivityID] == nil {
			byActivity[l.ActivityID] = map[string][]raciTeamDTO{}
		}
		byActivity[l.ActivityID][string(l.Role)] = append(byActivity[l.ActivityID][string(l.Role)], teams[l.TeamID])
	}
	for _, a := range acts {
		dto := raciActivityDTO{ID: a.ID, ClientID: a.ClientID, ClientName: a.ClientName, Topic: a.Topic, Activity: a.Activity, Notes: a.Notes,
			Letters: map[string][]raciTeamDTO{}}
		for _, role := range raciRoles {
			dto.Letters[role] = byActivity[a.ID][role]
			if dto.Letters[role] == nil {
				dto.Letters[role] = []raciTeamDTO{}
			}
		}
		out = append(out, dto)
	}
	return out, nil
}

// raciTeams arma cada equipo con sus integrantes y sus canales descifrados.
func (h *EscalationHandler) raciTeams(ctx context.Context, letters []db.ListRaciLettersRow) (map[uuid.UUID]raciTeamDTO, error) {
	teams := map[uuid.UUID]raciTeamDTO{}
	var teamIDs []uuid.UUID
	for _, l := range letters {
		if _, ok := teams[l.TeamID]; !ok {
			teams[l.TeamID] = raciTeamDTO{ID: l.TeamID, Name: l.TeamName, Kind: l.TeamKind, Members: []raciMemberDTO{}}
			teamIDs = append(teamIDs, l.TeamID)
		}
	}
	if len(teamIDs) == 0 {
		return teams, nil
	}
	members, err := h.Queries.ListMembersForTeams(ctx, teamIDs)
	if err != nil {
		return nil, err
	}
	channels, err := h.raciChannels(ctx, members)
	if err != nil {
		return nil, err
	}
	for _, m := range members {
		owner := m.ContactID
		if !owner.Valid {
			owner = m.UserID
		}
		t := teams[m.TeamID]
		chans := channels[uuid.UUID(owner.Bytes)]
		if chans == nil {
			chans = []resolvedChannelDTO{}
		}
		t.Members = append(t.Members, raciMemberDTO{Name: m.Name, Channels: chans})
		teams[m.TeamID] = t
	}
	return teams, nil
}

// raciChannels descifra los canales (correo, teléfono…) de cada integrante,
// por contacto o por usuario.
func (h *EscalationHandler) raciChannels(ctx context.Context, members []db.ListMembersForTeamsRow) (map[uuid.UUID][]resolvedChannelDTO, error) {
	var contactIDs, userIDs []uuid.UUID
	for _, m := range members {
		if m.ContactID.Valid {
			contactIDs = append(contactIDs, uuid.UUID(m.ContactID.Bytes))
		}
		if m.UserID.Valid {
			userIDs = append(userIDs, uuid.UUID(m.UserID.Bytes))
		}
	}
	var chans []db.ContactChannel
	if len(contactIDs) > 0 {
		c, err := h.Queries.ListChannelsForContacts(ctx, contactIDs)
		if err != nil {
			return nil, err
		}
		chans = append(chans, c...)
	}
	if len(userIDs) > 0 {
		c, err := h.Queries.ListChannelsForUsers(ctx, userIDs)
		if err != nil {
			return nil, err
		}
		chans = append(chans, c...)
	}
	out := map[uuid.UUID][]resolvedChannelDTO{}
	for _, c := range chans {
		owner := c.ContactID
		if !owner.Valid {
			owner = c.UserID
		}
		value, err := h.Crypto.Decrypt(c.ValueEncrypted)
		if err != nil {
			continue
		}
		out[uuid.UUID(owner.Bytes)] = append(out[uuid.UUID(owner.Bytes)], resolvedChannelDTO{
			ChannelType: string(c.ChannelType), Value: value, Label: textPtr(c.Label), Preferred: c.Preferred,
			Href: channelHref(string(c.ChannelType), value),
		})
	}
	return out, nil
}

const (
	msgRaciNotFound = "actividad RACI no encontrada"
	msgRaciSave     = "no se pudo guardar la actividad"
)

type raciRequest struct {
	ClientID    uuid.UUID   `json:"clientId"`
	Topic       string      `json:"topic"`
	Activity    string      `json:"activity"`
	Notes       string      `json:"notes"`
	Responsible []uuid.UUID `json:"responsible"`
	Accountable []uuid.UUID `json:"accountable"`
	Consulted   []uuid.UUID `json:"consulted"`
	Informed    []uuid.UUID `json:"informed"`
}

func (req *raciRequest) clean() string {
	req.Topic = directory.Sanitize(req.Topic, 180)
	req.Activity = directory.Sanitize(req.Activity, 300)
	req.Notes = strings.TrimSpace(req.Notes)
	switch {
	case req.ClientID == uuid.Nil:
		return "elige el cliente"
	case req.Activity == "":
		return "escribe la actividad"
	case len([]rune(req.Notes)) > 2000:
		return "las notas no pueden pasar de 2000 caracteres"
	case len(req.Responsible) == 0:
		return "falta quién es responsable (R)"
	case len(req.Accountable) != 1:
		return "tiene que haber un solo aprobador (A)"
	}
	return ""
}

func (req raciRequest) letters() map[string][]uuid.UUID {
	return map[string][]uuid.UUID{"responsible": req.Responsible, "accountable": req.Accountable, "consulted": req.Consulted, "informed": req.Informed}
}

// CreateRaci es POST /api/raci (admin).
func (h *EscalationHandler) CreateRaci(w http.ResponseWriter, r *http.Request) {
	h.saveRaci(w, r, uuid.Nil)
}

// UpdateRaci es PUT /api/raci/{id} (admin): reemplaza la actividad y sus letras.
func (h *EscalationHandler) UpdateRaci(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", msgRaciNotFound)
		return
	}
	h.saveRaci(w, r, id)
}

func (h *EscalationHandler) saveRaci(w http.ResponseWriter, r *http.Request, id uuid.UUID) {
	ctx := r.Context()
	var req raciRequest
	if err := decodeJSON(w, r, &req); err != nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "cuerpo de la request inválido")
		return
	}
	if msg := req.clean(); msg != "" {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", msg)
		return
	}
	creating := id == uuid.Nil
	ok := h.raciTx(w, r, func(q *db.Queries) (int, string) {
		var status int
		var msg string
		id, status, msg = writeRaci(ctx, q, id, req)
		return status, msg
	})
	if !ok {
		return
	}
	action, status := "raci.update", http.StatusOK
	if creating {
		action, status = "raci.create", http.StatusCreated
	}
	h.AuditLog.Log(ctx, action, audit.LevelInfo, audit.Success(), map[string]any{"raciId": id.String(), "clientId": req.ClientID.String(), "activity": req.Activity})
	acts, err := h.Queries.ListRaciActivities(ctx, pgtype.UUID{Bytes: req.ClientID, Valid: true})
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "se guardó, pero no se pudo leer de vuelta")
		return
	}
	dtos, err := h.raciDTOs(ctx, acts)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "se guardó, pero no se pudo leer de vuelta")
		return
	}
	for _, d := range dtos {
		if d.ID == id {
			writeData(w, status, d)
			return
		}
	}
	writeData(w, status, map[string]any{"id": id})
}

// writeRaci crea (id nulo) o reemplaza la actividad y sus letras. Devuelve el
// id y, si falla, el código y el mensaje para el usuario.
func writeRaci(ctx context.Context, q *db.Queries, id uuid.UUID, req raciRequest) (uuid.UUID, int, string) {
	if id == uuid.Nil {
		newID, err := q.CreateRaciActivity(ctx, db.CreateRaciActivityParams{ClientID: req.ClientID, Topic: req.Topic, Activity: req.Activity, Notes: req.Notes})
		if isForeignKeyViolation(err) {
			return id, http.StatusBadRequest, "el cliente no existe"
		}
		if err != nil {
			return id, http.StatusInternalServerError, msgRaciSave
		}
		id = newID
	} else {
		n, err := q.UpdateRaciActivity(ctx, db.UpdateRaciActivityParams{ID: id, ClientID: req.ClientID, Topic: req.Topic, Activity: req.Activity, Notes: req.Notes})
		switch {
		case isForeignKeyViolation(err):
			return id, http.StatusBadRequest, "el cliente no existe"
		case err != nil:
			return id, http.StatusInternalServerError, msgRaciSave
		case n == 0:
			return id, http.StatusNotFound, msgRaciNotFound
		}
		if err := q.ClearRaciLetters(ctx, id); err != nil {
			return id, http.StatusInternalServerError, msgRaciSave
		}
	}
	status, msg := addRaciLetters(ctx, q, id, req.letters())
	return id, status, msg
}

func addRaciLetters(ctx context.Context, q *db.Queries, id uuid.UUID, letters map[string][]uuid.UUID) (int, string) {
	for _, role := range raciRoles {
		for _, team := range letters[role] {
			err := q.AddRaciLetter(ctx, db.AddRaciLetterParams{ActivityID: id, Role: db.RaciRole(role), TeamID: team})
			if isForeignKeyViolation(err) {
				return http.StatusBadRequest, "uno de los equipos elegidos ya no existe"
			}
			if err != nil {
				return http.StatusInternalServerError, msgRaciSave
			}
		}
	}
	return 0, ""
}

// raciTx corre fn en una transacción; si devuelve un mensaje, responde con
// su código (400, 404 o 500) y deshace todo.
func (h *EscalationHandler) raciTx(w http.ResponseWriter, r *http.Request, fn func(q *db.Queries) (int, string)) bool {
	tx, err := h.DB.Begin(r.Context())
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo iniciar la transacción")
		return false
	}
	defer func() { _ = tx.Rollback(r.Context()) }()
	if status, msg := fn(h.Queries.WithTx(tx)); msg != "" {
		code := map[int]string{http.StatusBadRequest: "invalid-payload", http.StatusNotFound: "not-found"}[status]
		if code == "" {
			code = "internal-error"
		}
		problemdetails.Write(w, r, status, code, msg)
		return false
	}
	if err := tx.Commit(r.Context()); err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo guardar")
		return false
	}
	return true
}

// DeleteRaci es DELETE /api/raci/{id} (admin). Los equipos quedan: pueden
// estar en otras actividades o en el escalamiento.
func (h *EscalationHandler) DeleteRaci(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", msgRaciNotFound)
		return
	}
	n, err := h.Queries.DeleteRaciActivity(r.Context(), id)
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo eliminar la actividad")
		return
	}
	if n == 0 {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", msgRaciNotFound)
		return
	}
	h.AuditLog.Log(r.Context(), "raci.delete", audit.LevelInfo, audit.Success(), map[string]any{"raciId": id.String()})
	w.WriteHeader(http.StatusNoContent)
}

// RaciPerson es POST /api/raci/people (admin): el equipo «raci» de un
// contacto del directorio, para ponerlo en una letra. Si ya existe se
// reutiliza; si no, se crea con el contacto como único integrante.
func (h *EscalationHandler) RaciPerson(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var req struct {
		ContactID uuid.UUID `json:"contactId"`
	}
	if err := decodeJSON(w, r, &req); err != nil || req.ContactID == uuid.Nil {
		problemdetails.Write(w, r, http.StatusBadRequest, "invalid-payload", "contactId es obligatorio")
		return
	}
	if team, err := h.Queries.FindRaciTeamForContact(ctx, pgtype.UUID{Bytes: req.ContactID, Valid: true}); err == nil {
		writeData(w, http.StatusOK, map[string]any{"id": team.ID, "name": team.Name, "kind": "raci"})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo buscar el equipo")
		return
	}
	contact, err := h.Queries.GetDirectoryContact(ctx, req.ContactID)
	if errors.Is(err, pgx.ErrNoRows) {
		problemdetails.Write(w, r, http.StatusNotFound, "not-found", "el contacto no existe")
		return
	}
	if err != nil {
		problemdetails.Write(w, r, http.StatusInternalServerError, "internal-error", "no se pudo leer el contacto")
		return
	}
	var team db.Team
	ok := h.raciTx(w, r, func(q *db.Queries) (int, string) {
		slug := "raci-" + slugify(contact.Name)
		if len(slug) > 40 {
			slug = slug[:40]
		}
		slug += "-" + req.ContactID.String()[:8]
		team, err = q.CreateTeam(ctx, db.CreateTeamParams{Name: contact.Name, Slug: slug, Kind: "raci",
			OrganizationID: pgtype.UUID{Bytes: contact.OrganizationID, Valid: true}, Audience: db.TeamAudienceClient})
		if err != nil {
			return http.StatusInternalServerError, "no se pudo crear el equipo de la persona"
		}
		if _, err := q.AddTeamMember(ctx, db.AddTeamMemberParams{TeamID: team.ID, ContactID: pgtype.UUID{Bytes: req.ContactID, Valid: true},
			RecipientType: db.RecipientTypeTo, RoleInTeam: db.TeamRolePrimary}); err != nil {
			return http.StatusInternalServerError, "no se pudo agregar a la persona al equipo"
		}
		return 0, ""
	})
	if !ok {
		return
	}
	h.AuditLog.Log(ctx, "raci.person", audit.LevelInfo, audit.Success(), map[string]any{"teamId": team.ID.String(), "contactId": req.ContactID.String()})
	writeData(w, http.StatusCreated, map[string]any{"id": team.ID, "name": team.Name, "kind": "raci"})
}
