import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { NoticeAudience, NoticeRecipient, NotificationsService, SentNotice } from '../../core/notifications/notifications.service';
import { AgendaAreaOptions, AgendaService } from '../../core/agenda/agenda.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { problemDetail } from '../../core/http-error';
import { MarkdownComponent } from '../../shared/markdown/markdown';

import '../../core/i18n/packs/notifications';

type Kind = NoticeAudience['kind'];
const KINDS: { kind: Kind; key: MessageKey }[] = [
  { kind: 'people', key: 'notices.to.people' },
  { kind: 'level', key: 'notices.to.level' },
  { kind: 'area', key: 'notices.to.area' },
  { kind: 'all', key: 'notices.to.all' },
];

/**
 * Avisos con acuse de lectura (spec/16 §4.5.1, diseño aprobado 2026-10-15):
 * crearlos (a personas, a un nivel de un área, a áreas enteras o a todos,
 * ahora o programados, con fecha en que dejan de aparecer) y ver el avance
 * de los enviados: quién lo leyó, quién falta y recordarles por correo.
 * Los envía el admin, la jefatura de área y quien tiene el permiso.
 */
@Component({
  selector: 'app-notices',
  standalone: true,
  imports: [MatIconModule, DatePipe, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="nc">
      <div class="nc__toolbar">
        <h1 class="nc__title"><mat-icon>campaign</mat-icon>{{ i18n.t('notices.title') }}</h1>
        <span class="adm-muted">{{ i18n.t('notices.subtitle') }}</span>
        @if (canSend()) {
          <button type="button" class="adm-btn adm-btn--primary adm-push" (click)="startNew()"><mat-icon>add</mat-icon>{{ i18n.t('notices.new') }}</button>
        }
      </div>
      @if (error(); as e) { <p class="adm-error nc__pad" role="alert">{{ e }}</p> }
      @if (loaded() && !canSend()) {
        <p class="adm-empty">{{ i18n.t('notices.forbidden') }}</p>
      } @else {
        <div class="nc__grid">
          <section class="adm-card nc__scroll">
            <div class="adm-card__head"><h2 class="adm-card__title">{{ i18n.t('notices.sent') }}</h2></div>
            @for (n of sent(); track n.id) {
              <button type="button" class="nc__row" [attr.aria-current]="selected()?.id === n.id" (click)="select(n)">
                <span class="nc__cell"><b>{{ n.title }}</b><span class="nc__sub">{{ n.createdByName }} · {{ n.publishAt | date: 'dd/MM HH:mm' }}</span></span>
                <span class="nc__prog">
                  @if (n.published) {
                    <span class="nc__bar"><i [style.width.%]="n.total ? (n.read * 100) / n.total : 0"></i></span>
                    <span class="nc__sub">{{ i18n.tf('notices.progress', n.read + ' / ' + n.total) }}</span>
                  }
                </span>
                <span>
                  @if (!n.published) { <span class="pill tone-system">{{ i18n.t('notices.pendingPublish') }}</span> }
                  @else if (n.read >= n.total) { <span class="pill tone-ok">{{ i18n.t('notices.complete') }}</span> }
                  @else { <span class="pill tone-warn">{{ i18n.tf('notices.missing', n.total - n.read) }}</span> }
                </span>
              </button>
            } @empty {
              @if (loaded()) { <p class="adm-empty">{{ i18n.t('notices.empty') }}</p> }
            }
          </section>

          <section class="adm-card nc__scroll">
            @if (creating()) {
              <form class="nc__form" (submit)="$event.preventDefault(); send()">
                <div class="adm-card__head"><h2 class="adm-card__title"><mat-icon>campaign</mat-icon>{{ i18n.t('notices.new') }}</h2></div>
                <div class="nc__body">
                  <label class="adm-field"><span class="adm-label">{{ i18n.t('notices.f.title') }}</span>
                    <input class="adm-input" name="title" maxlength="200" required [value]="title()" (input)="title.set(val($event))" /></label>
                  <label class="adm-field"><span class="adm-label">{{ i18n.t('notices.f.body') }}</span>
                    <textarea class="adm-input" name="body" rows="5" maxlength="10000" [value]="body()" (input)="body.set(val($event))"></textarea></label>
                  @if (body().trim()) { <div class="nc__preview"><app-markdown [content]="body()" /></div> }
                  <div class="adm-field">
                    <span class="adm-label">{{ i18n.t('notices.f.to') }}</span>
                    <div class="nc__chips">
                      @for (k of kinds; track k.kind) {
                        <button type="button" class="seg" [attr.aria-pressed]="kind() === k.kind" (click)="kind.set(k.kind)">{{ i18n.t(k.key) }}</button>
                      }
                    </div>
                    @if (kind() !== 'all') {
                      <span class="adm-label">{{ i18n.t('notices.areas') }}</span>
                      <div class="nc__chips">
                        @for (a of areas(); track a.id) {
                          <button type="button" class="seg" [attr.aria-pressed]="areaIds().includes(a.id)" (click)="toggle(areaIds, a.id)">{{ a.name }}</button>
                        }
                      </div>
                    }
                    @if (kind() === 'level') {
                      <span class="adm-label">{{ i18n.t('notices.levels') }}</span>
                      <div class="nc__chips">
                        @for (l of levels(); track l.id) {
                          <button type="button" class="seg" [attr.aria-pressed]="levelIds().includes(l.id)" (click)="toggle(levelIds, l.id)">{{ l.name }}</button>
                        }
                      </div>
                    }
                    @if (kind() === 'people') {
                      <span class="adm-label">{{ i18n.t('notices.people') }}</span>
                      <div class="nc__chips">
                        @for (p of people(); track p.id) {
                          <button type="button" class="seg" [attr.aria-pressed]="userIds().includes(p.id)" (click)="toggle(userIds, p.id)">{{ p.name }}</button>
                        } @empty { <span class="adm-hint">{{ i18n.t('notices.peopleHint') }}</span> }
                      </div>
                    }
                  </div>
                  <div class="nc__two">
                    <div class="adm-field"><span class="adm-label">{{ i18n.t('notices.f.when') }}</span>
                      <div class="nc__chips">
                        <button type="button" class="seg" [attr.aria-pressed]="!scheduled()" (click)="scheduled.set(false)">{{ i18n.t('notices.now') }}</button>
                        <button type="button" class="seg" [attr.aria-pressed]="scheduled()" (click)="scheduled.set(true)">{{ i18n.t('notices.scheduled') }}</button>
                      </div>
                      @if (scheduled()) { <input class="adm-input" type="datetime-local" name="publishAt" [value]="publishAt()" (change)="publishAt.set(val($event))" /> }
                    </div>
                    <label class="adm-field"><span class="adm-label">{{ i18n.t('notices.f.expires') }}</span>
                      <input class="adm-input" type="datetime-local" name="expiresAt" [value]="expiresAt()" (change)="expiresAt.set(val($event))" />
                      <span class="adm-hint">{{ i18n.t('notices.expiresHint') }}</span></label>
                  </div>
                  <div class="nc__foot">
                    <button type="button" class="adm-btn" (click)="creating.set(false)">{{ i18n.t('notices.cancel') }}</button>
                    <button type="submit" class="adm-btn adm-btn--primary" [disabled]="busy() || !canCreate()"><mat-icon>send</mat-icon>{{ i18n.t('notices.send') }}</button>
                  </div>
                </div>
              </form>
            } @else if (selected(); as n) {
              <div class="adm-card__head">
                <h2 class="adm-card__title">{{ i18n.t('notices.whoRead') }}</h2>
                @if (n.published && n.read < n.total) {
                  <button type="button" class="adm-btn adm-push" [disabled]="busy()" (click)="remind(n)"><mat-icon>forward_to_inbox</mat-icon>{{ i18n.t('notices.remind') }}</button>
                }
              </div>
              <div class="nc__body">
                <b>{{ n.title }}</b>
                <app-markdown class="app-markdown--compact" [content]="n.body" />
                @if (msg(); as m) { <span class="pill tone-ok" role="status">{{ m }}</span> }
                @for (r of recipients(); track r.userId) {
                  <div class="nc__rec"><span>{{ r.name }}</span>
                    @if (r.readAt) { <span class="nc__sub"><mat-icon class="nc__ok">done_all</mat-icon>{{ r.readAt | date: 'dd/MM HH:mm' }}</span> }
                    @else { <span class="pill tone-warn">{{ i18n.t('notices.unreadPill') }}</span> }
                  </div>
                }
                <span class="adm-hint">{{ i18n.t('notices.auditHint') }}</span>
              </div>
            } @else {
              <p class="adm-empty">{{ i18n.t('notices.pick') }}</p>
            }
          </section>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; height: calc(100% + 32px); margin: -16px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .nc { display: flex; flex-direction: column; height: 100%; }
    .nc__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 10px 20px; border-bottom: 1px solid var(--border-subtle); background: var(--bg-surface); }
    .nc__title { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 15px; font-weight: 600; }
    .nc__pad { margin: 10px 20px 0; }
    .nc__grid { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; min-height: 0; padding: 14px 20px; }
    .nc__scroll { max-height: 100%; overflow: auto; }
    .nc__row { display: grid; grid-template-columns: minmax(0, 1fr) 130px auto; gap: 10px; align-items: center; width: 100%; padding: 9px 14px; border: none; border-bottom: 1px solid var(--border-subtle); background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
    .nc__row:hover { background: var(--bg-surface-hover); }
    .nc__row[aria-current="true"] { background: var(--accent-soft); }
    .nc__cell, .nc__prog { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .nc__sub { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); font-size: 11.5px; }
    .nc__bar { height: 8px; overflow: hidden; border-radius: 4px; background: var(--bg-surface-hover); }
    .nc__bar i { display: block; height: 100%; background: var(--status-ok); }
    .nc__body { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; }
    .nc__chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .nc__preview { padding: 8px 10px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); }
    .nc__two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .nc__foot { display: flex; justify-content: flex-end; gap: 8px; }
    .nc__rec { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border-subtle); font-size: 12.5px; }
    .nc__ok { width: 13px; height: 13px; font-size: 13px; color: var(--status-ok); }
    @media (width <= 900px) {
      .nc__grid, .nc__two { grid-template-columns: minmax(0, 1fr); }
      .nc__row { grid-template-columns: minmax(0, 1fr) auto; }
      .nc__prog { display: none; }
    }
  `,
})
export class NoticesComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  private readonly api = inject(NotificationsService);
  private readonly agenda = inject(AgendaService);

  protected readonly kinds = KINDS;
  protected readonly canSend = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly msg = signal<string | null>(null);
  protected readonly sent = signal<SentNotice[]>([]);
  protected readonly selected = signal<SentNotice | null>(null);
  protected readonly recipients = signal<NoticeRecipient[]>([]);
  protected readonly areas = signal<AgendaAreaOptions[]>([]);

  protected readonly creating = signal(false);
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly kind = signal<Kind>('level');
  protected readonly areaIds = signal<string[]>([]);
  protected readonly levelIds = signal<string[]>([]);
  protected readonly userIds = signal<string[]>([]);
  protected readonly scheduled = signal(false);
  protected readonly publishAt = signal('');
  protected readonly expiresAt = signal('');

  protected readonly levels = computed(() => this.areas()[0]?.levels ?? []);
  protected readonly people = computed(() => {
    const seen = new Set<string>();
    return this.areas()
      .filter((a) => this.areaIds().includes(a.id))
      .flatMap((a) => a.people)
      .filter((p) => !seen.has(p.id) && seen.add(p.id));
  });
  protected readonly canCreate = computed(() => {
    if (!this.title().trim() || !this.body().trim()) return false;
    switch (this.kind()) {
      case 'all': return true;
      case 'area': return this.areaIds().length > 0;
      case 'level': return this.areaIds().length > 0 && this.levelIds().length > 0;
      default: return this.userIds().length > 0;
    }
  });

  async ngOnInit(): Promise<void> {
    try {
      const meta = await this.api.noticesMeta();
      this.canSend.set(meta.canSend);
      if (meta.canSend) {
        const [sent, ag] = await Promise.all([this.api.sentNotices(), this.agenda.meta()]);
        this.sent.set(sent);
        this.areas.set(ag.areas);
      }
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.loadError')));
    } finally {
      this.loaded.set(true);
    }
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected toggle(list: typeof this.areaIds, id: string): void {
    list.update((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  protected startNew(): void {
    this.selected.set(null);
    this.creating.set(true);
    this.msg.set(null);
  }

  protected async select(n: SentNotice): Promise<void> {
    this.creating.set(false);
    this.selected.set(n);
    this.msg.set(null);
    try {
      this.recipients.set(n.published ? await this.api.noticeRecipients(n.id) : []);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.loadError')));
    }
  }

  protected async send(): Promise<void> {
    if (!this.canCreate() || this.busy()) return;
    this.busy.set(true);
    const k = this.kind();
    const audience: NoticeAudience = { kind: k };
    if (k !== 'all' && k !== 'people') audience.areaIds = this.areaIds();
    if (k === 'level') audience.levelIds = this.levelIds();
    if (k === 'people') audience.userIds = this.userIds();
    try {
      const sent = await this.api.createNotice({
        title: this.title().trim(), body: this.body().trim(), audience,
        // datetime-local viene sin zona: se interpreta en la hora local del navegador.
        publishAt: this.scheduled() && this.publishAt() ? new Date(this.publishAt()).toISOString() : null,
        expiresAt: this.expiresAt() ? new Date(this.expiresAt()).toISOString() : null,
      });
      this.sent.set(sent);
      this.creating.set(false);
      this.title.set('');
      this.body.set('');
      if (sent[0]) await this.select(sent[0]);
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.saveError')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remind(n: SentNotice): Promise<void> {
    this.busy.set(true);
    try {
      const count = await this.api.remindNotice(n.id);
      this.msg.set(this.i18n.tf('notices.reminded', count));
      this.recipients.set(await this.api.noticeRecipients(n.id));
    } catch (e) {
      this.error.set(problemDetail(e, this.i18n.t('nt.saveError')));
    } finally {
      this.busy.set(false);
    }
  }
}
