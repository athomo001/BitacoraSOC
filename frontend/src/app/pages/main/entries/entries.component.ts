/**
 * File Purpose: frontend/src/app/pages/main/entries/entries.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Componente de Escribir Entradas de Bitácora
 * Pantalla simple para crear nuevas entradas con clasificación Operativa/Incidente
 */
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { debounceTime } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { EntryService } from '../../../services/entry.service';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { CreateEntryRequest } from '../../../models/entry.model';
import { AuthService } from '../../../services/auth.service';
import { ConfigService } from '../../../services/config.service';
import { TagService } from '../../../services/tag.service';
import { BatEasterEggService } from '../../../services/bat-easter-egg.service';
import { EasterEggRule } from '../../../models/config.model';
import { MatFormField, MatLabel, MatHint, MatPrefix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { NgIf, NgFor } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatRadioGroup, MatRadioButton } from '@angular/material/radio';
import { MatSelect, MatOption } from '@angular/material/select';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { ShiftReportDialogComponent } from './shift-report-dialog.component';
import { ShiftReportMode } from '../../../utils/shift-report-template.util';

@Component({
    selector: 'app-entries',
    templateUrl: './entries.component.html',
    styleUrls: ['./entries.component.scss'],
  imports: [ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatHint, MatPrefix, MatButton, NgIf, MatIcon, MatProgressSpinner, MatRadioGroup, MatRadioButton, MatSelect, MatOption, NgFor]
})
export class EntriesComponent implements OnInit, OnDestroy {
  private readonly contentMaxLength = 50000;
  entryForm: FormGroup;
  today = '';
  nowTime = '';
  isSubmitting = false;
  logSources: CatalogLogSource[] = [];
  topTags: string[] = [];
  glpiManualLinkFieldEnabled = false;
  showEasterEggOverlay = false;
  easterEggImageUrl = '/scripts/Bender.png';

  // 🦇 EE-BAT-001: Easter Egg Murciélago Pixel-Art
  batInstances: BatInstance[] = [];
  // batClickAttempts y batsCaught se leen directamente del BatEasterEggService
  private mouseX = 0;
  private mouseY = 0;
  private lastProximityCheck = 0;
  private batMouseMoveHandler?: (e: MouseEvent) => void;
  private batEvasionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextBatId = 1;

  private entryEasterEggRules: EasterEggRule[] = [];
  private easterEggTimer?: ReturnType<typeof setTimeout>;
  private lastEasterEggTriggerAt = 0;
  private contentTags = new Set<string>();

  constructor(
    private fb: FormBuilder,
    private entryService: EntryService,
    private catalogService: CatalogService,
    private configService: ConfigService,
    private tagService: TagService,
    private snackBar: MatSnackBar,
    private authService: AuthService,
    private dialog: MatDialog,
    // Servicio global del easter egg: el HUD se renderiza en el layout principal
    readonly batService: BatEasterEggService
  ) {
    this.entryForm = this.fb.group({
      content: ['', [Validators.required, Validators.maxLength(50000)]],
      entryType: ['operativa', Validators.required],
      clientId: [null], // Cliente/Log Source (B2i)
      glpiTicketId: ['', [Validators.pattern(/^\d*$/)]] // Ticket GLPI a vincular (opcional)
    });

    const now = new Date();
    this.today = this.getLocalDateString(now);
    this.nowTime = this.getLocalTimeString(now);
  }

  ngOnInit(): void {
    this.loadTopTags();

    // Mouse tracking para el murciélago (EE-BAT-001)
    this.batMouseMoveHandler = (e: MouseEvent) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (this.batInstances.length > 0) {
        const now = Date.now();
        if (now - this.lastProximityCheck > 60) {
          this.lastProximityCheck = now;
          this.evaluateBatProximity();
        }
      }
    };
    document.addEventListener('mousemove', this.batMouseMoveHandler);

    this.configService.getConfig().subscribe({
      next: (config) => {
        this.entryEasterEggRules = (config.easterEggRules || [])
          .filter((rule) => rule.enabled !== false && rule.scope === 'entry' && rule.triggerType === 'hashtag');
      },
      error: () => {
        this.entryEasterEggRules = [];
      }
    });

    // debounceTime(280): evita falsos triggers al escribir #batman o #batimovil.
    // El murciélago solo aparece cuando el usuario PAUSA con #bat como palabra completa.
    this.entryForm.get('content')?.valueChanges
      .pipe(debounceTime(280))
      .subscribe((value: string) => {
        const currentContent = value || '';
        this.syncContentTags(currentContent);
        this.triggerEntryEasterEggIfNeeded(currentContent);
      });

