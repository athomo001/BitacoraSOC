import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../shared/ui/button/button';
import { SetupService } from '../../core/setup/setup.service';
import { problemDetail } from '../../core/http-error';
import { TerritorialLabelsFormComponent } from '../territory/territorial-labels-form';
import { TerritoryImportComponent } from '../territory/territory-import';

export type SetupStep = 'modules' | 'admin' | 'territory' | 'done';

/**
 * Wizard del primer arranque (HU-0, Fase 5): módulos → cuenta admin →
 * territorio (solo si NOC). El admin se crea con POST /api/setup/bootstrap
 * (Fase 4) — que ya devuelve su sesión — así el paso de territorio corre
 * autenticado sin pedir login entremedio. Territorio va después del
 * bootstrap y no antes porque el import es un endpoint de admin.
 */
@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [FormsModule, ButtonComponent, TerritorialLabelsFormComponent, TerritoryImportComponent],
  templateUrl: './setup-wizard.html',
  styleUrl: './setup-wizard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupWizardComponent {
  protected readonly step = signal<SetupStep>('modules');
  protected readonly socEnabled = signal(false);
  protected readonly nocEnabled = signal(false);

  protected readonly adminUsername = signal('');
  protected readonly adminEmail = signal('');
  protected readonly adminPassword = signal('');
  protected readonly adminPasswordConfirm = signal('');

  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** HU-0: no se puede continuar con ambos módulos en false. */
  protected readonly canContinueModules = computed(() => this.socEnabled() || this.nocEnabled());

  protected readonly adminFormError = computed(() => {
    if (!this.adminUsername().trim() || !this.adminEmail().trim() || !this.adminPassword()) {
      return 'Completá usuario, correo y contraseña.';
    }
    if (this.adminPassword().length < 12) {
      return 'La contraseña del admin debe tener al menos 12 caracteres.';
    }
    if (this.adminPassword() !== this.adminPasswordConfirm()) {
      return 'Las contraseñas no coinciden.';
    }
    return null;
  });

  protected readonly totalSteps = computed(() => (this.nocEnabled() ? 3 : 2));
  protected readonly stepNumber = computed(() => {
    switch (this.step()) {
      case 'modules':
        return 1;
      case 'admin':
        return 2;
      default:
        return 3;
    }
  });

  private readonly setup = inject(SetupService);
  private readonly router = inject(Router);

  protected goToAdmin(): void {
    if (this.canContinueModules()) {
      this.errorMessage.set(null);
      this.step.set('admin');
    }
  }

  protected backToModules(): void {
    this.errorMessage.set(null);
    this.step.set('modules');
  }

  protected async createAdmin(): Promise<void> {
    if (this.adminFormError()) {
      this.errorMessage.set(this.adminFormError());
      return;
    }
    this.errorMessage.set(null);
    this.loading.set(true);
    try {
      await this.setup.bootstrap({
        adminUsername: this.adminUsername().trim(),
        adminEmail: this.adminEmail().trim(),
        adminPassword: this.adminPassword(),
        socEnabled: this.socEnabled(),
        nocEnabled: this.nocEnabled(),
      });
      this.step.set(this.nocEnabled() ? 'territory' : 'done');
    } catch (error) {
      this.errorMessage.set(problemDetail(error, 'No se pudo completar el setup.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected finishTerritory(): void {
    this.step.set('done');
  }

  protected async enterApp(): Promise<void> {
    await this.router.navigateByUrl('/');
  }
}
