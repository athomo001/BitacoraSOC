import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { LdapConfig, LdapConfigInput, LdapService, LdapTest } from '../../core/ldap/ldap.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/admin';
import '../../core/i18n/packs/ldap';

/** Lo que se edita; bindPassword undefined = se mantiene la guardada. */
type LdapDraft = Omit<LdapConfigInput, 'bindPassword'> & { bindPassword?: string };

type TextField = 'url' | 'caPem' | 'bindDn' | 'baseDn' | 'userFilter' | 'usernameAttr' | 'nameAttr' | 'emailAttr' | 'groupDn';

function toDraft(c: LdapConfig): LdapDraft {
  return {
    url: c.url, startTls: c.startTls, verifyTls: c.verifyTls, caPem: c.caPem, bindDn: c.bindDn, baseDn: c.baseDn,
    userFilter: c.userFilter, usernameAttr: c.usernameAttr, nameAttr: c.nameAttr, emailAttr: c.emailAttr,
    groupDn: c.groupDn, timeoutSeconds: c.timeoutSeconds,
  };
}

/**
 * Administración → LDAP (spec/20, 10k): la conexión con el directorio del
 * dominio y «Probar». El directorio solo valida contraseñas; las áreas se
 * siguen manejando en Usuarios y grupos. Mismos componentes que Escribir en
 * GLPI (interruptor, secreto que nunca vuelve, «Probar» sin crear nada).
 */
@Component({
  selector: 'app-admin-ldap',
  standalone: true,
  imports: [DatePipe, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-ldap.html',
  styleUrl: './admin-ldap.css',
})
export class AdminLdapComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(LdapService);

  protected readonly saved = signal<LdapConfig | null>(null);
  protected readonly draft = signal<LdapDraft | null>(null);
  protected readonly replacing = signal(false);
  protected readonly testUser = signal('');
  protected readonly test = signal<LdapTest | null>(null);
  protected readonly busy = signal<'save' | 'test' | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly ldaps = computed(() => (this.draft()?.url ?? '').trim().toLowerCase().startsWith('ldaps://'));
  protected readonly dirty = computed(() => {
    const s = this.saved();
    const d = this.draft();
    return !!s && !!d && JSON.stringify(d) !== JSON.stringify(toDraft(s));
  });
  protected readonly problem = computed(() => {
    const d = this.draft();
    if (d && !this.saved()?.hasBindPassword && !d.bindPassword) return this.i18n.t('ldap.needPassword');
    return null;
  });

  async ngOnInit(): Promise<void> {
    try {
      const c = await this.api.config();
      this.apply(c);
      this.test.set(c.lastTest ?? null);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ldap.loadError')));
    }
  }

  private apply(c: LdapConfig): void {
    this.saved.set(c);
    this.draft.set(toDraft(c));
    this.replacing.set(false);
  }

  protected patch(changes: Partial<LdapDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...changes } : d));
    this.notice.set(null);
  }

  protected text(field: TextField, e: Event): void {
    this.patch({ [field]: (e.target as HTMLInputElement | HTMLTextAreaElement).value });
  }

  protected timeout(e: Event): void {
    this.patch({ timeoutSeconds: Number((e.target as HTMLInputElement).value) || 8 });
  }

  protected keepPassword(): void {
    this.replacing.set(false);
    const d = { ...this.draft()! };
    delete d.bindPassword;
    this.draft.set(d);
  }

  protected discard(): void {
    const s = this.saved();
    if (s) this.apply(s);
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || this.problem() || this.busy()) return;
    this.busy.set('save');
    this.error.set(null);
    try {
      this.apply(await this.api.save({ ...d, bindPassword: d.bindPassword ?? null }));
      this.notice.set(this.i18n.t('ldap.saved'));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('ldap.saveError')));
    } finally {
      this.busy.set(null);
    }
  }

  protected async runTest(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('test');
    this.test.set(null);
    try {
      this.test.set(await this.api.test(this.testUser().trim()));
    } catch (e) {
      this.test.set({ at: new Date().toISOString(), ok: false, error: problemDetail(e, this.i18n.t('ldap.loadError')) });
    } finally {
      this.busy.set(null);
    }
  }

  protected testText(t: LdapTest): string {
    if (!t.ok) return t.error ?? '';
    if (t.entry) return this.i18n.tf('ldap.testFound', t.entry.name || t.entry.username).replace('{w}', t.entry.email || t.entry.dn);
    return this.i18n.t('ldap.testOk');
  }
}
