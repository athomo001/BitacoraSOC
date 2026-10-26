package forward

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/crypto"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	batchRows   = 200
	maxBatches  = 10               // por destino y por vuelta: hasta 2000 eventos
	tickBudget  = 20 * time.Second // el préstamo dura 30 s
	maxBackoff  = 5 * time.Minute
	downAfter   = 15 * time.Minute // tras esto sin poder enviar, aviso en la campana
	purgeEvery  = 5 * time.Minute
	maxErrorLen = 500
)

// Worker recorre la cola para cada destino encendido. Corre en todos los
// nodos; el préstamo de cada destino asegura que lo envía uno solo.
type Worker struct {
	Queries *db.Queries
	Crypto  *crypto.Box
	Logger  *slog.Logger
	// Owner identifica a este nodo en el préstamo.
	Owner string
	// Hostname va en RFC 5424.
	Hostname string
	// Alert avisa a los administradores que un destino se cayó (down) o volvió.
	Alert func(ctx context.Context, down bool, d db.ForwardDestination, detail string)
	Now   func() time.Time

	lastPurge time.Time
}

func (w *Worker) now() time.Time {
	if w.Now != nil {
		return w.Now()
	}
	return time.Now()
}

// Tick es una vuelta (cada pocos segundos).
func (w *Worker) Tick(ctx context.Context) error {
	ids, err := w.Queries.ListDueForwardDestinations(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		d, err := w.Queries.AcquireForwardLease(ctx, db.AcquireForwardLeaseParams{ID: id, Owner: pgtype.Text{String: w.Owner, Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			continue // lo tomó el otro nodo o ya no toca
		}
		if err != nil {
			return err
		}
		w.deliver(ctx, d)
		_ = w.Queries.ReleaseForwardLease(ctx, db.ReleaseForwardLeaseParams{ID: id, Owner: pgtype.Text{String: w.Owner, Valid: true}})
	}
	if w.now().Sub(w.lastPurge) >= purgeEvery {
		w.lastPurge = w.now()
		_, _ = w.Queries.PurgeForwardOutbox(ctx)
		_ = w.Queries.PurgeForwardStats(ctx)
	}
	return nil
}

func (w *Worker) today() pgtype.Date {
	n := w.now()
	return pgtype.Date{Time: time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
}

// Target descifra un destino para enviar.
func (w *Worker) Target(d db.ForwardDestination) (Target, error) {
	return TargetOf(d, w.Crypto, w.Hostname)
}

// TargetOf arma el destino descifrado (también lo usa «Probar»).
func TargetOf(d db.ForwardDestination, box *crypto.Box, hostname string) (Target, error) {
	t := Target{Transport: d.Transport, Host: d.Host.String, Port: int(d.Port.Int32), URL: d.Url.String, Format: d.Format,
		Batch: d.Batch, CACert: d.CaCert.String, ClientCert: d.ClientCert.String, Hostname: hostname}
	if d.ClientKeyEncrypted.Valid && d.ClientKeyEncrypted.String != "" {
		if box == nil {
			return t, errors.New("no hay llave de cifrado para leer la llave de cliente")
		}
		key, err := box.Decrypt(d.ClientKeyEncrypted.String)
		if err != nil {
			return t, errors.New("no se pudo descifrar la llave de cliente")
		}
		t.ClientKey = key
	}
	if d.HeadersEncrypted.Valid && d.HeadersEncrypted.String != "" {
		if box == nil {
			return t, errors.New("no hay llave de cifrado para leer las cabeceras")
		}
		raw, err := box.Decrypt(d.HeadersEncrypted.String)
		if err != nil {
			return t, errors.New("no se pudieron descifrar las cabeceras")
		}
		if err := json.Unmarshal([]byte(raw), &t.Headers); err != nil {
			return t, errors.New("las cabeceras guardadas no se pueden leer")
		}
	}
	if d.HmacSecretEncrypted.Valid && d.HmacSecretEncrypted.String != "" {
		if box == nil {
			return t, errors.New("no hay llave de cifrado para firmar los eventos")
		}
		secret, err := box.Decrypt(d.HmacSecretEncrypted.String)
		if err != nil {
			return t, errors.New("no se pudo descifrar el secreto de firma")
		}
		t.HMACSecret = secret
	}
	return t, nil
}

func (w *Worker) deliver(ctx context.Context, d db.ForwardDestination) {
	filter := func(cursor int64) db.ListForwardBatchParams {
		return db.ListForwardBatchParams{CursorID: cursor, SendAudit: d.SendAudit, MinRank: int32(Rank(d.AuditLevel)),
			SendEntries: d.SendEntries, SendEscalation: d.SendEscalation, SendTickets: d.SendTickets, MaxRows: batchRows, Events: d.Events}
	}
	cursor := d.CursorID
	f := filter(cursor)
	if exp, err := w.Queries.ExpiredForwardEvents(ctx, db.ExpiredForwardEventsParams{CursorID: cursor, SendAudit: f.SendAudit, MinRank: f.MinRank,
		SendEntries: f.SendEntries, SendEscalation: f.SendEscalation, SendTickets: f.SendTickets, Events: f.Events}); err == nil && exp.Lost > 0 {
		cursor = exp.LastID
		_ = w.Queries.AdvanceForwardCursor(ctx, db.AdvanceForwardCursorParams{ID: d.ID, CursorID: cursor})
		_ = w.Queries.AddForwardStats(ctx, db.AddForwardStatsParams{ID: d.ID, Day: w.today(), Lost: exp.Lost})
	}
	target, err := w.Target(d)
	if err != nil {
		w.fail(ctx, d, err)
		return
	}
	started := w.now()
	for range maxBatches {
		rows, err := w.Queries.ListForwardBatch(ctx, filter(cursor))
		if err != nil || len(rows) == 0 {
			return
		}
		msgs := make([]Message, len(rows))
		for i, r := range rows {
			msgs[i] = Message{Payload: r.Payload, Event: r.Event, Level: r.Level, TS: r.CreatedAt.Time}
		}
		sent, sendErr := Send(ctx, target, msgs)
		if sent > 0 {
			cursor = rows[sent-1].ID
			wasDown, _ := w.Queries.MarkForwardSent(ctx, db.MarkForwardSentParams{ID: d.ID, CursorID: cursor})
			_ = w.Queries.AddForwardStats(ctx, db.AddForwardStatsParams{ID: d.ID, Day: w.today(), Sent: int32(sent)})
			if wasDown && w.Alert != nil {
				w.Alert(ctx, false, d, "")
			}
			d.Failures, d.DownAlerted, d.FailingSince = 0, false, pgtype.Timestamptz{}
		}
		if sendErr != nil {
			w.fail(ctx, d, sendErr)
			return
		}
		if len(rows) < batchRows || w.now().Sub(started) > tickBudget {
			return
		}
	}
}

// Backoff: 1 s, 2 s, 4 s… hasta 5 minutos.
func Backoff(failures int32) time.Duration {
	d := time.Second
	for i := int32(0); i < failures && d < maxBackoff; i++ {
		d *= 2
	}
	return min(d, maxBackoff)
}

func (w *Worker) fail(ctx context.Context, d db.ForwardDestination, err error) {
	msg := err.Error()
	if len(msg) > maxErrorLen {
		msg = msg[:maxErrorLen]
	}
	row, qerr := w.Queries.MarkForwardFailed(ctx, db.MarkForwardFailedParams{ID: d.ID, Error: pgtype.Text{String: msg, Valid: true},
		NextAttemptAt: pgtype.Timestamptz{Time: w.now().Add(Backoff(d.Failures)), Valid: true}})
	if qerr != nil {
		return
	}
	if w.Logger != nil && d.Failures == 0 {
		w.Logger.Warn("forward: no se pudo enviar", "destination", d.Name, "error", msg)
	}
	if !row.DownAlerted && row.FailingSince.Valid && w.now().Sub(row.FailingSince.Time) >= downAfter {
		if err := w.Queries.SetForwardDownAlerted(ctx, d.ID); err == nil && w.Alert != nil {
			w.Alert(ctx, true, d, msg)
		}
	}
}

// Owner arma un identificador de nodo estable durante la vida del proceso.
func Owner(hostname string) string {
	return strings.TrimSpace(hostname) + "/" + uuid.NewString()[:8]
}
