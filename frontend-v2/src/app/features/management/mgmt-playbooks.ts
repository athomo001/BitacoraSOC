import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActionKind, AgendaMeta, AgendaService } from '../../core/agenda/agenda.service';
import { ManagementService, MgmtClient, MgmtMeta, Playbook, PlaybookAnchor, PlaybookItem } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { PreferencesService } from '../../core/preferences/preferences.service';
import { problemDetail } from '../../core/http-error';
import { ACTION_KINDS, day, kindKey } from './mgmt-format';

const ANCHORS: PlaybookAnchor[] = ['apply', 'date', 'renewal'];

/**
 * Gestión → Plantillas (spec/16 §4.4): una lista de acciones con quién y
 * cuándo, relativa a una fecha. «Aplicar» crea tareas normales de la Agenda
 * para el cliente (la del CSM a cargo, las de un área para su nivel o su
 * guardia). Se pueden editar y crear nuevas; las que vienen con la app no se
 * eliminan.
 */
@Component({
  selector: 'app-mgmt-playbooks',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mgmt-playbooks.html',
  styleUrl: './mgmt-playbooks.css',
})
export class MgmtPlaybooksComponent {
  readonly meta = input.required<MgmtMeta>();
  readonly clients = input.required<MgmtClient[]>();
  readonly areas = input.required<{ id: string; name: string; resolves: boolean }[]>();
  /** Lo que pidió otra pestaña: el cliente y la plantilla (por su clave del sistema). */
  readonly clientId = input<string | null>(null);
  readonly playbook = input<string | null>(null);
  readonly applied = output<void>();

  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly agenda = inject(AgendaService);
  private readonly prefs = inject(PreferencesService);

  protected readonly anchors = ANCHORS;
  protected readonly kinds = ACTION_KINDS;
  protected readonly kindKey = kindKey;
  protected readonly list = signal<Playbook[]>([]);
  protected readonly selected = signal<string | null>(null);
  protected readonly client = signal('');
  protected readonly anchorDate = signal('');
  protected readonly result = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  /** Editor: la plantilla que se está editando (o una nueva). */
  protected readonly draft = signal<{ id?: string; system: boolean; name: string; description: string; anchor: PlaybookAnchor; items: PlaybookItem[] } | null>(null);
  protected readonly agendaMeta = signal<AgendaMeta | null>(null);

  protected readonly current = computed(() => this.list().find((p) => p.id === this.selected()) ?? null);
  protected readonly currentClient = computed(() => this.clients().find((c) => c.id === this.client()) ?? null);
  protected readonly noRenewal = computed(() => this.current()?.anchor === 'renewal' && !this.currentClient()?.renewal);

  constructor() {
    void this.load();
    effect(() => {
      const id = this.clientId();
      const list = this.clients();
      untracked(() => {
        if (id && list.some((c) => c.id === id)) this.client.set(id);
        else if (!this.client() && list[0]) this.client.set(list[0].id);
      });
    });
    effect(() => {
      const key = this.playbook();
      const list = this.list();
      untracked(() => {
        const want = key ? list.find((p) => p.systemKey === key || p.id === key) : null;
        if (want) this.select(want.id);
        else if (!this.selected() && list[0]) this.select(list[0].id);
      });
    });
  }

  private async load(): Promise<void> {
    try {
      this.list.set(await this.api.playbooks());
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
    }
  }

  protected select(id: string): void {
    this.selected.set(id);
    this.result.set(null);
    this.error.set(null);
    this.draft.set(null);
  }

  /** «CSM» / «SOC N2» / «Guardia SOC». */
  protected who(it: PlaybookItem): string {
    if (it.assignee === 'csm') return this.i18n.t('mg.pb.csm');
    if (it.assignee === 'guard') return it.teamName ?? '';
    return `${it.areaName ?? ''} ${it.levelName ?? ''}`.trim();
  }

  /** «día hábil 5» / «10 días hábiles antes» / «90 días antes» / «el día». */
  protected when(it: PlaybookItem, anchor: PlaybookAnchor): string {
    const n = Math.abs(it.offsetDays);
    if (anchor === 'apply' && it.offsetUnit === 'biz' && it.offsetDays > 0) return this.i18n.tf('mg.pb.bizDay', it.offsetDays);
    if (it.offsetDays === 0) return this.i18n.t('mg.pb.same');
    const key = `mg.pb.${it.offsetUnit}${it.offsetDays < 0 ? 'Before' : 'After'}` as MessageKey;
    return this.i18n.tf(key, n);
  }

