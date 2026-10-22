import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { PublicLink, PublicLinkKind, PublicLinksService } from '../../core/public-links/public-links.service';
import { AreasService } from '../../core/areas/areas.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';

import '../../core/i18n/packs/public-links';

/**
 * Administración → Enlaces públicos (10h, diseño aprobado por el dueño
 * 2026-10-22): crear, cambiar, apagar y borrar los enlaces que se abren sin
 * sesión, incluido el de teletrabajo (antes en Turnos). El enlace se ve una
 * sola vez, al crearlo o cambiarlo: el servidor solo guarda su huella.
 */
@Component({
  selector: 'app-admin-public-links',
  standalone: true,
  imports: [DatePipe, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.publicLinks') }}</h2>
        <p class="adm-muted pl__lead">{{ i18n.t('pl.subtitle') }}</p>
      </div>
    </header>

    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>add_link</mat-icon>{{ i18n.t('pl.new') }}</h3></div>
      <form class="pl__form" (ngSubmit)="create()">
        <div class="adm-field">
          <span class="adm-label">{{ i18n.t('pl.shows') }}</span>
          <span class="pl__segs" role="group" [attr.aria-label]="i18n.t('pl.shows')">
            @for (k of kinds(); track k) {
              <button type="button" class="seg" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ i18n.t(kindKey(k)) }}</button>
            }
          </span>
          <span class="adm-hint">{{ i18n.t(hintKey(kind())) }}</span>
        </div>
        <div class="adm-row">
          <label class="adm-field">
            <span class="adm-label">{{ i18n.t('pl.name') }}</span>
            <input class="adm-input" name="name" maxlength="80" [placeholder]="i18n.t('pl.namePlaceholder')" [ngModel]="name()" (ngModelChange)="name.set($event)" />
          </label>
          @if (needsAreas()) {
            <div class="adm-field">
              <span class="adm-label">{{ i18n.t('pl.areas') }}</span>
              <span class="pl__checks">
                @for (a of areas(); track a.id) {
                  <label class="pl__check"><input type="checkbox" [checked]="areaIds().includes(a.id)" (change)="toggleArea(a.id)" />{{ a.name }}</label>
                }
              </span>
            </div>
          }
          @if (kind() === 'client') {
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('pl.client') }}</span>
              <select class="adm-input" name="client" [ngModel]="clientId()" (ngModelChange)="clientId.set($event)">
                <option value="">{{ i18n.t('pl.pickClient') }}</option>
                @for (c of clients(); track c.id) { <option [value]="c.id">{{ c.name }}</option> }
              </select>
            </label>
          }
          <button type="submit" class="adm-btn adm-btn--primary pl__go" [disabled]="busy() || !canCreate()"><mat-icon>add</mat-icon>{{ i18n.t('pl.create') }}</button>
        </div>
        @if (fresh(); as f) {
          <div class="pl__fresh" role="status">
            <mat-icon>link</mat-icon>
            <span class="pl__fresh-text">
              <span>{{ i18n.t(f.rotated ? 'pl.rotated' : 'pl.created') }}</span>
              <span class="mono pl__url">{{ f.url }}</span>
            </span>
            <button type="button" class="adm-btn" (click)="copy(f.url)"><mat-icon>{{ copied() ? 'check' : 'content_copy' }}</mat-icon>{{ i18n.t(copied() ? 'pl.copied' : 'pl.copy') }}</button>
          </div>
        }
      </form>
    </section>

    <section class="adm-card">
      <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>link</mat-icon>{{ i18n.t('pl.links') }} <span class="mono adm-secondary">{{ links().length }}</span></h3></div>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th>{{ i18n.t('pl.col.name') }}</th><th>{{ i18n.t('pl.col.shows') }}</th><th>{{ i18n.t('pl.col.seen') }}</th><th>{{ i18n.t('pl.col.active') }}</th><th></th></tr></thead>
          <tbody>
            @for (l of links(); track l.id) {
              <tr [class.pl__off]="!l.active">
                <td><strong>{{ l.name }}</strong></td>
                <td>{{ shows(l) }}</td>
                <td class="adm-secondary">{{ l.lastAccessedAt ? (l.lastAccessedAt | date: 'dd-MM-yyyy HH:mm') : i18n.t('pl.never') }}</td>
                <td>
                  <label class="switch">
                    <input class="switch__input" type="checkbox" role="switch" [checked]="l.active" [disabled]="busy()" (change)="toggle(l)" [attr.aria-label]="l.name" />
                    <span class="switch__track" aria-hidden="true"></span>
                  </label>
                </td>
                <td class="adm-num pl__actions">
                  @if (deleting() === l.id) {
                    <span class="pl__confirm">{{ i18n.tf('pl.deleteConfirm', l.name) }}
                      <button type="button" class="adm-btn" (click)="deleting.set(null)">{{ i18n.t('pl.cancel') }}</button>
                      <button type="button" class="adm-btn adm-btn--danger" [disabled]="busy()" (click)="remove(l)">{{ i18n.t('pl.deleteYes') }}</button>
                    </span>
                  } @else {
                    <button type="button" class="adm-btn" [disabled]="busy()" (click)="rotate(l)">{{ i18n.t('pl.rotate') }}</button>
                    <button type="button" class="adm-icon-btn adm-icon-btn--danger" [disabled]="busy()" [title]="i18n.t('pl.delete')" [attr.aria-label]="i18n.t('pl.delete') + ' ' + l.name" (click)="deleting.set(l.id)"><mat-icon>delete</mat-icon></button>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
        @if (!links().length) { <p class="adm-empty">{{ i18n.t('pl.empty') }}</p> }
      </div>
      <p class="adm-card__note pl__note">{{ i18n.t('pl.rotateNote') }}</p>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .pl__lead { max-width: 640px; }
    .pl__form { display: flex; flex-direction: column; gap: 16px; padding: 14px; }
    .pl__segs { display: flex; flex-wrap: wrap; gap: 6px; }
    .pl__checks { display: flex; flex-wrap: wrap; gap: 6px 14px; min-height: 30px; align-items: center; }
    .pl__check { display: inline-flex; align-items: center; gap: 6px; }
    .pl__go { align-self: flex-end; }
    .pl__fresh { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent-soft); }
    .pl__fresh > mat-icon { color: var(--accent); }
    .pl__fresh-text { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 240px; }
    .pl__url { overflow-wrap: anywhere; font-size: 12px; user-select: all; }
    .pl__off td { color: var(--text-muted); }
    .pl__actions { white-space: nowrap; }
    .pl__actions .adm-icon-btn { margin-left: 6px; }
    .pl__confirm { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; font-size: 12px; color: var(--danger); }
    .pl__note { border-top: 1px solid var(--border-subtle); }
  `,
})
export class AdminPublicLinksComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(PublicLinksService);
  private readonly areasApi = inject(AreasService);
  private readonly orgs = inject(OrganizationsService);

  protected readonly kinds = signal<PublicLinkKind[]>([]);
  protected readonly links = signal<PublicLink[]>([]);
  protected readonly areas = signal<{ id: string; name: string }[]>([]);
  protected readonly clients = signal<Organization[]>([]);
  protected readonly kind = signal<PublicLinkKind>('guards');
  protected readonly name = signal('');
  protected readonly areaIds = signal<string[]>([]);
  protected readonly clientId = signal('');
  protected readonly fresh = signal<{ url: string; rotated: boolean } | null>(null);
  protected readonly copied = signal(false);
  protected readonly deleting = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly needsAreas = computed(() => this.kind() === 'guards' || this.kind() === 'tickets');
  protected readonly canCreate = computed(() => {
    if (!this.name().trim()) return false;
    if (this.needsAreas()) return this.areaIds().length > 0;
    return this.kind() !== 'client' || !!this.clientId();
  });

  async ngOnInit(): Promise<void> {
    try {
      const [kinds, areas, clients] = await Promise.all([this.api.kinds(), this.areasApi.areas(), this.orgs.list({ clients: true, active: true })]);
      this.kinds.set(kinds);
      if (!kinds.includes(this.kind()) && kinds[0]) this.kind.set(kinds[0]);
      this.areas.set(areas.filter((a) => a.active));
      this.clients.set(clients);
      await this.reload();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('pl.loadError')));
    }
  }

  protected kindKey(kind: PublicLinkKind): MessageKey {
    return `pl.kind.${kind}` as MessageKey;
  }

  protected hintKey(kind: PublicLinkKind): MessageKey {
    return `pl.hint.${kind}` as MessageKey;
  }

  /** «Guardias de SOC y NOC», «Estado de Mundo», «Mapa NOC». */
  protected shows(l: PublicLink): string {
    const kind = this.i18n.t(this.kindKey(l.kind));
    if (l.kind === 'client') return `${kind}: ${l.organizationName ?? ''}`;
    const names = l.areaIds.map((id) => this.areas().find((a) => a.id === id)?.name).filter((n): n is string => !!n);
    return names.length ? `${kind}: ${names.join(', ')}` : kind;
  }

  protected toggleArea(id: string): void {
    this.areaIds.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  protected async create(): Promise<void> {
    if (!this.canCreate()) return;
    await this.run(async () => {
      const created = await this.api.create({
        kind: this.kind(),
        name: this.name().trim(),
        areaIds: this.needsAreas() ? this.areaIds() : [],
        organizationId: this.kind() === 'client' ? this.clientId() : undefined,
      });
      this.show(created.url ?? '', false);
      this.name.set('');
    });
  }

  protected async rotate(l: PublicLink): Promise<void> {
    await this.run(async () => this.show(await this.api.rotate(l.id), true));
  }

  protected async toggle(l: PublicLink): Promise<void> {
    await this.run(() => this.api.patch(l.id, { active: !l.active }));
  }

  protected async remove(l: PublicLink): Promise<void> {
    await this.run(async () => {
      await this.api.remove(l.id);
      this.deleting.set(null);
    });
  }

  protected async copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      this.copied.set(true);
    } catch {
      // Sin portapapeles el enlace igual se puede seleccionar a mano.
    }
  }

  private show(url: string, rotated: boolean): void {
    this.copied.set(false);
    this.fresh.set({ url, rotated });
  }

  private async reload(): Promise<void> {
    this.links.set(await this.api.list());
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
      await this.reload();
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('pl.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
