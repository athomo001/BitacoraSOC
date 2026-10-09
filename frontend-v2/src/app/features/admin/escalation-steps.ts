import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { EscalationPool, EscalationService, Policy, PolicyStep, StepInput, StepMode } from '../../core/escalation/escalation.service';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { TeamSummary } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';

const MODES: readonly StepMode[] = ['unique', 'sequential', 'pool'];

/** Lo que se busca para agregar a un llamado: contacto del Directorio o pool. */
interface PickOption { kind: 'contact' | 'pool'; id: string; name: string; detail: string; }

/** Lo que se guarda del llamado tal como está ahora. */
function inputOf(s: PolicyStep): StepInput {
  const base = { title: s.title, mode: s.mode, waitBeforeEscalateMinutes: s.waitBeforeEscalateMinutes };
  if (!s.ownPeople) return { ...base, teamId: s.teamId };
  const ids = (kind: string) => s.members.filter((m) => m.kind === kind).map((m) => m.refId);
  return { ...base, contactIds: ids('contact'), userIds: ids('user'), poolIds: ids('pool') };
}

/**
 * Llamados de una política (canvas "Equipos y llamados de escalamiento",
 * aprobado 2026-10-07): cada llamado elige personas del Directorio (o un pool)
 * o un equipo real (guardia, contrata…). Cada cambio se guarda al momento.
 * Las personas no se copian: si cambia un teléfono en el Directorio, cambia
 * en todas las políticas.
 */
@Component({
  selector: 'app-escalation-steps',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './escalation-steps.html',
  styleUrl: './escalation-steps.css',
})
export class EscalationStepsComponent {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(EscalationService);
  private readonly directory = inject(DirectoryService);

  readonly policy = input.required<Policy>();
  readonly teams = input<TeamSummary[]>([]);
  readonly pools = input<EscalationPool[]>([]);
  /** La política con sus llamados ya guardados. */
  readonly changed = output<Policy>();

  protected readonly modes = MODES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pickingId = signal<string | null>(null);
  protected readonly query = signal('');
  private readonly contacts = signal<DirectoryContact[]>([]);
  private searchTimer?: ReturnType<typeof setTimeout>;

  protected readonly options = computed<PickOption[]>(() => {
    const step = this.policy().steps.find((s) => s.id === this.pickingId());
    const taken = new Set(step?.members.map((m) => m.refId) ?? []);
    const q = this.query().trim().toLowerCase();
    const pools = q.length < 2 ? [] : this.pools()
      .filter((p) => p.active && `${p.name} ${p.organizationName ?? ''}`.toLowerCase().includes(q))
      .map((p) => ({ kind: 'pool' as const, id: p.id, name: p.name, detail: `${this.i18n.t('steps.pool')} · ${p.members}` }));
    const people = this.contacts().map((c) => ({ kind: 'contact' as const, id: c.id, name: c.name, detail: c.organizationName }));
    return [...people, ...pools].filter((o) => !taken.has(o.id)).slice(0, 12);
  });

  protected modeKey(mode: StepMode): MessageKey {
    return `escAdmin.mode.${mode}` as MessageKey;
  }

  protected modeHintKey(mode: StepMode): MessageKey {
    return `escAdmin.modeHint.${mode}` as MessageKey;
  }

  protected channelKey(channel: string): MessageKey {
    return `steps.channel.${channel}` as MessageKey;
  }

  protected openPicker(step: PolicyStep): void {
    this.pickingId.set(this.pickingId() === step.id ? null : step.id);
    this.query.set('');
    this.contacts.set([]);
  }

  protected search(value: string): void {
    this.query.set(value);
    clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.contacts.set([]);
      return;
    }
    this.searchTimer = setTimeout(async () => {
      try {
        this.contacts.set(await this.directory.search(value.trim()));
      } catch {
        this.contacts.set([]);
      }
    }, 250);
  }

  protected async pick(step: PolicyStep, option: PickOption): Promise<void> {
    const input = inputOf(step);
    if (option.kind === 'pool') input.poolIds = [...(input.poolIds ?? []), option.id];
    else input.contactIds = [...(input.contactIds ?? []), option.id];
    this.pickingId.set(null);
    await this.save(step, input);
  }

  protected async removeMember(step: PolicyStep, refId: string): Promise<void> {
    const input = inputOf(step);
    for (const key of ['contactIds', 'userIds', 'poolIds'] as const) {
      input[key] = input[key]?.filter((id) => id !== refId);
    }
    await this.save(step, input);
  }

  /** Personas propias ↔ un equipo real. Al pasar a equipo se elige el primero disponible. */
  protected async setSource(step: PolicyStep, own: boolean): Promise<void> {
    if (own === step.ownPeople) return;
    const { title, mode, waitBeforeEscalateMinutes } = inputOf(step);
    if (own) {
      await this.save(step, { title, mode, waitBeforeEscalateMinutes, contactIds: [] });
      return;
    }
    const team = this.teams()[0];
    if (team) await this.save(step, { title, mode, waitBeforeEscalateMinutes, teamId: team.id });
  }

  protected async setTeam(step: PolicyStep, teamId: string): Promise<void> {
    if (teamId && teamId !== step.teamId) await this.save(step, { ...inputOf(step), teamId });
  }

  protected async setTitle(step: PolicyStep, title: string): Promise<void> {
    if (title.trim() && title.trim() !== step.title) await this.save(step, { ...inputOf(step), title: title.trim() });
  }

  protected async setWait(step: PolicyStep, value: string): Promise<void> {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    if (minutes !== step.waitBeforeEscalateMinutes) await this.save(step, { ...inputOf(step), waitBeforeEscalateMinutes: minutes });
  }

  protected async setMode(step: PolicyStep, mode: StepMode): Promise<void> {
    if (mode !== step.mode) await this.save(step, { ...inputOf(step), mode });
  }

  protected async move(step: PolicyStep, delta: -1 | 1): Promise<void> {
    const ids = this.policy().steps.map((s) => s.id);
    const i = ids.indexOf(step.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await this.run(async () => this.changed.emit(await this.api.reorderSteps(this.policy().id, ids)));
  }

  protected async remove(step: PolicyStep): Promise<void> {
    await this.run(async () => {
      await this.api.deleteStep(this.policy().id, step.stepOrder);
      const policy = this.policy();
      this.changed.emit({ ...policy, steps: policy.steps.filter((s) => s.id !== step.id).map((s, i) => ({ ...s, stepOrder: i + 1 })) });
    });
  }

  protected async add(): Promise<void> {
    const n = this.policy().steps.length + 1;
    await this.run(async () => {
      const policy = await this.api.addStep(this.policy().id, { title: this.i18n.tf('steps.defaultTitle', n), mode: 'unique', waitBeforeEscalateMinutes: 10, contactIds: [] });
      this.changed.emit(policy);
      const added = policy.steps.at(-1);
      if (added) this.openPicker(added);
    });
  }

  private async save(step: PolicyStep, input: StepInput): Promise<void> {
    await this.run(async () => this.changed.emit(await this.api.updateStep(this.policy().id, step.id, input)));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('escAdmin.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
