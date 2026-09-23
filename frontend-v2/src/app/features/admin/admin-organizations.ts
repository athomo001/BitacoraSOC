import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import {
  LogSource,
  ORGANIZATION_TYPE_LABELS,
  Organization,
  OrganizationType,
  OrganizationsService,
} from '../../core/organizations/organizations.service';
import { problemDetail } from '../../core/http-error';

/**
 * Administración mínima de organizaciones (Fase 6 tarea 5): clientes,
 * contratas, carriers e interna en una sola lista, más el catálogo de
 * tecnologías/fuentes de log. Tabla plana con alta en línea.
 */
@Component({
  selector: 'app-admin-organizations',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Organizaciones</h2>
      <p class="panel__hint">Clientes, contratas (empresas terciarias), carriers de enlace y la operación interna.</p>
      <form class="field-grid org-form" (ngSubmit)="create()">
        <label class="field"><span>Nombre</span><input name="name" [ngModel]="name()" (ngModelChange)="name.set($event)" /></label>
        <label class="field"><span>Código</span><input name="code" class="mono" placeholder="CONTRATA-NORTE" [ngModel]="code()" (ngModelChange)="code.set($event)" /></label>
        <label class="field">
          <span>Tipo</span>
          <select name="type" [ngModel]="type()" (ngModelChange)="type.set($event)">
            @for (t of types; track t) { <option [value]="t">{{ typeLabels[t] }}</option> }
          </select>
        </label>
        <div class="actions org-form__actions">
          <button type="submit" class="org-submit" [disabled]="busy()">Agregar organización</button>
        </div>
      </form>
      @if (error()) { <p class="msg msg--error">{{ error() }}</p> }

      <table class="org-table">
        <thead><tr><th>Nombre</th><th>Código</th><th>Tipo</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          @for (org of organizations(); track org.id) {
            <tr>
              <td>{{ org.name }}</td>
              <td class="mono">{{ org.code }}</td>
              <td>{{ typeLabels[org.type] }}</td>
              <td><span class="state" [class.state--on]="org.active" [class.state--off]="!org.active">{{ org.active ? 'ACTIVA' : 'INACTIVA' }}</span></td>
              <td><button type="button" class="org-toggle" (click)="toggle(org)">{{ org.active ? 'Desactivar' : 'Activar' }}</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="org-empty">Todavía no hay organizaciones.</td></tr>
          }
        </tbody>
      </table>
    </section>

    <section class="panel">
      <h2 class="panel__title">Tecnologías / fuentes de log</h2>
      <p class="panel__hint">Catálogo de tecnologías (firewall, EDR, router…) para clasificar activos y servicios.</p>
      <form class="field-grid org-form" (ngSubmit)="createSource()">
        <label class="field"><span>Nombre</span><input name="srcName" placeholder="Firewall Perimetral Fortinet" [ngModel]="srcName()" (ngModelChange)="srcName.set($event)" /></label>
        <label class="field"><span>Código</span><input name="srcCode" class="mono" placeholder="fortinet_firewall" [ngModel]="srcCode()" (ngModelChange)="srcCode.set($event)" /></label>
        <label class="field"><span>Categoría</span><input name="srcCategory" placeholder="network, endpoint, identity, cloud" [ngModel]="srcCategory()" (ngModelChange)="srcCategory.set($event)" /></label>
        <div class="actions org-form__actions">
          <button type="submit" class="org-submit" [disabled]="busy()">Agregar tecnología</button>
        </div>
      </form>
      <table class="org-table">
        <thead><tr><th>Nombre</th><th>Código</th><th>Categoría</th></tr></thead>
        <tbody>
          @for (src of sources(); track src.id) {
            <tr><td>{{ src.displayName }}</td><td class="mono">{{ src.code }}</td><td>{{ src.category }}</td></tr>
          } @empty {
            <tr><td colspan="3" class="org-empty">Catálogo vacío.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    .org-form { align-items: end; margin-bottom: 12px; }
    .org-form__actions { margin-top: 0; }
    .org-submit {
      min-height: var(--row-height); padding: 0 14px; background: var(--border-active); border: none;
      border-radius: var(--radius-sm); color: var(--bg-app); font: inherit; font-weight: 600; cursor: pointer;
    }
    .org-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .org-table th { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px; text-align: left; }
    .org-table td { height: var(--row-height); padding: 4px 8px; border-bottom: 1px solid var(--border-subtle); }
    .org-toggle {
      min-height: 28px; padding: 0 10px; background: none; border: 1px solid var(--border-subtle);
      border-radius: var(--radius-sm); color: var(--text-primary); font: inherit; font-size: 12px; cursor: pointer;
    }
    .org-empty { color: var(--text-secondary); text-align: center; }
  `,
})
export class AdminOrganizationsComponent implements OnInit {
  protected readonly types: OrganizationType[] = ['client', 'contractor', 'carrier', 'internal'];
  protected readonly typeLabels = ORGANIZATION_TYPE_LABELS;

  protected readonly organizations = signal<Organization[]>([]);
  protected readonly sources = signal<LogSource[]>([]);
  protected readonly name = signal('');
  protected readonly code = signal('');
  protected readonly type = signal<OrganizationType>('contractor');
  protected readonly srcName = signal('');
  protected readonly srcCode = signal('');
  protected readonly srcCategory = signal('network');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly api = inject(OrganizationsService);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [orgs, sources] = await Promise.all([this.api.list(), this.api.listLogSources()]);
      this.organizations.set(orgs);
      this.sources.set(sources);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron cargar las organizaciones.'));
    }
  }

  protected async create(): Promise<void> {
    await this.run(() => this.api.create({ name: this.name().trim(), code: this.code().trim(), type: this.type() }), () => {
      this.name.set('');
      this.code.set('');
    });
  }

  protected async createSource(): Promise<void> {
    await this.run(
      () => this.api.createLogSource({ displayName: this.srcName().trim(), code: this.srcCode().trim(), category: this.srcCategory().trim() }),
      () => {
        this.srcName.set('');
        this.srcCode.set('');
      },
    );
  }

  protected async toggle(org: Organization): Promise<void> {
    await this.run(() => this.api.patch(org.id, { active: !org.active }), () => undefined);
  }

  private async run(action: () => Promise<unknown>, onSuccess: () => void): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      onSuccess();
      await this.reload();
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudo guardar.'));
    } finally {
      this.busy.set(false);
    }
  }
}
