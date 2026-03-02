/**
 * Componente de Escribir Entradas de Bitácora
 * Pantalla simple para crear nuevas entradas con clasificación Operativa/Incidente
 */
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { EntryService } from '../../../services/entry.service';
import { CatalogService } from '../../../services/catalog.service';
import { CatalogLogSource } from '../../../models/catalog.model';
import { CreateEntryRequest } from '../../../models/entry.model';
import { AuthService } from '../../../services/auth.service';
import { ConfigService } from '../../../services/config.service';
import { EasterEggRule } from '../../../models/config.model';
import { MatCard, MatCardContent } from '@angular/material/card';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { NgIf, NgFor } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatRadioGroup, MatRadioButton } from '@angular/material/radio';
import { MatSelect, MatOption } from '@angular/material/select';

@Component({
    selector: 'app-entries',
    templateUrl: './entries.component.html',
    styleUrls: ['./entries.component.scss'],
    imports: [MatCard, MatCardContent, ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatHint, MatButton, NgIf, MatIcon, MatProgressSpinner, MatRadioGroup, MatRadioButton, MatSelect, MatOption, NgFor]
})
export class EntriesComponent implements OnInit {
  entryForm: FormGroup;
  today = '';
  nowTime = '';
  isSubmitting = false;
  logSources: CatalogLogSource[] = [];
  showEasterEggOverlay = false;
  easterEggImageUrl = '/scripts/Bender.png';

  private entryEasterEggRules: EasterEggRule[] = [];
  private easterEggTimer?: ReturnType<typeof setTimeout>;
  private lastEasterEggTriggerAt = 0;

  constructor(
    private fb: FormBuilder,
    private entryService: EntryService,
    private catalogService: CatalogService,
    private configService: ConfigService,
    private snackBar: MatSnackBar,
    private authService: AuthService
  ) {
    this.entryForm = this.fb.group({
      content: ['', [Validators.required, Validators.maxLength(50000)]],
      entryType: ['operativa', Validators.required],
      clientId: [null] // Cliente/Log Source (B2i)
    });

    const now = new Date();
    this.today = this.getLocalDateString(now);
    this.nowTime = this.getLocalTimeString(now);
  }

  ngOnInit(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.entryEasterEggRules = (config.easterEggRules || [])
          .filter((rule) => rule.enabled !== false && rule.scope === 'entry' && rule.triggerType === 'hashtag');
      },
      error: () => {
        this.entryEasterEggRules = [];
      }
    });

    this.entryForm.get('content')?.valueChanges.subscribe((value: string) => {
      this.triggerEntryEasterEggIfNeeded(value || '');
    });

    // Cargar clientes disponibles
    this.catalogService.searchLogSources('').subscribe(
      (result) => {
        this.logSources = result.items || [];
      },
      () => {
        // Error silencioso, no es crítico
      }
    );
  }

  onSubmit(): void {
    if (this.isSubmitting || !this.entryForm.valid) {
      return;
    }

    const now = new Date();
    const entryDate = this.getLocalDateString(now);
    const entryTime = this.getLocalTimeString(now);

    const data: CreateEntryRequest = {
      ...this.entryForm.value,
      entryDate,
      entryTime,
      tags: this.extractTagsFromContent(this.entryForm.value.content)
    };
    
    this.isSubmitting = true;
    this.entryService.createEntry(data).subscribe({
      next: () => {
        this.snackBar.open('✅ Entrada creada exitosamente', 'Cerrar', { duration: 3000 });
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

  private extractTagsFromContent(content: string): string[] {
    const tagRegex = /#(\w+)/g;
    const matches = content.match(tagRegex);
    if (!matches) return [];
    
    return matches.map(tag => tag.substring(1).toLowerCase());
  }

  closeEasterEggOverlay(): void {
    this.showEasterEggOverlay = false;
    if (this.easterEggTimer) {
      clearTimeout(this.easterEggTimer);
      this.easterEggTimer = undefined;
    }
  }

  private triggerEntryEasterEggIfNeeded(content: string): void {
    if (!this.entryEasterEggRules.length || this.showEasterEggOverlay) {
      return;
    }

    const tags = this.extractTagsFromContent(content);
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
