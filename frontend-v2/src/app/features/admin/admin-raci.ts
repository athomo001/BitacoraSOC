import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { DirectoryContact, DirectoryService } from '../../core/directory/directory.service';
import { Organization, OrganizationsService, TeamSummary } from '../../core/organizations/organizations.service';
import { RACI_ROLES, RaciActivity, RaciForm, RaciRole, RaciService } from '../../core/raci/raci.service';
import { RaciTableComponent } from '../../shared/raci/raci-table';

import '../../core/i18n/packs/raci';

interface Pick {
  id: string;
  name: string;
}

interface Draft {
  id: string | null;
  clientId: string;
  topic: string;
  activity: string;
  notes: string;
  letters: Record<RaciRole, Pick[]>;
}

const emptyLetters = (): Record<RaciRole, Pick[]> => ({ responsible: [], accountable: [], consulted: [], informed: [] });

/**
 * Administración → RACI (paridad con «Matriz RACI por Cliente» del legacy):
 * por cliente, cada actividad con su responsable, aprobador, consultados e
 * informados. Cada letra es un equipo: una guardia o lista que ya existe, o
 * una persona del directorio (se crea aquí si no está).
 */
@Component({
  selector: 'app-admin-raci',
  standalone: true,
  imports: [FormsModule, MatIconModule, RaciTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin-raci.css',
  templateUrl: './admin-raci.html',
})
export class AdminRaciComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(RaciService);
  private readonly orgs = inject(OrganizationsService);
  private readonly directory = inject(DirectoryService);
  protected readonly roles = RACI_ROLES;

  private readonly all = signal<RaciActivity[]>([]);
  protected readonly clients = signal<Organization[]>([]);
  private readonly teams = signal<TeamSummary[]>([]);
  protected readonly filterClient = signal('');
  protected readonly search = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly flash = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly draft = signal<Draft | null>(null);
  protected readonly confirming = signal<RaciActivity | null>(null);
  /** La letra cuyo buscador está abierto. */
  protected readonly picking = signal<RaciRole | null>(null);
  protected readonly who = signal('');
  protected readonly contacts = signal<DirectoryContact[]>([]);
  protected readonly person = signal({ name: '', email: '', phone: '' });

  /** Solo los clientes que tienen RACI, para filtrar la lista. */
  protected readonly withRaci = computed(() => {
    const seen = new Map<string, string>();
    for (const a of this.all()) seen.set(a.clientId, a.clientName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  });

  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.all().filter((a) => {
      if (this.filterClient() && a.clientId !== this.filterClient()) return false;
      if (!q) return true;
      const people = Object.values(a.letters).flat().flatMap((t) => [t.name, ...t.members.map((m) => m.name)]);
      return [a.topic, a.activity, a.notes, a.clientName, ...people].some((s) => s.toLowerCase().includes(q));
    });
  });

  /** Tópicos ya usados por el cliente del borrador, para no escribirlos distinto. */
  protected readonly topics = computed(() => {
    const client = this.draft()?.clientId;
    return [...new Set(this.all().filter((a) => a.clientId === client && a.topic).map((a) => a.topic))];
  });

  protected readonly teamMatches = computed(() => {
    const q = this.who().trim().toLowerCase();
    const role = this.picking();
    const taken = new Set(role ? (this.draft()?.letters[role] ?? []).map((p) => p.id) : []);
    return this.teams()
      .filter((t) => t.active && !taken.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
      .slice(0, 8);
  });

  protected readonly problems = computed<MessageKey[]>(() => {
    const d = this.draft();
    if (!d) return [];
    const out: MessageKey[] = [];
    if (!d.letters.responsible.length) out.push('raci.form.needR');
    if (d.letters.accountable.length !== 1) out.push('raci.form.needA');
    return out;
  });

  async ngOnInit(): Promise<void> {
    try {
      const [all, clients, teams] = await Promise.all([this.api.list(), this.orgs.list({ clients: true, active: true }), this.orgs.listTeams()]);
      this.all.set(all);
      this.clients.set(clients);
      this.teams.set(teams);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.error')));
    }
  }

  protected roleKey(role: RaciRole): MessageKey {
    return `raci.role.${role}` as MessageKey;
  }

  protected hintKey(role: RaciRole): MessageKey {
    return `raci.role.${role}Hint` as MessageKey;
  }

  protected letter(role: RaciRole): string {
    return role.charAt(0).toUpperCase();
  }

  protected startNew(): void {
    const clientId = this.filterClient() || this.clients()[0]?.id || '';
    this.draft.set({ id: null, clientId, topic: '', activity: '', notes: '', letters: emptyLetters() });
    this.closePicker();
    this.flash.set(null);
  }

  protected startEdit(a: RaciActivity): void {
    const letters = emptyLetters();
    for (const role of RACI_ROLES) letters[role] = a.letters[role].map((t) => ({ id: t.id, name: t.name }));
    this.draft.set({ id: a.id, clientId: a.clientId, topic: a.topic, activity: a.activity, notes: a.notes, letters });
    this.closePicker();
    this.flash.set(null);
  }

  protected patch(change: Partial<Draft>): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, ...change });
  }

  protected openPicker(role: RaciRole): void {
    this.picking.set(role);
    this.who.set('');
    this.contacts.set([]);
    this.person.set({ name: '', email: '', phone: '' });
  }

  protected closePicker(): void {
    this.picking.set(null);
  }

  protected async onWho(text: string): Promise<void> {
    this.who.set(text);
    if (text.trim().length < 2) {
      this.contacts.set([]);
      return;
    }
    try {
      const found = await this.directory.search(text.trim());
      if (this.who() === text) this.contacts.set(found.slice(0, 8));
    } catch {
      this.contacts.set([]);
    }
  }

  protected add(pick: Pick): void {
    const d = this.draft();
    const role = this.picking();
    if (!d || !role) return;
    // El aprobador es uno solo: elegir otro lo reemplaza.
    const current = role === 'accountable' ? [] : d.letters[role].filter((p) => p.id !== pick.id);
    this.draft.set({ ...d, letters: { ...d.letters, [role]: [...current, pick] } });
    this.closePicker();
  }

  protected removeFrom(role: RaciRole, id: string): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, letters: { ...d.letters, [role]: d.letters[role].filter((p) => p.id !== id) } });
  }

  protected async addContact(c: DirectoryContact): Promise<void> {
    try {
      const team = await this.api.person(c.id);
      this.add({ id: team.id, name: team.name });
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.saveError')));
    }
  }

  protected async createPerson(): Promise<void> {
    const d = this.draft();
    const p = this.person();
    if (!d || !p.name.trim()) return;
    try {
      const contact = await this.directory.create({ organizationId: d.clientId, name: p.name.trim(), email: p.email.trim(), phone: p.phone.trim(),
        position: '', specialty: '', scope: 'external', isFavorite: false });
      await this.addContact(contact);
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.saveError')));
    }
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.problems().length || !d.activity.trim()) return;
    const form: RaciForm = { clientId: d.clientId, topic: d.topic, activity: d.activity, notes: d.notes,
      responsible: d.letters.responsible.map((p) => p.id), accountable: d.letters.accountable.map((p) => p.id),
      consulted: d.letters.consulted.map((p) => p.id), informed: d.letters.informed.map((p) => p.id) };
    this.saving.set(true);
    this.error.set(null);
    try {
      if (d.id) await this.api.update(d.id, form);
      else await this.api.create(form);
      this.draft.set(null);
      this.all.set(await this.api.list());
      this.flash.set(this.i18n.t('raci.admin.saved'));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.saveError')));
    } finally {
      this.saving.set(false);
    }
  }

  protected async confirmRemove(): Promise<void> {
    const a = this.confirming();
    if (!a) return;
    try {
      await this.api.remove(a.id);
      this.confirming.set(null);
      this.all.set(this.all().filter((x) => x.id !== a.id));
      this.flash.set(this.i18n.t('raci.admin.deleted'));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('raci.saveError')));
    }
  }
}
