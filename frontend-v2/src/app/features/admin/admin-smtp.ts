import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/auth/auth.service';
import { EscalationService, SmtpConfig } from '../../core/escalation/escalation.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';
import { formatDuration } from '../../core/tickets/ticket-view';
import { SMTP_PRESETS, SmtpPreset, presetFor } from './smtp-presets';

interface SmtpDraft {
  host: string;
  port: number;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
  requireTls: boolean;
}

const EMPTY: SmtpDraft = { host: '', port: 587, username: '', password: '', fromName: 'Bitácora Ops', fromAddress: '', requireTls: true };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Health = 'none' | 'untested' | 'ok' | 'failed';

/**
 * Correo saliente (Administración → Operación → Correo), re-vestido con los
 * componentes del diseño aprobado. Por aquí salen los avisos de escalación,
 * los reportes de turno, las alertas NOK y la recuperación de contraseña.
 * La contraseña se guarda cifrada y nunca vuelve al navegador: dejarla vacía
 * conserva la guardada. La prueba usa lo guardado, por eso pide guardar antes.
 */
@Component({
  selector: 'app-admin-smtp',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-smtp.html',
  styleUrl: './admin-smtp.css',
})
export class AdminSmtpComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(EscalationService);
  private readonly auth = inject(AuthService);

  protected readonly presets = SMTP_PRESETS;
  protected readonly saved = signal<SmtpConfig | null>(null);
  protected readonly draft = signal<SmtpDraft>({ ...EMPTY });
  protected readonly preset = signal<SmtpPreset>(presetFor(''));
  protected readonly testTo = signal('');
  protected readonly busy = signal(false);
  protected readonly loaded = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly testError = signal<string | null>(null);

  /** Lo guardado llevado a la forma del formulario (la contraseña nunca viene). */
  private readonly savedDraft = computed<SmtpDraft>(() => {
    const s = this.saved();
    return s ? { host: s.host, port: s.port, username: s.username, password: '', fromName: s.fromName, fromAddress: s.fromAddress, requireTls: s.requireTls } : { ...EMPTY };
  });

  protected readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.savedDraft()) || !this.saved());

  /** Qué falta para poder guardar (null = nada). */
  protected readonly problem = computed(() => {
    const d = this.draft();
    if (!d.host.trim()) return this.i18n.t('smtp.problem.host');
    if (!(d.port >= 1 && d.port <= 65535)) return this.i18n.t('smtp.problem.port');
    if (!EMAIL.test(d.fromAddress.trim())) return this.i18n.t('smtp.problem.from');
    if (d.fromName.length > 100 || /[\r\n\t]/.test(d.fromName)) return this.i18n.t('smtp.problem.name');
    return null;
  });

  protected readonly health = computed<Health>(() => {
    const s = this.saved();
    if (!s) return 'none';
    if (!s.lastTest) return 'untested';
    return s.lastTest.ok ? 'ok' : 'failed';
  });

  /** "hace 2 h": cuánto hace de la última prueba. */
  protected readonly testedAgo = computed(() => {
    const at = this.saved()?.lastTest?.at;
    return at ? formatDuration((Date.now() - Date.parse(at)) / 1000) : '';
  });

  /** Así lo verá quien reciba el correo. */
  protected readonly fromPreview = computed(() => {
    const d = this.draft();
    const address = d.fromAddress.trim() || 'noc@empresa.cl';
    return d.fromName.trim() ? `${d.fromName.trim()} <${address}>` : address;
  });

  async ngOnInit(): Promise<void> {
    this.testTo.set(this.auth.user()?.email ?? '');
    try {
      this.applySaved(await this.api.getSmtp());
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('smtp.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected patch(changes: Partial<SmtpDraft>): void {
    this.draft.update((d) => ({ ...d, ...changes }));
    this.notice.set(null);
  }

  /** Elegir un proveedor rellena servidor, puerto y TLS; "Otro" solo deja escribirlos. */
  protected pickPreset(preset: SmtpPreset): void {
    this.preset.set(preset);
    if (preset.id !== 'custom') this.patch({ host: preset.host, port: preset.port, requireTls: preset.requireTls });
  }

  protected onHostChange(host: string): void {
    this.patch({ host });
    this.preset.set(presetFor(host, this.draft().username));
  }

  protected discard(): void {
    this.draft.set({ ...this.savedDraft() });
    this.preset.set(presetFor(this.draft().host, this.draft().username));
    this.error.set(null);
  }

  protected async save(): Promise<void> {
    if (this.problem() || this.busy()) return;
    const d = this.draft();
    this.busy.set(true);
    this.error.set(null);
    try {
      const saved = await this.api.putSmtp({
        host: d.host.trim(), port: d.port, username: d.username.trim(), password: d.password || undefined,
        fromAddress: d.fromAddress.trim(), fromName: d.fromName.trim(), requireTls: d.requireTls,
      });
      this.applySaved(saved);
      this.notice.set(this.i18n.t('admin.saved'));
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('smtp.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async test(): Promise<void> {
    const to = this.testTo().trim();
    if (!EMAIL.test(to) || this.dirty() || this.busy()) return;
    this.busy.set(true);
    this.testError.set(null);
    try {
      const result = await this.api.testSmtp(to);
      if (!result.sent) this.testError.set(result.error ?? this.i18n.t('smtp.testFailed'));
      // La prueba quedó registrada en el servidor: se relee para mostrar el resultado.
      this.applySaved(await this.api.getSmtp(), false);
    } catch (error) {
      this.testError.set(problemDetail(error, this.i18n.t('smtp.testFailed')));
    } finally {
      this.busy.set(false);
    }
  }

  protected validEmail(value: string): boolean {
    return EMAIL.test(value.trim());
  }

  private applySaved(config: SmtpConfig | null, resetDraft = true): void {
    this.saved.set(config);
    if (resetDraft) {
      this.draft.set({ ...this.savedDraft() });
      this.preset.set(presetFor(this.draft().host, this.draft().username));
    }
  }
}
