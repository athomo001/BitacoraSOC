import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router } from '@angular/router';
import { ManagementService, MgmtClient, MgmtMeta } from '../../core/management/management.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { SseService } from '../../core/sse/sse.service';
import { problemDetail } from '../../core/http-error';
import { MgmtClientsComponent } from './mgmt-clients';
import { MgmtGoalsComponent } from './mgmt-goals';
import { MgmtIndicatorsComponent } from './mgmt-indicators';
import { MgmtPlaybooksComponent } from './mgmt-playbooks';

import '../../core/i18n/packs/management';
import '../../core/i18n/packs/tickets';

export type MgmtTab = 'clients' | 'goals' | 'ind' | 'pb';

const TABS: { id: MgmtTab; icon: string; label: MessageKey; sub: MessageKey }[] = [
  { id: 'clients', icon: 'business', label: 'mg.tab.clients', sub: 'mg.sub.clients' },
  { id: 'goals', icon: 'flag', label: 'mg.tab.goals', sub: 'mg.sub.goals' },
  { id: 'ind', icon: 'insights', label: 'mg.tab.ind', sub: 'mg.sub.ind' },
  { id: 'pb', icon: 'library_add_check', label: 'mg.tab.pb', sub: 'mg.sub.pb' },
];

/** Lo que una pestaña le pide a otra (ej.: la ficha abre una plantilla para ese cliente). */
export interface MgmtNav { tab: MgmtTab; clientId?: string; playbook?: string; }

/**
 * Gestión CSM (spec/16 §4.4, 9.4; diseño aprobado por la CSM y el dueño
 * 2026-10-20): Clientes, Metas, Indicadores y Plantillas. «Desde un ticket»
 * ya no es pestaña: la acción de seguimiento sale del panel del ticket. La
 * ven el perfil Gestión, las jefaturas y el admin (el servidor lo exige).
 */
@Component({
  selector: 'app-management',
  standalone: true,
  imports: [MatIconModule, MgmtClientsComponent, MgmtGoalsComponent, MgmtIndicatorsComponent, MgmtPlaybooksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mg">
      <header class="mg__top">
        <div>
          <h1 class="mg__title"><mat-icon>insights</mat-icon>{{ i18n.t('mg.title') }}</h1>
          <span class="adm-muted">{{ i18n.t(sub()) }}</span>
        </div>
        <span class="mg__tabs" role="tablist">
          @for (t of tabs; track t.id) {
            <button type="button" role="tab" class="seg" [attr.aria-selected]="tab() === t.id" [attr.aria-pressed]="tab() === t.id" (click)="go({ tab: t.id })"><mat-icon>{{ t.icon }}</mat-icon>{{ i18n.t(t.label) }}</button>
          }
        </span>
      </header>
      @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }
      @if (meta(); as m) {
        @switch (tab()) {
          @case ('clients') { <app-mgmt-clients [meta]="m" [clients]="clients()" [areas]="areas()" [selectId]="focusClient()" [refresh]="tick()" (navigate)="go($event)" (reload)="loadClients()" /> }
          @case ('goals') { <app-mgmt-goals [meta]="m" [clients]="clients()" [areas]="areas()" [refresh]="tick()" /> }
          @case ('ind') { <app-mgmt-indicators [meta]="m" [clients]="clients()" (metaChange)="meta.set($event)" /> }
          @case ('pb') { <app-mgmt-playbooks [meta]="m" [clients]="clients()" [areas]="areas()" [clientId]="focusClient()" [playbook]="focusPlaybook()" (applied)="loadClients()" /> }
        }
      }
    </div>
  `,
  styles: `
    .mg { display: flex; flex-direction: column; gap: 14px; padding: 16px; }
    .mg__top { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .mg__title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 18px; font-weight: 600; }
    .mg__tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .mg__title mat-icon { width: 20px; height: 20px; font-size: 20px; }
  `,
})
export class ManagementComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(ManagementService);
  private readonly sse = inject(SseService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  protected readonly tabs = TABS;
  protected readonly tab = signal<MgmtTab>('clients');
  protected readonly meta = signal<MgmtMeta | null>(null);
  protected readonly clients = signal<MgmtClient[]>([]);
  protected readonly areas = signal<{ id: string; name: string; resolves: boolean }[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly focusClient = signal<string | null>(null);
  protected readonly focusPlaybook = signal<string | null>(null);
  /** Sube con un cambio en vivo (otra persona marcó una acción o un hito). */
  protected readonly tick = signal(0);

  protected sub(): MessageKey {
    return TABS.find((t) => t.id === this.tab())!.sub;
  }

  async ngOnInit(): Promise<void> {
    const q = this.route?.snapshot.queryParamMap;
    const tab = q?.get('tab') as MgmtTab | null;
    if (tab && TABS.some((t) => t.id === tab)) this.tab.set(tab);
    this.focusClient.set(q?.get('client') ?? null);
    try {
      const [meta, clients] = await Promise.all([this.api.meta(), this.api.clients()]);
      this.meta.set(meta);
      this.clients.set(clients);
      this.areas.set(meta.areas.map((a) => ({ id: a.id, name: a.name, resolves: a.resolves })));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('mg.loadError')));
      return;
    }
    const stop = this.sse.connect((type) => {
      if (type === 'management.changed' || type === 'agenda.changed' || type.startsWith('ticket.')) {
        void this.loadClients();
        this.tick.update((n) => n + 1);
      }
    });
    this.destroyRef.onDestroy(stop);
  }

  protected async loadClients(): Promise<void> {
    try {
      this.clients.set(await this.api.clients());
    } catch {
      // Se ve al recargar.
    }
  }

  protected go(nav: MgmtNav): void {
    this.tab.set(nav.tab);
    if (nav.clientId !== undefined) this.focusClient.set(nav.clientId);
    this.focusPlaybook.set(nav.playbook ?? null);
    void this.router?.navigate([], { queryParams: { tab: nav.tab, client: this.focusClient() ?? undefined }, replaceUrl: true });
  }
}
