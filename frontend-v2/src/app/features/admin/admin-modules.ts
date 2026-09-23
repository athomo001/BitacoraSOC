import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../../shared/ui/button/button';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';

/**
 * Activar/desactivar SOC/NOC post-bootstrap (HU-0b). El texto lo deja claro
 * porque es la duda natural del admin: apagar un módulo nunca borra datos.
 */
@Component({
  selector: 'app-admin-modules',
  standalone: true,
  imports: [FormsModule, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Módulos de la instalación</h2>
      <p class="panel__hint">
        Desactivar un módulo solo bloquea su acceso (403): sus datos quedan intactos y vuelven tal cual al reactivarlo.
      </p>
      <div class="admin-stack">
        <label class="check-row">
          <input type="checkbox" name="soc" [ngModel]="soc()" (ngModelChange)="soc.set($event)" />
          <span>
            <span class="check-row__label">SOC</span>
            <span class="check-row__desc">Clientes, servicios, escalamiento por servicio.</span>
          </span>
        </label>
        <label class="check-row">
          <input type="checkbox" name="noc" [ngModel]="noc()" (ngModelChange)="noc.set($event)" />
          <span>
            <span class="check-row__label">NOC</span>
            <span class="check-row__desc">Territorio, activos, contratas, cobertura de cuadrillas.</span>
          </span>
        </label>
      </div>
      @if (!soc() && !noc()) {
        <p class="msg msg--error">Al menos un módulo debe quedar activo.</p>
      }
      <div class="actions">
        <app-button variant="primary" icon="save" [disabled]="saving() || (!soc() && !noc())" (pressed)="save()">
          {{ saving() ? 'Guardando…' : 'Guardar módulos' }}
        </app-button>
      </div>
      @if (error()) {
        <p class="msg msg--error">{{ error() }}</p>
      }
      @if (savedOk()) {
        <p class="msg msg--ok">Módulos actualizados.</p>
      }
    </section>
  `,
  styles: `
    .admin-stack {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  `,
})
export class AdminModulesComponent implements OnInit {
  protected readonly soc = signal(false);
  protected readonly noc = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly savedOk = signal(false);

  private readonly setup = inject(SetupService);

  async ngOnInit(): Promise<void> {
    const status = await this.setup.loadStatus();
    this.soc.set(status.socEnabled);
    this.noc.set(status.nocEnabled);
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    this.savedOk.set(false);
    this.saving.set(true);
    try {
      const flags = await this.setup.updateModules({ socEnabled: this.soc(), nocEnabled: this.noc() });
      this.soc.set(flags.socEnabled);
      this.noc.set(flags.nocEnabled);
      this.savedOk.set(true);
    } catch (error) {
      this.error.set(problemDetail(error, 'No se pudieron guardar los módulos.'));
    } finally {
      this.saving.set(false);
    }
  }
}
