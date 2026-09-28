package reporting

import (
	"context"
	"sync"

	"github.com/athomo001/BitacoraSOC/backend-go/internal/repository/db"
	"github.com/athomo001/BitacoraSOC/backend-go/internal/service/mail"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type Dispatcher struct {
	Queries   *db.Queries
	Sender    func(context.Context) (*mail.Sender, error)
	Schedules func(context.Context, *mail.Sender) error
	mu        sync.Mutex
}

func (d *Dispatcher) DispatchPending(ctx context.Context) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	closures, err := d.Queries.ListPendingShiftClosures(ctx)
	if err != nil {
		return err
	}
	for _, closure := range closures {
		report := ShiftReport{TicketCount: int(closure.TicketsResolvedCount), IncidentCount: int(closure.TotalIncidents), SLABreaches: int(closure.SlaBreachesCount), PendingForNextShift: textValue(closure.PendingForNextShift), Observations: textValue(closure.Observations), ServicesDown: closure.ServicesDown}
		if !HasActivity(report) {
			_ = d.mark(ctx, closure.ID, "skipped", "reporte vacío")
			continue
		}
		// Destinatarios del TURNO (work_shifts.email_recipients), no todos los
		// usuarios activos: el reporte de un turno NOC no le llega a toda la empresa.
		shift, shiftErr := d.Queries.GetWorkShiftForCheck(ctx, closure.ClosureCheckID)
		if shiftErr != nil {
			_ = d.mark(ctx, closure.ID, "failed", "no se pudo cargar el turno del cierre")
			continue
		}
		recipients := Recipients(shift.EmailRecipients)
		if len(recipients) == 0 {
			_ = d.mark(ctx, closure.ID, "failed", "el turno "+shift.Name+" no tiene destinatarios de correo configurados")
			continue
		}
		sender, senderErr := d.Sender(ctx)
		if senderErr != nil {
			_ = d.mark(ctx, closure.ID, "failed", senderErr.Error())
			continue
		}
		if sendErr := sender.SendHTML(recipients, nil, "Reporte de turno", RenderShiftReportHTML(report)); sendErr != nil {
			_ = d.mark(ctx, closure.ID, "failed", sendErr.Error())
			continue
		}
		_ = d.mark(ctx, closure.ID, "success", "")
	}
	if d.Schedules != nil {
		if sender, senderErr := d.Sender(ctx); senderErr == nil {
			_ = d.Schedules(ctx, sender)
		}
	}
	return nil
}

func (d *Dispatcher) mark(ctx context.Context, id uuid.UUID, status, reason string) error {
	return d.Queries.MarkShiftClosureSent(ctx, db.MarkShiftClosureSentParams{ID: id, SentVia: "email", SentStatus: status, SentError: pgtype.Text{String: reason, Valid: reason != ""}})
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
