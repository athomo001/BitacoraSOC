import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  OrgDeleteAction,
  OrgDependentKind,
  OrgDependents,
  Organization,
  OrganizationsService,
} from '../../core/organizations/organizations.service';
import { problemDetail } from '../../core/http-error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

export interface OrgDeleteData {
  org: Organization;
  dependents: OrgDependents;
  /** Organizaciones a las que se puede mover (todas menos la que se elimina). */
  targets: Organization[];
}

type Decision = { op: 'move'; to: string } | { op: 'delete' };

interface Row {
  kind: OrgDependentKind;
  id: string;
  name: string;
  code?: string;
  detail: string;
  deletable: boolean;
  /** Tickets: opcionales, si no se mueven quedan en el histórico. */
  optional: boolean;
  createdAt?: string;
}

interface Group {
  kind: OrgDependentKind;
  icon: string;
  title: MessageKey;
  hint: MessageKey;
  rows: Row[];
}

/**
 * Popup "Eliminar organización" (pedido del dueño 2026-10-05, canvas v22):
 * lo asociado se resuelve ahí mismo, sin salir de la página. Servicios,
 * equipos y activos se mueven, se renombran o se eliminan si no tienen
 * historial; los tickets se mueven solo si se quiere (si no, quedan en el
 * histórico con el nombre de la organización); los contactos no dependen de
 * ella. Nada se guarda hasta "Eliminar": todo va en una sola transacción.
 */
@Component({
  selector: 'app-org-delete-dialog',
  standalone: true,
  imports: [FormsModule, DatePipe, MatIconModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './org-delete-dialog.html',
  styleUrl: './org-delete-dialog.css',
})
export class OrgDeleteDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly data = inject<OrgDeleteData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);
  private readonly api = inject(OrganizationsService);

  protected readonly target = signal('');
  protected readonly decisions = signal<Record<string, Decision>>({});
  protected readonly renames = signal<Record<string, string>>({});
  protected readonly editing = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly groups: Group[] = (() => {
    const d = this.data.dependents;
    const rows = (kind: OrgDependentKind, items: OrgDependents['services']): Row[] =>
      items.map((i) => ({ kind, id: i.id, name: i.name, code: i.code, detail: i.detail, deletable: i.deletable, optional: false }));
    const all: Group[] = [
      { kind: 'service', icon: 'dns', title: 'orgDelete.services', hint: 'orgDelete.servicesHint', rows: rows('service', d.services) },
      { kind: 'team', icon: 'groups', title: 'orgDelete.teams', hint: 'orgDelete.teamsHint', rows: rows('team', d.teams) },
      { kind: 'asset', icon: 'router', title: 'orgDelete.assets', hint: 'orgDelete.assetsHint', rows: rows('asset', d.assets) },
      {
        kind: 'ticket', icon: 'confirmation_number', title: 'orgDelete.tickets', hint: 'orgDelete.ticketsHint',
        rows: d.tickets.map((t): Row => ({
          kind: 'ticket', id: t.id, name: `#${t.number} ${t.title}`, deletable: false, optional: true, createdAt: t.createdAt,
          detail: this.i18n.t(`tickets.status.${t.status}` as MessageKey),
        })),
      },
    ];
    return all.filter((g) => g.rows.length > 0);
  })();

  private readonly required = this.groups.flatMap((g) => g.rows).filter((r) => !r.optional);

  protected readonly targetName = computed(() => this.data.targets.find((o) => o.id === this.target())?.name ?? '');
  protected readonly pending = computed(() => {
    const decided = this.decisions();
    return this.required.filter((r) => !decided[r.id]).length;
  });

  protected contactsText(): string {
    return this.i18n.tf('orgDelete.contacts', this.data.dependents.contacts).replace('{org}', this.data.org.name);
  }

  protected displayName(row: Row): string {
    return this.renames()[row.id] ?? row.name;
  }

  protected decision(row: Row): Decision | undefined {
    return this.decisions()[row.id];
  }

  protected resultLabel(row: Row): string {
    const d = this.decision(row);
    if (!d) return '';
    if (d.op === 'delete') return this.i18n.t('orgDelete.deleted');
    return this.i18n.tf('orgDelete.movedTo', this.data.targets.find((o) => o.id === d.to)?.name ?? '');
  }

  protected move(row: Row): void {
    const to = this.target();
    if (!to) return;
    this.decisions.update((d) => ({ ...d, [row.id]: { op: 'move', to } }));
  }

  protected remove(row: Row): void {
    if (!row.deletable || row.optional) return;
    this.decisions.update((d) => ({ ...d, [row.id]: { op: 'delete' } }));
  }

  protected undo(row: Row): void {
    this.decisions.update((d) => {
      const next = { ...d };
      delete next[row.id];
      return next;
    });
  }

  protected startEdit(row: Row): void {
    this.editing.set(row.id);
    this.editName.set(this.displayName(row));
  }

  protected saveEdit(row: Row): void {
    const name = this.editName().trim();
    if (name && name !== row.name) this.renames.update((r) => ({ ...r, [row.id]: name }));
    else this.renames.update((r) => {
      const next = { ...r };
      delete next[row.id];
      return next;
    });
    this.editing.set(null);
  }

  protected close(): void {
    this.ref.close(false);
  }

  /** "Todo de una": mueve lo pendiente a la organización elegida y elimina. */
  protected async moveAllAndDelete(): Promise<void> {
    if (!this.target()) return;
    await this.submit(this.target());
  }

  protected async submit(moveTo?: string): Promise<void> {
    if (!moveTo && this.pending() > 0) return;
    const rows = this.groups.flatMap((g) => g.rows);
    const renames = this.renames();
    const decided = this.decisions();
    // Primero los nombres (se aplican mientras sigue en esta organización), después mover o eliminar.
    const actions: OrgDeleteAction[] = [
      ...rows.filter((r) => renames[r.id]).map((r): OrgDeleteAction => ({ kind: r.kind, id: r.id, op: 'rename', name: renames[r.id] })),
      ...rows
        .filter((r) => decided[r.id])
        .map((r): OrgDeleteAction => {
          const d = decided[r.id];
          return d.op === 'move' ? { kind: r.kind, id: r.id, op: 'move', to: d.to, name: this.displayName(r) } : { kind: r.kind, id: r.id, op: 'delete' };
        }),
    ];
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.remove(this.data.org.id, { actions, ...(moveTo ? { moveTo } : {}) });
      this.ref.close(true);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('orgs.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