    this.syncContentTags(String(this.entryForm.get('content')?.value || ''));

    // Cargar clientes disponibles
    this.catalogService.searchLogSources('').subscribe(
      (result) => {
        this.logSources = result.items || [];
      },
      () => {
        // Error silencioso, no es crítico
      }
    );

    // Campo opcional de ticket GLPI: solo se muestra si el admin lo habilitó
    this.entryService.getGlpiManualLinkFieldStatus().subscribe({
      next: (status) => {
        this.glpiManualLinkFieldEnabled = !!status.enabled;
      },
      error: () => {
        this.glpiManualLinkFieldEnabled = false;
      }
    });
  }

  ngOnDestroy(): void {
    if (this.batMouseMoveHandler) {
      document.removeEventListener('mousemove', this.batMouseMoveHandler);
    }
    for (const timer of this.batEvasionTimers.values()) {
      clearTimeout(timer);
    }
    this.batEvasionTimers.clear();
  }

  onSubmit(): void {
    if (this.isSubmitting || !this.entryForm.valid) {
      return;
    }

    const now = new Date();
    const entryDate = this.getLocalDateString(now);
    const entryTime = this.getLocalTimeString(now);

    const glpiTicketId = String(this.entryForm.value.glpiTicketId || '').trim();
    const data: CreateEntryRequest = {
      ...this.entryForm.value,
      entryDate,
      entryTime,
      tags: this.extractTagsFromContent(this.entryForm.value.content),
      glpiTicketId: glpiTicketId || undefined
    };

    this.isSubmitting = true;
    this.entryService.createEntry(data).subscribe({
      next: (response) => {
        this.snackBar.open('✅ Entrada creada exitosamente', 'Cerrar', { duration: 3000 });
        const glpiLinkWarning = (response as unknown as { glpiLinkWarning?: string }).glpiLinkWarning;
        if (glpiLinkWarning) {
          this.snackBar.open(`⚠️ ${glpiLinkWarning}`, 'Cerrar', { duration: 5000 });
        }
        this.entryForm.reset({
          entryType: 'operativa'
        });
        this.today = entryDate;
        this.nowTime = entryTime;
        this.logAction('entry.submit', 'ok', { length: data.content.length });
        this.isSubmitting = false;
      },
      error: (err) => {
        const msg = err.error?.message || 'Error creando entrada';
        this.snackBar.open(msg, 'Cerrar', { duration: 4000 });
        this.logAction('entry.submit', 'error', { message: msg });
        this.isSubmitting = false;
      }
    });
  }

  enforceContentMaxLength(): void {
    const contentControl = this.entryForm.get('content');
    if (!contentControl) {
      return;
    }

    const currentValue = String(contentControl.value || '');
    if (currentValue.length <= this.contentMaxLength) {
      return;
    }

    contentControl.setValue(currentValue.slice(0, this.contentMaxLength), { emitEvent: false });
  }

  private extractTagsFromContent(content: string): string[] {
    const tagRegex = /#([a-z][a-z0-9_-]{0,49})/gi;
    const matches = content.match(tagRegex);
    if (!matches) return [];
    
    return matches.map(tag => tag.substring(1).toLowerCase());
  }

  addTopTag(tag: string): void {
    const normalizedTag = this.normalizeTag(tag);
    if (!normalizedTag) {
      return;
    }

    if (this.hasTagInContent(normalizedTag)) {
      return;
    }

    const contentControl = this.entryForm.get('content');
    if (!contentControl) {
      return;
    }

    const currentValue = String(contentControl.value || '');
    const separator = currentValue.length > 0 && !/\s$/.test(currentValue) ? ' ' : '';
    const updatedValue = `${currentValue}${separator}#${normalizedTag}`;

    if (updatedValue.length > this.contentMaxLength) {
      this.snackBar.open('No se puede agregar el tag: se alcanzó el máximo de caracteres', 'Cerrar', { duration: 2500 });
      return;
    }

    contentControl.setValue(updatedValue);
    contentControl.markAsDirty();
    contentControl.markAsTouched();
  }

  hasTagInContent(tag: string): boolean {
    return this.contentTags.has(this.normalizeTag(tag));
  }

  openShiftReportDialog(mode: ShiftReportMode): void {
    const dialogRef = this.dialog.open(ShiftReportDialogComponent, {
      data: { mode },
      width: '720px',
      maxWidth: '95vw',
      autoFocus: false
    });

    dialogRef.afterClosed().subscribe((content: string | null) => {
      if (!content) {
        return;
      }

      const currentValue = String(this.entryForm.get('content')?.value || '').trim();
      if (!currentValue) {
        this.applyShiftReportContent(content);
        return;
      }

      const confirmRef = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Reemplazar contenido',
          message: 'Ya hay texto escrito en el formulario. ¿Quieres reemplazarlo con la plantilla generada?',
          confirmText: 'Reemplazar',
          cancelText: 'Cancelar'
        }
      });

      confirmRef.afterClosed().subscribe((confirmed: boolean) => {
        if (confirmed) {
          this.applyShiftReportContent(content);
        }
      });
    });
  }

  private applyShiftReportContent(content: string): void {
    const contentControl = this.entryForm.get('content');
    if (!contentControl) {
      return;
    }

    contentControl.setValue(content);
    contentControl.markAsDirty();
    contentControl.markAsTouched();
    this.syncContentTags(content);
  }

  private loadTopTags(): void {
    this.tagService.getAll().subscribe({
      next: (response) => {
        const rawTags = Array.isArray((response as any)?.tags)
          ? (response as any).tags
          : Array.isArray(response as any)
            ? (response as any)
            : [];

        const uniqueTags = new Set<string>();
        const tags: string[] = rawTags
          .map((tagInfo: unknown) => this.extractTagName(tagInfo))
          .map((tagName: string) => this.normalizeTag(tagName))
          .filter((tagName: string) => {
            if (!tagName || uniqueTags.has(tagName)) {
              return false;
            }
            uniqueTags.add(tagName);
            return true;
          });

        this.topTags = tags.slice(0, 10);
      },
      error: () => {
        this.topTags = [];
      }
    });
  }

  private syncContentTags(content: string): void {
    this.contentTags = new Set(this.extractTagsFromContent(content));
  }

  private normalizeTag(tag: string): string {
    return String(tag || '').trim().replace(/^#/, '').toLowerCase();
  }

  private extractTagName(tagInfo: unknown): string {
    if (typeof tagInfo === 'string') {
      return tagInfo;
    }

    if (!tagInfo || typeof tagInfo !== 'object') {
      return '';
    }

    const source = tagInfo as Record<string, unknown>;
    const candidates = [source['tag'], source['name'], source['_id']];
    const found = candidates.find((value) => typeof value === 'string' && String(value).trim().length > 0);
    return typeof found === 'string' ? found : '';
  }

  closeEasterEggOverlay(): void {
    this.showEasterEggOverlay = false;
    if (this.easterEggTimer) {
      clearTimeout(this.easterEggTimer);
      this.easterEggTimer = undefined;
    }
  }

  // 🦇 EE-BAT-001 — Interactividad
  onBatClick(batId: number): void {
    // 35% de probabilidad de cazar el murciélago con éxito
    const isSuccess = Math.random() < 0.35;
    if (isSuccess) {
      // Elimina la instancia cazada y notifica al servicio global del HUD
      this.batInstances = this.batInstances.filter(bat => bat.id !== batId);
      this.batService.registerCatch(this.batInstances.length);
      this.snackBar.open('🦇 ¡Murciélago cazado con éxito! (+1)', 'Cerrar', { duration: 2000 });
      console.log(`[EASTER_EGG] 🦇 ¡Murciélago cazado! Total: ${this.batService.snapshot.caught}`);
    } else {
      // Registra el intento fallido en el servicio global y fuerza la evasión
      this.batService.registerAttempt();
      console.log(`[EASTER_EGG] 🦇 ¡Fallo! Intentos: ${this.batService.snapshot.attempts}`);
      this.triggerBatEvasion(batId, 420, 24);
    }
  }

  onBatHover(): void {
    console.log('[EASTER_EGG] 🦇 ¿Intentas atraparme?');
  }

  onBatHoverLeave(): void {
    console.log('[EASTER_EGG] 🦇 ¡Todavía estoy aquí!');
  }

  private evaluateBatProximity(): void {
    const batElements = document.querySelectorAll('.bat-wrapper');
    batElements.forEach((node) => {
      const batEl = node as HTMLElement;
      const rawId = batEl.dataset['batId'];
      const batId = Number(rawId);
      if (!Number.isFinite(batId)) {
        return;
      }

      const rect = batEl.getBoundingClientRect();
      const batCenterX = rect.left + rect.width / 2;
      const batCenterY = rect.top + rect.height / 2;
      const distance = Math.sqrt(
        Math.pow(this.mouseX - batCenterX, 2) +
        Math.pow(this.mouseY - batCenterY, 2)
      );

      const batState = this.batInstances.find((item) => item.id === batId);
      if (!batState) {
        return;
      }

      const now = Date.now();
      const burstCooldownMs = 760;
      if (distance < 150 && (now - batState.lastBurstAt) > burstCooldownMs) {
        this.triggerBatSprint(batId, 320);
      }
    });
  }

  private triggerBatEvasion(batId: number, durationMs: number, strengthPx: number): void {
    const bat = this.batInstances.find((item) => item.id === batId);
    if (!bat) {
      return;
    }

    bat.isEvading = true;
    bat.lastBurstAt = Date.now();

    // Evasión por click: solo micro-desvío local para evitar saltos grandes.
    const lateral = (Math.random() < 0.5 ? -1 : 1) * (8 + Math.random() * strengthPx);
    const vertical = -2 - (Math.random() * (strengthPx * 0.45));
    bat.evadeX = Number(Math.max(-32, Math.min(32, lateral)).toFixed(1));
    bat.evadeY = Number(Math.max(-20, Math.min(12, vertical)).toFixed(1));

    const existingTimer = this.batEvasionTimers.get(batId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const evasionTimer = setTimeout(() => {
      bat.isEvading = false;
      bat.evadeX = 0;
      bat.evadeY = 0;
      this.batEvasionTimers.delete(batId);
    }, durationMs);

    this.batEvasionTimers.set(batId, evasionTimer);
  }

  private triggerBatSprint(batId: number, durationMs: number): void {
    const bat = this.batInstances.find((item) => item.id === batId);
    if (!bat) {
      return;
    }

    bat.isEvading = true;
    bat.lastBurstAt = Date.now();

    // Proximidad al mouse: micro-arranque local, sin alterar velocidad de keyframes.
    const lateral = (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10);
    const vertical = -4 - (Math.random() * 6);
    bat.evadeX = Number(Math.max(-18, Math.min(18, lateral)).toFixed(1));
    bat.evadeY = Number(Math.max(-14, Math.min(8, vertical)).toFixed(1));

    const existingTimer = this.batEvasionTimers.get(batId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const sprintTimer = setTimeout(() => {
      bat.isEvading = false;
      bat.evadeX = 0;
      bat.evadeY = 0;
      this.batEvasionTimers.delete(batId);
    }, durationMs);

    this.batEvasionTimers.set(batId, sprintTimer);
  }

  private syncBatInstances(content: string): void {
    const batMatches = content.match(/#bat(?!\w)/gi) || [];
    const requestedCount = Math.min(100, batMatches.length);
    const currentCount = this.batInstances.length;

    if (requestedCount <= currentCount) {
      return;
    }

    const toAdd = requestedCount - currentCount;
    for (let i = 0; i < toAdd; i++) {
      this.batInstances.push(this.createRandomBatInstance());
    }

    // Notifica al servicio global para que el HUD del layout principal se actualice
    this.batService.setActiveBats(this.batInstances.length);
    console.log(`[EASTER_EGG] 🦇 Murciélagos activos: ${this.batInstances.length}/100`);
  }

  private createRandomBatInstance(): BatInstance {
    const id = this.nextBatId++;
    const route = this.buildRandomBatRoute();

    return {
      id,
      driftX: Math.round((Math.random() * 22) - 6),
      driftY: Math.round((Math.random() * 38) - 19),
      evadeX: 0,
      evadeY: 0,
      moveDuration: Number((36 + (Math.random() * 32)).toFixed(2)),
      moveDelay: Number((Math.random() * -45).toFixed(2)),
      wobbleDuration: Number((2.4 + (Math.random() * 2.1)).toFixed(2)),
      wobbleDelay: Number((Math.random() * -5).toFixed(2)),
      route,
      isEvading: false,
      lastBurstAt: 0
    };
  }

  private buildRandomBatRoute(): number[] {
    const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
    const randomBetween = (min: number, max: number): number => min + (Math.random() * (max - min));

    // 10 pares x/y (20 números). Se fuerzan cruces por el centro para evitar trayectorias monotónicas.
    const centerX = randomBetween(46, 56);
    const centerY = randomBetween(44, 58);

    const x0 = randomBetween(6, 18);
    const y0 = randomBetween(10, 24);

    const x1 = randomBetween(20, 34);
    const y1 = randomBetween(10, 28);

    const x2 = clamp(centerX + randomBetween(-8, 8), 34, 66);
    const y2 = clamp(centerY + randomBetween(-16, -4), 16, 50);

    const x3 = randomBetween(72, 90);
    const y3 = randomBetween(12, 34);

    const x4 = randomBetween(74, 92);
    const y4 = randomBetween(42, 62);

    const x5 = clamp(centerX + randomBetween(-10, 10), 32, 68);
    const y5 = clamp(centerY + randomBetween(-6, 10), 28, 72);

    const x6 = randomBetween(26, 42);
    const y6 = randomBetween(62, 84);

    const x7 = clamp(centerX + randomBetween(-12, 12), 30, 70);
    const y7 = clamp(centerY + randomBetween(8, 20), 44, 86);

    const x8 = randomBetween(8, 24);
    const y8 = randomBetween(36, 62);

    const x9 = clamp(centerX + randomBetween(-9, 9), 34, 68);
    const y9 = clamp(centerY + randomBetween(-12, 10), 26, 76);

    return [x0, y0, x1, y1, x2, y2, x3, y3, x4, y4, x5, y5, x6, y6, x7, y7, x8, y8, x9, y9]
      .map((value) => Number(value.toFixed(2)));
  }

  getBatInlineStyle(bat: BatInstance): string {
    const routeVars = bat.route.map((value, index) => `--bat-p${index}:${value}`).join(';');

    return [
      `--bat-evade-x:${bat.evadeX}px`,
      `--bat-evade-y:${bat.evadeY}px`,
      `--bat-drift-x:${bat.driftX}px`,
      `--bat-drift-y:${bat.driftY}px`,
      `--bat-move-duration:${bat.moveDuration}s`,
      `--bat-move-delay:${bat.moveDelay}s`,
      `--bat-wobble-duration:${bat.wobbleDuration}s`,
      `--bat-wobble-delay:${bat.wobbleDelay}s`,
      routeVars
    ].join(';');
  }

  trackByBatId(_: number, bat: BatInstance): number {
    return bat.id;
  }

  private triggerEntryEasterEggIfNeeded(content: string): void {
    const tags = this.extractTagsFromContent(content);

    // 🦇 BAT EASTER EGG — un murciélago por cada #bat exacto, máximo 100.
    // (?!\w): #bat no debe disparar en #batman / #bat123 / #batimovil.
    this.syncBatInstances(content);

    // Generic easter egg system (config-driven)
    if (!this.entryEasterEggRules.length || this.showEasterEggOverlay) {
      return;
    }

    if (!tags.length) {
      return;
    }

    const now = Date.now();
    const matchedRule = this.entryEasterEggRules.find((rule) => {
      const normalizedHashtag = String(rule.hashtag || '').replace(/^#/, '').toLowerCase();
      if (!normalizedHashtag || !tags.includes(normalizedHashtag)) {
        return false;
      }

      const cooldownMs = Number(rule.payload?.cooldownMs) > 0
        ? Number(rule.payload?.cooldownMs)
        : 0;

      if (cooldownMs <= 0) {
        return true;
      }

      return (now - this.lastEasterEggTriggerAt) >= cooldownMs;
    });

    if (!matchedRule) {
      return;
    }

    this.lastEasterEggTriggerAt = now;
    this.easterEggImageUrl = matchedRule.payload?.imageUrl || '/scripts/Bender.png';
    this.showEasterEggOverlay = true;

    const durationMs = Number(matchedRule.payload?.durationMs) > 0
      ? Number(matchedRule.payload?.durationMs)
      : 3000;

    if (this.easterEggTimer) {
      clearTimeout(this.easterEggTimer);
    }

    this.easterEggTimer = setTimeout(() => {
      this.showEasterEggOverlay = false;
      this.easterEggTimer = undefined;
    }, durationMs);
  }

  private getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getLocalTimeString(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private logAction(action: string, result: 'ok' | 'error', data: Record<string, unknown> = {}): void {
    const user = this.authService.getCurrentUser();
    const payload = {
      ts: new Date().toISOString(),
      user: user?.username || 'anon',
      action,
      result,
      ...data
    };
    if (result === 'ok') {
      console.log('[ENTRY]', payload);
    } else {
      console.error('[ENTRY]', payload);
    }
  }
}

interface BatInstance {
  id: number;
  driftX: number;
  driftY: number;
  evadeX: number;
  evadeY: number;
  moveDuration: number;
  moveDelay: number;
  wobbleDuration: number;
  wobbleDelay: number;
  route: number[];
  isEvading: boolean;
  lastBurstAt: number;
}
