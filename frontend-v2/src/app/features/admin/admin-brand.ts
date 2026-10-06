import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { BrandingService, INCIDENT_PALETTES, IncidentPalette, PALETTE_HEADER } from '../../core/branding/branding.service';
import { LOGIN_THEMES, LOGIN_THEME_LABELS } from '../login/login-themes';
import { I18nService } from '../../core/i18n/i18n.service';
import { problemDetail } from '../../core/http-error';

/**
 * Administración → Marca (comentario del dueño #8, canvas v19/v20 aprobado):
 * nombre visible, logo, favicon (por defecto sale del logo), fuente del
 * título (la de la app o una subida, como customFonts del legacy), paleta
 * del "Reporte de Detección" y color del boletín. Se ve al instante en la
 * barra, el login y los correos de todas las pestañas.
 */
@Component({
  selector: 'app-admin-brand',
  standalone: true,
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: flex; flex-direction: column; gap: 14px; }
    mat-icon { width: 16px; height: 16px; font-size: 16px; }
    .br__grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 14px; align-items: start; }
    .br__body { display: flex; flex-direction: column; gap: 14px; padding: 12px 16px 16px; }
    .br__file { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .br__thumb { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: var(--accent); font-weight: 700; }
    .br__thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .br__drop { padding: 10px 12px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-md); color: var(--text-muted); font-size: 12px; cursor: pointer; }
    .br__drop--over { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
    .br__seg { display: flex; flex-wrap: wrap; gap: 6px; }
    .br__palettes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .br__palette { display: flex; align-items: center; gap: 8px; padding: 8px; border: 2px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-app); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
    .br__palette--on { border-color: var(--accent); }
    .br__swatch { width: 22px; height: 22px; flex-shrink: 0; border-radius: 6px; }
    .br__color { display: flex; align-items: center; gap: 8px; }
    .br__color input[type='color'] { width: 40px; height: 30px; padding: 0; border: 1px solid var(--border-subtle); border-radius: 6px; background: none; }
    .br__foot { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--border-subtle); }
    .br__foot span { color: var(--text-muted); font-size: 12px; }
    .br__push { margin-left: auto; }
    .pv { display: flex; flex-direction: column; gap: 12px; padding: 12px 16px 16px; }
    .pv__bar { display: flex; align-items: center; gap: 9px; padding: 10px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--bg-surface); }
    .pv__name { font-size: 14px; font-weight: 600; }
    .pv__tab { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--border-subtle); border-radius: 8px 8px 0 0; background: var(--bg-app); font-size: 11.5px; }
    .pv__fav { width: 16px; height: 16px; object-fit: contain; }
    .pv__mail { overflow: hidden; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: #fff; color: #222; }
    .pv__mail-head { display: flex; align-items: center; gap: 10px; padding: 14px; color: #fff; }
    .pv__mail-head img { max-height: 32px; }
    .pv__mail-body { padding: 10px 14px; font-size: 12px; }
    .pv__bulletin { padding: 10px 14px; color: #fff; font-size: 12px; font-weight: 700; text-align: center; }
    @media (width <= 1100px) { .br__grid { grid-template-columns: minmax(0, 1fr); } }
  `,
  template: `
    <header class="adm-head">
      <div>
        <h2 class="adm-title">{{ i18n.t('admin.nav.brand') }}</h2>
        <p class="adm-muted">{{ i18n.t('brand.subtitle') }}</p>
      </div>
    </header>
    @if (error(); as e) { <p class="adm-error" role="alert">{{ e }}</p> }

    <div class="br__grid">
      <section class="adm-card">
        <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>palette</mat-icon>{{ i18n.t('brand.identity') }}</h3></div>
        <div class="br__body">
          <label class="adm-field">
            <span class="adm-label">{{ i18n.t('brand.appTitle') }}</span>
            <input class="adm-input" name="appTitle" maxlength="60" [ngModel]="title()" (ngModelChange)="title.set($event); dirty.set(true)" />
            <span class="adm-hint">{{ i18n.t('brand.appTitleHint') }}</span>
          </label>

          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('brand.logo') }}</span>
            <div class="br__file">
              <span class="br__thumb">@if (b.logoUrl(); as l) { <img [src]="l" alt="" /> } @else { {{ title().charAt(0) }} }</span>
              <label class="br__drop" [class.br__drop--over]="over() === 'logo'" (dragover)="$event.preventDefault(); over.set('logo')" (dragleave)="over.set(null)" (drop)="drop($event, 'logo')">
                {{ b.brand().logoName || i18n.t('brand.dropOrPick') }} · png/svg/webp
                <input type="file" hidden accept="image/png,image/svg+xml,image/webp,image/jpeg" (change)="pick($event, 'logo')" />
              </label>
              @if (b.brand().hasLogo) { <button type="button" class="adm-btn" [disabled]="busy()" (click)="remove('logo')">{{ i18n.t('brand.remove') }}</button> }
            </div>
          </div>

          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('brand.favicon') }}</span>
            <div class="br__file">
              <span class="br__thumb"><img [src]="faviconSrc()" alt="" /></span>
              <label class="br__drop" [class.br__drop--over]="over() === 'favicon'" (dragover)="$event.preventDefault(); over.set('favicon')" (dragleave)="over.set(null)" (drop)="drop($event, 'favicon')">
                {{ faviconHint() }}
                <input type="file" hidden accept="image/png,image/svg+xml,image/x-icon,image/webp" (change)="pick($event, 'favicon')" />
              </label>
              @if (b.brand().hasFavicon) { <button type="button" class="adm-btn" [disabled]="busy()" (click)="remove('favicon')">{{ i18n.t('brand.useLogo') }}</button> }
            </div>
            <input class="adm-input" name="faviconUrl" [placeholder]="i18n.t('brand.faviconUrl')" [ngModel]="faviconUrl()" (ngModelChange)="faviconUrl.set($event); dirty.set(true)" />
          </div>

          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('brand.titleFont') }}</span>
            <div class="br__seg">
              <button type="button" class="seg" [attr.aria-pressed]="font() === 'inter'" (click)="font.set('inter'); dirty.set(true)">{{ i18n.t('brand.fontApp') }}</button>
              @if (b.brand().fontName) {
                <button type="button" class="seg" [attr.aria-pressed]="font() === 'custom'" (click)="font.set('custom'); dirty.set(true)" style="font-family: 'BrandTitle', inherit">{{ b.brand().fontName }}</button>
              }
              <label class="adm-btn"><mat-icon>upload</mat-icon>{{ i18n.t('brand.uploadFont') }}<input type="file" hidden accept=".woff2,.woff,.ttf,.otf" (change)="pick($event, 'font')" /></label>
            </div>
            <span class="adm-hint">{{ i18n.t('brand.fontHint') }}</span>
          </div>

          <div class="adm-field">
            <span class="adm-label">{{ i18n.t('brand.palette') }}</span>
            <div class="br__palettes">
              @for (p of palettes; track p) {
                <button type="button" class="br__palette" [class.br__palette--on]="palette() === p" [attr.aria-pressed]="palette() === p" (click)="palette.set(p); dirty.set(true)">
                  <span class="br__swatch" [style.background]="paletteColor(p)"></span>{{ p }}
                </button>
              }
            </div>
            <span class="adm-hint">{{ i18n.t('brand.paletteHint') }}</span>
          </div>

          <div class="adm-row">
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('brand.bulletinColor') }}</span>
              <span class="br__color">
                <input type="color" name="bulletinColor" [ngModel]="bulletin()" (ngModelChange)="bulletin.set($event); dirty.set(true)" />
                <input class="adm-input mono" name="bulletinHex" maxlength="7" [ngModel]="bulletin()" (ngModelChange)="bulletin.set($event); dirty.set(true)" />
              </span>
            </label>
            <label class="adm-field">
              <span class="adm-label">{{ i18n.t('brand.loginTheme') }}</span>
              <select class="adm-input" name="loginTheme" [ngModel]="loginTheme()" (ngModelChange)="loginTheme.set($event); dirty.set(true)">
                @for (t of themes; track t) { <option [value]="t">{{ themeLabels[t] }}</option> }
              </select>
            </label>
          </div>
        </div>
        <div class="br__foot">
          <span>{{ i18n.t(dirty() ? 'brand.unsaved' : 'brand.saved') }}</span>
          <button type="button" class="adm-btn adm-btn--primary br__push" [disabled]="busy() || !dirty() || !title().trim()" (click)="save()"><mat-icon>save</mat-icon>{{ i18n.t('admin.save') }}</button>
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card__head"><h3 class="adm-card__title"><mat-icon>visibility</mat-icon>{{ i18n.t('brand.preview') }}</h3></div>
        <div class="pv">
          <span class="adm-label">{{ i18n.t('brand.previewBar') }}</span>
          <div class="pv__tab"><img class="pv__fav" [src]="faviconSrc()" alt="" />{{ title() }}</div>
          <div class="pv__bar">
            <span class="br__thumb" style="width: 26px; height: 26px">@if (b.logoUrl(); as l) { <img [src]="l" alt="" /> } @else { {{ title().charAt(0) }} }</span>
            <span class="pv__name" [style.font-family]="font() === 'custom' ? 'BrandTitle, inherit' : null">{{ title() }}</span>
          </div>
          <span class="adm-label">{{ i18n.t('brand.previewMail') }}</span>
          <div class="pv__mail">
            <div class="pv__mail-head" [style.background]="paletteColor(palette())">
              @if (b.logoUrl(); as l) { <img [src]="l" alt="" /> } @else { <strong>{{ title() }}</strong> }
              <span>{{ i18n.t('brand.previewIncident') }}</span>
            </div>
            <div class="pv__mail-body">{{ i18n.t('brand.previewIncidentBody') }}</div>
            <div class="pv__bulletin" [style.background]="bulletin()">{{ i18n.t('brand.previewBulletin') }}</div>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class AdminBrandComponent implements OnInit {
  protected readonly i18n = inject(I18nService);
  protected readonly b = inject(BrandingService);
  protected readonly palettes = INCIDENT_PALETTES;
  protected readonly themes = LOGIN_THEMES;
  protected readonly themeLabels = LOGIN_THEME_LABELS;

  protected readonly title = signal('');
  protected readonly faviconUrl = signal('');
  protected readonly font = signal<'inter' | 'custom'>('inter');
  protected readonly palette = signal<IncidentPalette>('cdc-verde');
  protected readonly bulletin = signal('#EF5350');
  protected readonly loginTheme = signal('crt');
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly over = signal<string | null>(null);

  protected readonly faviconSrc = computed(() => {
    const brand = this.b.brand();
    const url = this.faviconUrl().trim();
    if (url.startsWith('https://')) return url;
    return brand.hasFavicon || brand.hasLogo ? `/api/branding/favicon?v=${brand.version}` : 'favicon.ico';
  });

  protected readonly faviconHint = computed(() => (this.b.brand().hasFavicon ? this.i18n.t('brand.faviconOwn') : this.i18n.t('brand.faviconFromLogo')));

  async ngOnInit(): Promise<void> {
    await this.b.refresh();
    this.reset();
  }

  private reset(): void {
    const brand = this.b.brand();
    this.title.set(brand.appTitle);
    this.faviconUrl.set(brand.faviconUrl ?? '');
    this.font.set(brand.titleFont);
    this.palette.set(brand.incidentPalette);
    this.bulletin.set(brand.bulletinColor);
    this.loginTheme.set(brand.loginTheme || 'crt');
    this.dirty.set(false);
  }

  protected paletteColor(p: IncidentPalette): string {
    return PALETTE_HEADER[p];
  }

  protected async save(): Promise<void> {
    await this.run(async () => {
      await this.b.update({
        appTitle: this.title().trim(),
        titleFont: this.font(),
        incidentPalette: this.palette(),
        bulletinColor: this.bulletin(),
        loginTheme: this.loginTheme(),
        faviconUrl: this.faviconUrl().trim(),
      });
      this.reset();
    });
  }

  protected async pick(event: Event, kind: 'logo' | 'favicon' | 'font'): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.upload(kind, file);
  }

  protected async drop(event: DragEvent, kind: 'logo' | 'favicon'): Promise<void> {
    event.preventDefault();
    this.over.set(null);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.upload(kind, file);
  }

  private async upload(kind: 'logo' | 'favicon' | 'font', file: File): Promise<void> {
    await this.run(async () => {
      await this.b.upload(kind, file);
      if (kind === 'font') this.font.set('custom');
    });
  }

  protected async remove(kind: 'logo' | 'favicon'): Promise<void> {
    await this.run(() => this.b.remove(kind));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await action();
    } catch (error) {
      this.error.set(problemDetail(error, this.i18n.t('brand.error')));
    } finally {
      this.busy.set(false);
    }
  }
}
