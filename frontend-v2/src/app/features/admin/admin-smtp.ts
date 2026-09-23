import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EscalationService } from '../../core/escalation/escalation.service';
import { problemDetail } from '../../core/http-error';

/**
 * Correo saliente (SMTP) — lo usa el aviso de escalación de la Fase 7. La
 * contraseña se guarda cifrada y nunca vuelve al navegador: el campo vacío
 * al guardar conserva la que ya estaba.
 */
@Component({
  selector: 'app-admin-smtp',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel">
      <h2 class="panel__title">Correo saliente (SMTP)</h2>
      <p class="panel__hint">Servidor por el que salen los avisos de escalación. {{ configured() ? '' : 'Todavía no está configurado.' }}</p>
      <form class="field-grid smtp-form" (ngSubmit)="save()">
        <label class="field"><span>Servidor</span><input name="host" placeholder="smtp.office365.com" [ngModel]="host()" (ngModelChange)="host.set($event)" /></label>
        <label class="field"><span>Puerto</span><input name="port" type="number" min="1" max="65535" [ngModel]="port()" (ngModelChange)="port.set(+$event)" /></label>
        <label class="field"><span>Usuario</span><input name="username" autocomplete="off" [ngModel]="username()" (ngModelChange)="username.set($event)" /></label>
        <label class="field">
          <span>Contraseña</span>
          <input name="password" type="password" autocomplete="new-password" [placeholder]="hasPassword() ? '•••••• (guardada — vacío la conserva)' : ''" [ngModel]="password()" (ngModelChange)="password.set($event)" />
        </label>
        <label class="field"><span>Remitente</span><input name="fromAddress" placeholder="noc@empresa.cl" [ngModel]="fromAddress()" (ngModelChange)="fromAddress.set($event)" /></label>
        <label class="field smtp-check">
          <input name="requireTls" type="checkbox" [ngModel]="requireTls()" (ngModelChange)="requireTls.set($event)" />
          <span>Exigir TLS</span>
        </label>
        <div class="actions smtp-actions"><button type="submit" class="smtp-submit" [disabled]="!host().trim() || !fromAddress().trim()">Guardar</button></div>
      </form>
      <div class="field-grid smtp-form">
        <label class="field"><span>Enviar correo de prueba a</span><input name="testTo" placeholder="tu@empresa.cl" [ngModel]="testTo()" (ngModelChange)="testTo.set($event)" /></label>
        <div class="actions smtp-actions"><button type="button" class="smtp-btn" [disabled]="!configured() || !testTo().trim()" (click)="test()">Probar envío</button></div>
      </div>
      @if (message(); as m) { <p class="msg" [class.msg--ok]="m.ok" [class.msg--error]="!m.ok">{{ m.text }}</p> }
    </section>
  `,
  styles: `
    .smtp-form { align-items: end; margin: 12px 0; }
    .smtp-actions { margin-top: 0; }
    .smtp-check { flex-direction: row; align-items: center; gap: 6px; min-height: var(--row-height); }
    .smtp-submit, .smtp-btn {
      min-height: var(--row-height); padding: 0 14px; border-radius: var(--radius-sm); font: inherit; cursor: pointer;
    }
    .smtp-submit { background: var(--border-active); border: none; color: var(--bg-app); font-weight: 600; }
    .smtp-btn { background: none; border: 1px solid var(--border-subtle); color: var(--text-primary); }
    .smtp-submit[disabled], .smtp-btn[disabled] { opacity: 0.6; cursor: default; }
  `,
})
export class AdminSmtpComponent implements OnInit {
  private readonly api = inject(EscalationService);

  protected readonly configured = signal(false);
  protected readonly host = signal('');
  protected readonly port = signal(587);
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly hasPassword = signal(false);
  protected readonly fromAddress = signal('');
  protected readonly requireTls = signal(true);
  protected readonly testTo = signal('');
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const cfg = await this.api.getSmtp();
      if (cfg) {
        this.configured.set(true);
        this.host.set(cfg.host);
        this.port.set(cfg.port);
        this.username.set(cfg.username);
        this.fromAddress.set(cfg.fromAddress);
        this.requireTls.set(cfg.requireTls);
        this.hasPassword.set(cfg.hasPassword);
      }
    } catch (error) {
      this.message.set({ ok: false, text: problemDetail(error, 'No se pudo leer la configuración SMTP.') });
    }
  }

  protected async save(): Promise<void> {
    this.message.set(null);
    try {
      const cfg = await this.api.putSmtp({
        host: this.host().trim(),
        port: this.port(),
        username: this.username().trim(),
        password: this.password() || undefined,
        fromAddress: this.fromAddress().trim(),
        requireTls: this.requireTls(),
      });
      this.configured.set(true);
      this.hasPassword.set(cfg.hasPassword);
      this.password.set('');
      this.message.set({ ok: true, text: 'Configuración guardada.' });
    } catch (error) {
      this.message.set({ ok: false, text: problemDetail(error, 'No se pudo guardar la configuración.') });
    }
  }

  protected async test(): Promise<void> {
    this.message.set(null);
    try {
      await this.api.testSmtp(this.testTo().trim());
      this.message.set({ ok: true, text: `Correo de prueba enviado a ${this.testTo().trim()}.` });
    } catch (error) {
      this.message.set({ ok: false, text: problemDetail(error, 'El envío de prueba falló.') });
    }
  }
}
