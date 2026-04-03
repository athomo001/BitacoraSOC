import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ComplementService } from '../../../services/complement.service';
import { Complement } from '../../../models/complement.model';
import { ComplementBridgeService } from '../../../services/complement-bridge.service';

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
        sandbox="allow-scripts allow-same-origin allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
        (load)="registerBridge()"></iframe>
      </section>
    </div>
  `,
  styles: [`
    .complement-page {
      padding: 20px 24px 24px;
    }

    .complement-page.is-empty {
      min-height: calc(100vh - 160px);
    }

    .complement-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      padding: 0 2px;
    }

    .complement-header.is-open {
      margin-bottom: 12px;
    }

    .header-copy h1 {
      margin: 0;
      font-size: clamp(1.7rem, 2vw, 2.2rem);
      line-height: 1.1;
      color: var(--text-primary, #1a2233);
    }

    .header-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .state-badge {
      border-radius: 999px;
      padding: 7px 14px;
      font-size: 12px;
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
      padding: 22px 24px;
      border-radius: 18px;
      background: var(--surface-color, #ffffff);
      border: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
    }

    .status-panel h2,
    .status-panel p {
      margin: 0;
    }

    .status-panel p + p,
    .status-panel h2 + p {
      margin-top: 10px;
    }

    .warning-panel {
      margin-bottom: 16px;
      background: #fffaf0;
      border-color: rgba(196, 137, 0, 0.18);
    }

    .frame-stage {
      border-radius: 20px;
      overflow: hidden;
      background: var(--surface-color, #ffffff);
      border: 1px solid rgba(0, 0, 0, 0.07);
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.05);
    }

    .complement-frame {
      width: 100%;
      min-height: calc(100vh - 180px);
      border: 0;
      background: #fff;
      display: block;
    }

    @media (max-width: 900px) {
      .complement-page {
        padding: 16px;
      }

      .complement-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .header-actions {
        justify-content: flex-start;
      }

      .complement-frame {
        min-height: calc(100vh - 220px);
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

  constructor(
    private route: ActivatedRoute,
    private sanitizer: DomSanitizer,
    private complementService: ComplementService,
    private bridgeService: ComplementBridgeService
  ) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.loading = false;
      return;
    }

    this.loadComplement(slug);
  }

  ngOnDestroy(): void {
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