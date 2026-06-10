/**
 * File Purpose: frontend/src/app/pages/main/complement-container/complement-container.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ComplementService } from '../../../services/complement.service';
import { Complement } from '../../../models/complement.model';
import { ComplementBridgeService } from '../../../services/complement-bridge.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-complement-container',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="complement-page is-empty" *ngIf="loading">
      <section class="status-panel">Cargando complemento...</section>
    </div>

    <div class="complement-page is-empty" *ngIf="!loading && !complement">
      <section class="status-panel">
        <h2>{{ accessDenied ? 'Acceso restringido' : 'Complemento no encontrado' }}</h2>
        <p>{{ accessDenied ? 'Tu rol o cargo no tiene visibilidad sobre este complemento.' : 'El complemento solicitado no está activo o fue removido.' }}</p>
      </section>
    </div>

    <div class="complement-page" *ngIf="complement">
      <header class="complement-header" [class.is-open]="complement.circuit.state === 'OPEN'">
        <div class="header-copy">
          <h1>{{ complement.name }}</h1>
        </div>

        <div class="header-actions">
          <button mat-stroked-button color="primary" *ngIf="complement.circuit.state === 'OPEN'" (click)="retryHealthCheck()">
            <mat-icon>refresh</mat-icon>
            Reintentar
          </button>

          <span class="state-badge" [ngClass]="{
            'ok': complement.circuit.state === 'CLOSED',
            'warning': complement.circuit.state === 'HALF_OPEN',
            'maintenance': complement.circuit.state === 'OPEN'
          }">
            {{ complement.circuit.state === 'CLOSED' ? 'Activo' : complement.circuit.state === 'HALF_OPEN' ? 'Verificando' : 'Mantenimiento' }}
          </span>
        </div>
      </header>

      <section class="status-panel warning-panel" *ngIf="complement.circuit.state === 'OPEN'">
        <p>El complemento fue aislado por el circuito de resiliencia. La aplicación principal sigue operativa.</p>
        <p *ngIf="complement.circuit.lastError">Último error: {{ complement.circuit.lastError }}</p>
      </section>

      <section class="frame-stage" *ngIf="complement.circuit.state !== 'OPEN'">
      <iframe
        #complementFrame
        class="complement-frame"
        [src]="safeIframeUrl"
        sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
        referrerpolicy="no-referrer"
        loading="lazy"
        (load)="registerBridge()"></iframe>
      </section>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      /* Rompe el max-width: 1320px del content-wrapper > * */
      max-width: none !important;
      width: 100%;
    }

    .complement-page {
      /* Cancela el padding del content-wrapper (20px top, 24px sides, 28px bottom) */
      margin: -20px -24px -28px;
    }

    .complement-page.is-empty {
      padding: 40px 32px;
      min-height: calc(100vh - 108px);
    }

    .complement-header {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding: 6px 16px;
      min-height: 40px;
      background: var(--surface-color, #fff);
      border-bottom: 1px solid var(--outline-subtle, rgba(0,0,0,0.07));
    }

    .complement-header.is-open {
      background: #fffaf0;
      border-color: rgba(196, 137, 0, 0.2);
    }

    /* Título oculto — el nombre ya está en el menú lateral */
    .header-copy {
      display: none;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .state-badge {
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 11px;
      font-weight: 700;
      background: #e7eefc;
      color: #244a9a;
    }

    .state-badge.ok {
      background: #e0f5e7;
      color: #0d6b3d;
    }

    .state-badge.warning,
    .state-badge.maintenance {
      background: #fff1d6;
      color: #8a5b00;
    }

    .status-panel {
      margin: 16px 20px;
      padding: 18px 22px;
      border-radius: 14px;
      background: var(--surface-color, #ffffff);
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
    }

    .status-panel h2,
    .status-panel p {
      margin: 0;
    }

    .status-panel p + p,
    .status-panel h2 + p {
      margin-top: 8px;
    }

    .warning-panel {
      background: #fffaf0;
      border-color: rgba(196, 137, 0, 0.18);
    }

    .frame-stage {
      /* Sin bordes ni padding — el iframe ocupa todo */
      overflow: hidden;
      background: var(--surface-color, #ffffff);
    }

    .complement-frame {
      width: 100%;
      /* 68px toolbar + 40px header banda + 40px complement-header */
      height: calc(100vh - 148px);
      border: 0;
      background: #fff;
      display: block;
    }

    @media (max-width: 900px) {
      .complement-page {
        margin: -16px -16px -20px;
      }

      .complement-frame {
        height: calc(100vh - 160px);
      }
    }
  `]
})
export class ComplementContainerComponent implements OnInit, OnDestroy {
  @ViewChild('complementFrame') complementFrame?: ElementRef<HTMLIFrameElement>;

  complement: Complement | null = null;
  loading = true;
  safeIframeUrl: SafeResourceUrl | null = null;
  accessDenied = false;
  private routeSub?: Subscription;

  constructor(
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private complementService: ComplementService,
    private bridgeService: ComplementBridgeService
  ) {}

  ngOnInit(): void {
    // Suscripción reactiva para escuchar cambios en los parámetros de ruta sin forzar F5
    this.routeSub = this.route.paramMap.subscribe(params => {
      const slug = params.get('slug');
      // Desregistrar bridge del frame anterior si ya existía
      if (this.complement) {
        this.bridgeService.unregisterFrame(this.complement.slug);
      }
      if (!slug) {
        this.complement = null;
        this.safeIframeUrl = null;
        this.loading = false;
        return;
      }
      this.loadComplement(slug);
    });
  }

  ngOnDestroy(): void {
    // Limpieza de suscripciones y bridges al destruir el componente
    if (this.routeSub) {
      this.routeSub.unsubscribe();
    }
    if (this.complement) {
      this.bridgeService.unregisterFrame(this.complement.slug);
    }
  }

  registerBridge(): void {
    if (!this.complement || !this.complementFrame) {
      return;
    }

    this.bridgeService.registerFrame(this.complement.slug, this.complementFrame.nativeElement.contentWindow, this.complement.baseUrl);
  }

  retryHealthCheck(): void {
    if (!this.complement) {
      return;
    }

    this.complementService.testComplement(this.complement.slug).subscribe({
      next: () => this.loadComplement(this.complement!.slug)
    });
  }

  private resolveIframeUrl(iframeUrl: string): string {
    // Normalizar: si viene como URL absoluta con /uploads/, dejar solo el path relativo
    // para que funcione en dev (4200→proxy→3000), Docker (80→nginx→3000) y HTTPS (443)
    try {
      const parsed = new URL(iframeUrl);
      if (parsed.pathname.startsWith('/uploads/')) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
    } catch { /* ya es relativa, usarla tal cual */ }
    return iframeUrl;
  }

  private loadComplement(slug: string): void {
    this.loading = true;
    this.accessDenied = false;
    this.complementService.getComplement(slug).subscribe({
      next: (complement) => {
        this.complement = complement;
        this.safeIframeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.resolveIframeUrl(complement.iframeUrl));
        this.loading = false;
      },
      error: (error) => {
        this.complement = null;
        this.safeIframeUrl = null;
        this.accessDenied = error?.status === 403;
        this.loading = false;
      }
    });
  }

}