  protected anchorKey(a: PlaybookAnchor): MessageKey {
    return `mg.pb.a.${a}` as MessageKey;
  }

  protected date(iso: string): string {
    return day(iso, this.prefs.language(), true);
  }

  protected async apply(): Promise<void> {
    const p = this.current();
    const c = this.currentClient();
    if (!p || !c || this.busy() || (p.anchor === 'date' && !this.anchorDate())) return;
    this.busy.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      await this.api.applyPlaybook(p.id, c.id, p.anchor === 'date' ? this.anchorDate() : undefined);
      this.result.set(this.i18n.tf('mg.pb.applied', c.name));
      this.applied.emit();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  // ===== Editor =====

  private async ensureAgendaMeta(): Promise<void> {
    if (this.agendaMeta()) return;
    try {
      this.agendaMeta.set(await this.agenda.meta());
    } catch {
      // Sin la lista de niveles y guardias, se edita solo lo del CSM.
    }
  }

  protected async edit(p: Playbook | null): Promise<void> {
    await this.ensureAgendaMeta();
    this.result.set(null);
    this.draft.set(p
      ? { id: p.id, system: !!p.systemKey, name: p.name, description: p.description, anchor: p.anchor, items: p.items.map((i) => ({ ...i })) }
      : { system: false, name: '', description: '', anchor: 'apply', items: [{ name: '', isKey: false, assignee: 'csm', offsetDays: 1, offsetUnit: 'biz' }] });
  }

  protected areaOptions() {
    return this.agendaMeta()?.areas ?? [];
  }

  protected levelsOf(areaId?: string) {
    return this.areaOptions().find((a) => a.id === areaId)?.levels ?? [];
  }

  protected guardsOf(areaId?: string) {
    return this.areaOptions().find((a) => a.id === areaId)?.guards ?? [];
  }

  protected patch(changes: Partial<{ name: string; description: string; anchor: PlaybookAnchor }>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
  }

  protected patchItem(i: number, changes: Partial<PlaybookItem>): void {
    this.draft.update((d) => (d ? { ...d, items: d.items.map((it, j) => (j === i ? { ...it, ...changes } : it)) } : d));
  }

  /** Quién: «csm», «level:<área>» o «guard:<área>». */
  protected setWho(i: number, value: string): void {
    const [kind, areaId] = value.split(':');
    if (kind === 'csm') this.patchItem(i, { assignee: 'csm', areaId: undefined, levelId: undefined, teamId: undefined });
    else if (kind === 'level') this.patchItem(i, { assignee: 'level', areaId, levelId: this.levelsOf(areaId)[0]?.id, teamId: undefined });
    else this.patchItem(i, { assignee: 'guard', areaId, teamId: this.guardsOf(areaId)[0]?.id, levelId: undefined });
  }

  protected whoValue(it: PlaybookItem): string {
    return it.assignee === 'csm' ? 'csm' : `${it.assignee}:${it.areaId ?? ''}`;
  }

  protected addItem(): void {
    this.draft.update((d) => (d ? { ...d, items: [...d.items, { name: '', isKey: false, assignee: 'csm', offsetDays: 0, offsetUnit: 'biz' }] } : d));
  }

  protected removeItem(i: number): void {
    this.draft.update((d) => (d ? { ...d, items: d.items.filter((_, j) => j !== i) } : d));
  }

  protected readonly draftValid = computed(() => {
    const d = this.draft();
    return !!d && !!d.name.trim() && d.items.length > 0 && d.items.every((it) => !!it.name.trim()
      && (it.assignee === 'csm' || (it.assignee === 'level' ? !!it.areaId && !!it.levelId : !!it.areaId && !!it.teamId)));
  });

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.draftValid() || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.api.savePlaybook({ id: d.id, name: d.name.trim(), description: d.description.trim(), anchor: d.anchor,
        items: d.items.map((it) => ({ ...it, name: it.name.trim(), actionKind: it.actionKind || undefined })) });
      await this.load();
      this.select(saved.id);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const d = this.draft();
    if (!d?.id || d.system || this.busy()) return;
    this.busy.set(true);
    try {
      await this.api.deletePlaybook(d.id);
      this.draft.set(null);
      this.selected.set(null);
      await this.load();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected kindOf(v: string): ActionKind | undefined {
    return (v || undefined) as ActionKind | undefined;
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement | HTMLSelectElement).value;
  }
}
