import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import {
  Complement,
  ComplementFormValue,
  ComplementScope,
  ComplementSourceLimits,
  ComplementSourcePreview,
  ComplementSourceValidation
} from '../../../models/complement.model';
import { ComplementService } from '../../../services/complement.service';
import { UserService } from '../../../services/user.service';

@Component({
  selector: 'app-admin-complements',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTabsModule
  ],
  template: `
    <div class="complements-admin">
      <mat-card class="complements-list">
        <h2>Complementos Registrados</h2>
        <button mat-raised-button color="primary" (click)="startNew()">Nuevo complemento</button>

        <div class="complement-item" *ngFor="let item of complements" (click)="select(item)" [class.selected]="selectedComplement?._id === item._id">
          <div>
            <strong>{{ item.name }}</strong>
            <div>{{ item.slug }} · {{ item.status }} · {{ item.circuit.state }}</div>
          </div>
        </div>
      </mat-card>

      <mat-card class="complements-form">
        <h2>{{ selectedComplement ? 'Editar complemento' : 'Alta de complemento' }}</h2>

        <mat-tab-group [(selectedIndex)]="selectedTabIndex">
          <mat-tab label="Subir código fuente">
            <div class="tab-content">
              <div class="intro-card upload-intro-card">
                <div>
                  <strong>Camino recomendado para admins</strong>
                  <p>Sube un ZIP del complemento y el sistema te dirá si el paquete tiene un stack permitido, qué límites aplica y qué configuración recomienda.</p>
                </div>
              </div>

              <div class="limits-grid" *ngIf="sourceLimits">
                <div class="guide-item">
                  <strong>Stacks permitidos</strong>
                  <p>{{ sourceLimits.supportedLanguageSummary.join(', ') }}</p>
                  <p class="guide-subtitle">Ejemplos de lenguajes rechazados</p>
                  <p>{{ sourceLimits.blockedLanguages.join(', ') }}</p>
                </div>
                <div class="guide-item">
                  <strong>Límites del ZIP</strong>
                  <p>Tamaño máximo: {{ sourceLimits.maxArchiveMb }} MB por archivo ZIP</p>
                  <p>Máximo de archivos: {{ sourceLimits.maxFiles }} archivos por paquete</p>
                </div>
              </div>

              <div class="guide-item warning full-width" *ngIf="sourceLimits">
                <strong>Regla general</strong>
                <p>{{ sourceLimits.unsupportedPolicy }}</p>
              </div>

              <div class="upload-panel">
                <div>
                  <strong>1. Selecciona un ZIP</strong>
                  <p>Ejemplos válidos: HTML/JS simple, Vite, React + Vite, Node.js.</p>
                </div>
                <input type="file" accept=".zip,application/zip,application/x-zip-compressed" (change)="onSourceFileSelected($event)">
                <div class="upload-actions">
                  <button mat-raised-button color="primary" type="button" (click)="analyzeSourceFile()" [disabled]="!selectedSourceFile || sourceAnalyzing">
                    Analizar paquete
                  </button>
                  <button mat-stroked-button type="button" (click)="clearSourceAnalysis()" [disabled]="!selectedSourceFile && !sourceValidation">
                    Limpiar
                  </button>
                </div>
                <p class="muted" *ngIf="selectedSourceFile">Archivo seleccionado: {{ selectedSourceFile.name }}</p>
                <p class="muted" *ngIf="sourceAnalyzing">Analizando paquete...</p>
                <p class="analysis-error" *ngIf="sourceError">{{ sourceError }}</p>
              </div>

              <div class="analysis-panel" *ngIf="sourceValidation as analysis">
                <div class="analysis-header" [class.ok]="analysis.allowed" [class.bad]="!analysis.allowed">
                  <div>
                    <strong>{{ analysis.allowed ? 'Paquete permitido' : 'Paquete rechazado' }}</strong>
                    <p>{{ analysis.reason }}</p>
                  </div>
                  <div class="analysis-header-actions" *ngIf="analysis.allowed && analysis.suggestedConfig">
                    <button mat-stroked-button type="button" (click)="applySuggestedSourceConfig()">
                      Usar sugerencia
                    </button>
                    <button mat-stroked-button type="button" (click)="generateSourcePreview()" [disabled]="!isStaticHtmlSource || previewLoading">
                      {{ previewLoading ? 'Preparando preview...' : 'Preparar preview' }}
                    </button>
                    <button mat-raised-button color="primary" type="button" (click)="publishSourceFile()" [disabled]="!isStaticHtmlSource || publishLoading">
                      {{ publishLoading ? 'Publicando...' : 'Publicar ZIP' }}
                    </button>
                  </div>
                </div>

                <div class="analysis-grid">
                  <div class="guide-item">
                    <strong>Stack detectado</strong>
                    <p>{{ analysis.detectedStack?.label || 'No compatible' }}</p>
                  </div>
                  <div class="guide-item">
                    <strong>Lenguaje detectado</strong>
                    <p>{{ analysis.detectedLanguage }}</p>
                  </div>
                  <div class="guide-item">
                    <strong>Archivos del paquete</strong>
                    <p>{{ analysis.archive.fileCount }} archivos</p>
                  </div>
                  <div class="guide-item">
                    <strong>Siguiente paso</strong>
                    <p>{{ analysis.nextStep }}</p>
                  </div>
                </div>

                <div class="analysis-stack-card" *ngIf="analysis.detectedStack">
                  <h3>{{ analysis.detectedStack.label }}</h3>
                  <p>{{ analysis.detectedStack.description }}</p>
                  <p><strong>Runtime:</strong> {{ analysis.detectedStack.runtime }}</p>
                </div>

                <div class="analysis-files">
                  <h3>Archivos detectados</h3>
                  <pre>{{ analysis.archive.sampleFiles.join('\n') }}</pre>
                </div>

                <div class="analysis-files" *ngIf="analysis.packageJson">
                  <h3>package.json</h3>
                  <pre>{{ formatPackageJsonSummary(analysis) }}</pre>
                </div>

                <div class="guide-item warning full-width" *ngIf="analysis.allowed && !isStaticHtmlSource">
                  <strong>Publicación automática</strong>
                  <p>En esta fase el deploy automático quedó habilitado solo para HTML/JS simple. Los demás stacks siguen validados, pero no se publican solos todavía.</p>
                </div>

                <div class="preview-panel" *ngIf="sourcePreviewUrl">
                  <div class="preview-header">
                    <div>
                      <h3>Preview previo a publicar</h3>
                      <p>{{ sourcePreviewUrl }}</p>
                    </div>
                    <button mat-stroked-button type="button" (click)="openSourcePreview()">Abrir en pestaña</button>
                  </div>
                  <iframe class="preview-frame" [src]="safePreviewUrl"></iframe>
                </div>

                <div class="guide-item" *ngIf="publishedSourceUrl">
                  <strong>Última publicación</strong>
                  <p>{{ publishedSourceUrl }}</p>
                </div>
              </div>
            </div>
          </mat-tab>

          <mat-tab label="Configuración avanzada">
            <div class="tab-content">
              <div class="intro-card">
                <div>
                  <strong>Modo avanzado</strong>
                  <p>Úsalo si ya tienes el complemento corriendo y sabes cómo resolver URL pública e interna. Para admins normales, el camino recomendado es subir código fuente.</p>
                </div>
                <button mat-stroked-button type="button" (click)="applyLocalStubPreset()">Usar stub local de Docker</button>
              </div>

              <div class="guide-grid">
                <div class="guide-item">
                  <strong>Slug</strong>
                  <p>Identificador corto del complemento. Se genera desde el nombre y luego queda fijo.</p>
                </div>
                <div class="guide-item">
                  <strong>URL pública</strong>
                  <p>La usa el navegador para abrir el iframe. Ejemplo local: http://localhost:8080</p>
                </div>
                <div class="guide-item">
                  <strong>URL interna Docker</strong>
                  <p>La usa el backend para health checks y cleanup. Ejemplo local: http://complement-stub:8080</p>
                </div>
                <div class="guide-item warning">
                  <strong>Base de datos</strong>
                  <p>Hoy el sistema solo soporta base privada por complemento para borrado seguro. Compartir la misma DB principal no está implementado todavía.</p>
                </div>
              </div>

              <form [formGroup]="form" class="grid" (ngSubmit)="save()">
          <mat-form-field appearance="outline">
            <mat-label>Nombre</mat-label>
            <input matInput formControlName="name">
            <mat-hint>Ejemplo: Scanner de vulnerabilidades</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Slug</mat-label>
            <input matInput formControlName="slug" [readonly]="!!selectedComplement">
            <mat-hint>Se usa en la ruta del menú y en auditoría. Ejemplo: scanner-vuln</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>URL pública del complemento</mat-label>
            <input matInput formControlName="baseUrl">
            <mat-hint>La abre el navegador. Si estás en este PC, suele ser algo como http://localhost:8080</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>URL interna Docker (opcional)</mat-label>
            <input matInput formControlName="internalBaseUrl">
            <mat-hint>Solo si el backend está en Docker y necesita llegar al complemento por nombre de servicio. Ejemplo: http://complement-stub:8080</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Base de datos privada del complemento</mat-label>
            <input matInput formControlName="dbName">
            <mat-hint>Se genera sola y se usa para aislamiento. No comparte la DB principal.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Versión API</mat-label>
            <mat-select formControlName="apiVersion">
              <mat-option value="v1">v1</mat-option>
              <mat-option value="v2">v2</mat-option>
            </mat-select>
            <mat-hint>Déjalo en v2 salvo que el complemento sea legado.</mat-hint>
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Estado</mat-label>
            <mat-select formControlName="status">
              <mat-option value="active">active</mat-option>
              <mat-option value="maintenance">maintenance</mat-option>
              <mat-option value="disabled">disabled</mat-option>
            </mat-select>
            <mat-hint>active = visible en menú, maintenance = visible pero en revisión, disabled = oculto</mat-hint>
          </mat-form-field>

          <div class="full-width permissions-block">
            <h3>Permisos del complemento</h3>
            <p>Marca solo lo que realmente necesita. Ya no hace falta escribir CSV.</p>
            <div class="checkbox-grid">
              <mat-checkbox *ngFor="let scope of scopeOptions" [checked]="isScopeSelected(scope.value)" (change)="toggleScope(scope.value, $event.checked)">
                <span class="checkbox-title">{{ scope.label }}</span>
                <span class="checkbox-help">{{ scope.help }}</span>
              </mat-checkbox>
            </div>
          </div>

          <div class="full-width permissions-block">
            <h3>Áreas de datos permitidas</h3>
            <p>Define qué conjuntos de datos puede tocar el complemento.</p>
            <div class="checkbox-grid">
              <mat-checkbox *ngFor="let collection of collectionOptions" [checked]="isCollectionSelected(collection.value)" (change)="toggleCollection(collection.value, $event.checked)">
                <span class="checkbox-title">{{ collection.label }}</span>
                <span class="checkbox-help">{{ collection.help }}</span>
              </mat-checkbox>
            </div>
          </div>

          <div class="full-width permissions-block">
            <h3>Visibilidad en menú</h3>
            <p>Si no marcas nada, el complemento queda visible para todos los usuarios autenticados. Si marcas opciones, se mostrará cuando coincida el rol o el cargo.</p>
            <div class="checkbox-grid">
              <mat-checkbox *ngFor="let role of visibleRoleOptions" [checked]="isVisibleRoleSelected(role.value)" (change)="toggleVisibleRole(role.value, $event.checked)">
                <span class="checkbox-title">{{ role.label }}</span>
                <span class="checkbox-help">{{ role.help }}</span>
              </mat-checkbox>
            </div>

            <div class="checkbox-grid" *ngIf="availableCargoLabels.length > 0">
              <mat-checkbox *ngFor="let cargo of availableCargoLabels" [checked]="isVisibleCargoSelected(cargo)" (change)="toggleVisibleCargo(cargo, $event.checked)">
                <span class="checkbox-title">{{ cargo }}</span>
                <span class="checkbox-help">Visible para personas con ese cargo operativo.</span>
              </mat-checkbox>
            </div>
          </div>

          <div class="full-width advanced-toggle-row">
            <button mat-stroked-button type="button" (click)="advancedOpen = !advancedOpen">
              <mat-icon>{{ advancedOpen ? 'expand_less' : 'expand_more' }}</mat-icon>
              {{ advancedOpen ? 'Ocultar opciones avanzadas' : 'Mostrar opciones avanzadas' }}
            </button>
          </div>

          <ng-container *ngIf="advancedOpen">
            <mat-form-field appearance="outline">
              <mat-label>Ruta de health</mat-label>
              <input matInput formControlName="healthPath">
              <mat-hint>Normalmente /health</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Ruta de cleanup</mat-label>
              <input matInput formControlName="cleanupHookPath">
              <mat-hint>Se invoca al eliminar el complemento. Normalmente /hook/cleanup</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Ruta principal del iframe</mat-label>
              <input matInput formControlName="iframePath">
              <mat-hint>La pantalla que se abre dentro del menú. Normalmente /</mat-hint>
            </mat-form-field>
          </ng-container>

          <div class="actions full-width">
            <button mat-raised-button color="primary" type="submit">Guardar</button>
            <button mat-stroked-button type="button" (click)="testSelected()" [disabled]="!selectedComplement">Probar</button>
            <button mat-stroked-button type="button" (click)="regenerateToken()" [disabled]="!selectedComplement">Regenerar token</button>
            <button mat-stroked-button color="warn" type="button" (click)="deleteSelected()" [disabled]="!selectedComplement">Eliminar</button>
          </div>
              </form>
            </div>
          </mat-tab>
        </mat-tab-group>

        <div class="token-panel" *ngIf="lastIssuedToken">
          <h3>Último token emitido</h3>
          <pre>{{ lastIssuedToken }}</pre>
        </div>
      </mat-card>
    </div>
  `,
  styles: [`
    .complements-admin {
      display: grid;
      grid-template-columns: 320px minmax(0, 1fr);
      gap: 16px;
      padding: 16px;
    }

    .complements-list,
    .complements-form {
      padding: 12px;
    }

    .complement-item {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 12px;
      margin-top: 12px;
      cursor: pointer;
    }

    .complement-item.selected {
      border-color: #1b5fc6;
      background: #eff5ff;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .intro-card {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      border: 1px solid rgba(27, 95, 198, 0.15);
      background: #f5f8ff;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }

    .tab-content {
      padding-top: 10px;
    }

    .upload-intro-card {
      margin-bottom: 8px;
    }

    .limits-grid,
    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .upload-panel,
    .analysis-panel,
    .analysis-stack-card,
    .analysis-files {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 12px;
      background: #fcfcfd;
      margin-bottom: 10px;
    }

    .upload-actions {
      display: flex;
      gap: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .muted {
      color: #566173;
    }

    .analysis-error {
      color: #b42318;
      font-weight: 600;
      margin-top: 12px;
    }

    .analysis-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
      background: #fff3f2;
      border: 1px solid #f2b8b5;
    }

    .analysis-header.ok {
      background: #eefbf3;
      border-color: #9ed5af;
    }

    .analysis-header.bad {
      background: #fff3f2;
      border-color: #f2b8b5;
    }

    .analysis-header p {
      margin: 4px 0 0;
    }

    .analysis-header-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .analysis-files pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      background: #0f1720;
      color: #d9f7eb;
      border-radius: 12px;
      padding: 12px;
    }

    .intro-card p,
    .guide-item p,
    .permissions-block p {
      margin: 4px 0 0;
      color: #44506a;
    }

    .guide-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }

    .guide-item {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 10px;
      background: #fafbfc;
    }

    .guide-subtitle {
      margin-top: 8px;
      font-weight: 600;
      color: #1f2937;
    }

    .guide-item.warning {
      border-color: #f0c36d;
      background: #fff8e9;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    .permissions-block {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 16px;
      background: #fcfcfd;
    }

    .permissions-block h3 {
      margin: 0;
    }

    .checkbox-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 16px;
      margin-top: 12px;
    }

    mat-checkbox {
      display: block;
      padding: 8px 0;
    }

    .checkbox-title {
      display: block;
      font-weight: 600;
    }

    .checkbox-help {
      display: block;
      font-size: 12px;
      color: #556070;
      margin-top: 2px;
      white-space: normal;
    }

    .advanced-toggle-row {
      display: flex;
      justify-content: flex-start;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .preview-panel {
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 16px;
      background: #f8fbff;
      margin-bottom: 16px;
    }

    .preview-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .preview-header h3,
    .preview-header p {
      margin: 0;
    }

    .preview-frame {
      width: 100%;
      min-height: 420px;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 12px;
      background: #fff;
    }

    .token-panel {
      margin-top: 16px;
      background: #101826;
      color: #f3f7ff;
      border-radius: 12px;
      padding: 12px;
    }

    .token-panel pre {
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
    }

    @media (max-width: 960px) {
      .complements-admin {
        grid-template-columns: 1fr;
      }

      .intro-card,
      .guide-grid,
      .checkbox-grid,
      .limits-grid,
      .analysis-grid {
        grid-template-columns: 1fr;
      }

      .intro-card {
        align-items: flex-start;
        flex-direction: column;
      }

      .grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class AdminComplementsComponent implements OnInit {
  complements: Complement[] = [];
  selectedComplement: Complement | null = null;
  lastIssuedToken = '';
  advancedOpen = false;
  selectedTabIndex = 0;
  sourceLimits: ComplementSourceLimits | null = null;
  selectedSourceFile: File | null = null;
  sourceValidation: ComplementSourceValidation | null = null;
  sourceAnalyzing = false;
  sourceError = '';
  sourcePreview: ComplementSourcePreview | null = null;
  sourcePreviewUrl = '';
  safePreviewUrl: SafeResourceUrl | null = null;
  previewLoading = false;
  publishLoading = false;
  publishedSourceUrl = '';
  availableCargoLabels: string[] = ['N1', 'N2', 'TI'];

  readonly visibleRoleOptions: Array<{ value: 'admin' | 'user' | 'auditor' | 'guest'; label: string; help: string }> = [
    { value: 'admin', label: 'Administradores', help: 'Visible para cuentas con rol admin.' },
    { value: 'user', label: 'Usuarios operativos', help: 'Analistas y operación diaria.' },
    { value: 'auditor', label: 'Auditores', help: 'Revisión y lectura.' },
    { value: 'guest', label: 'Invitados', help: 'Acceso temporal de solo lectura.' }
  ];

  readonly scopeOptions: Array<{ value: ComplementScope; label: string; help: string }> = [
    { value: 'READ_CONTEXT', label: 'Leer contexto', help: 'Usuario actual, turno activo y tema visual.' },
    { value: 'WRITE_ENTRIES', label: 'Crear entradas', help: 'Permite registrar entradas en la bitácora principal.' },
    { value: 'READ_STORAGE', label: 'Leer almacenamiento', help: 'Lectura de archivos y objetos compartidos.' },
    { value: 'WRITE_STORAGE', label: 'Escribir almacenamiento', help: 'Subir o actualizar archivos y objetos compartidos.' },
    { value: 'WRITE_LOGS', label: 'Escribir logs', help: 'Registrar actividad propia en auditoría del sistema.' },
    { value: 'READ_LOGS', label: 'Leer logs', help: 'Consultar logs relacionados con el complemento.' }
  ];

  readonly collectionOptions: Array<{ value: string; label: string; help: string }> = [
    { value: 'entries', label: 'Entradas', help: 'Registros operativos de la bitácora.' },
    { value: 'auditlogs', label: 'Auditoría', help: 'Eventos y trazabilidad del sistema.' },
    { value: 'shared_storage', label: 'Almacenamiento compartido', help: 'Archivos y artefactos del complemento.' }
  ];

  readonly form = this.fb.group({
    slug: ['', [Validators.required]],
    name: ['', [Validators.required]],
    baseUrl: ['', [Validators.required]],
    internalBaseUrl: [''],
    dbName: [{ value: '', disabled: true }, [Validators.required]],
    apiVersion: ['v1', [Validators.required]],
    status: ['active', [Validators.required]],
    cleanupHookPath: ['/hook/cleanup', [Validators.required]],
    healthPath: ['/health', [Validators.required]],
    iframePath: ['/', [Validators.required]],
    scopes: [['READ_CONTEXT', 'WRITE_ENTRIES', 'READ_STORAGE', 'WRITE_STORAGE', 'WRITE_LOGS'] as ComplementScope[]],
    allowedCollections: [['entries', 'shared_storage', 'auditlogs']],
    visibleRoles: [[] as Array<'admin' | 'user' | 'auditor' | 'guest'>],
    visibleCargoLabels: [[] as string[]]
  });

  constructor(
    private fb: FormBuilder,
    private complementService: ComplementService,
    private userService: UserService,
    private sanitizer: DomSanitizer,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadAvailableCargoLabels();

    this.complementService.getSourceLimits().subscribe({
      next: (limits) => {
        this.sourceLimits = limits;
      }
    });

    this.form.controls.name.valueChanges.subscribe((name) => {
      if (this.selectedComplement) {
        return;
      }

      const currentSlug = this.form.controls.slug.value || '';
      const nextSlug = this.slugify(name || '');
      if (!currentSlug || currentSlug === this.slugify(currentSlug)) {
        this.form.controls.slug.setValue(nextSlug, { emitEvent: false });
      }
      this.syncDbName();
    });

    this.form.controls.slug.valueChanges.subscribe(() => {
      this.syncDbName();
    });

    this.reload();
    this.startNew();
  }

  onSourceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.selectedSourceFile = input.files?.[0] || null;
    this.sourceValidation = null;
    this.sourcePreview = null;
    this.sourcePreviewUrl = '';
    this.safePreviewUrl = null;
    this.publishedSourceUrl = '';
    this.sourceError = '';
  }

  analyzeSourceFile(): void {
    if (!this.selectedSourceFile) {
      return;
    }

    this.sourceAnalyzing = true;
    this.sourceError = '';
    this.sourceValidation = null;

    this.complementService.validateSourceArchive(this.selectedSourceFile).subscribe({
      next: (result) => {
        this.sourceValidation = result;
        this.sourceAnalyzing = false;
        if (result.allowed && result.suggestedConfig) {
          this.snackBar.open('Paquete analizado. Puedes usar la sugerencia.', 'Cerrar', { duration: 3000 });
        }
      },
      error: (error: any) => {
        this.sourceError = error?.error?.message || 'No se pudo analizar el paquete';
        this.sourceAnalyzing = false;
      }
    });
  }

  clearSourceAnalysis(): void {
    this.selectedSourceFile = null;
    this.sourceValidation = null;
    this.sourcePreview = null;
    this.sourcePreviewUrl = '';
    this.safePreviewUrl = null;
    this.publishedSourceUrl = '';
    this.sourceError = '';
    this.sourceAnalyzing = false;
  }

  private resolvePreviewUrl(raw: string): string {
    // Si viene como URL absoluta con /uploads/, extraer solo el path (funciona en dev y Docker)
    try {
      const parsed = new URL(raw);
      if (parsed.pathname.startsWith('/uploads/')) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
    } catch { /* ya es relativa */ }
    return raw;
  }

  generateSourcePreview(): void {
    if (!this.selectedSourceFile || !this.sourceValidation?.allowed) {
      return;
    }

    this.previewLoading = true;
    this.sourceError = '';

    this.complementService.previewSourceArchive(this.selectedSourceFile, this.buildSourcePublishPayload()).subscribe({
      next: (preview) => {
        this.sourcePreview = preview;
        this.sourcePreviewUrl = this.resolvePreviewUrl(preview.previewUrl);
        this.safePreviewUrl = this.sanitizer.bypassSecurityTrustResourceUrl(this.sourcePreviewUrl);
        this.previewLoading = false;
      },
      error: (error: any) => {
        this.sourceError = error?.error?.message || 'No se pudo generar el preview';
        this.previewLoading = false;
      }
    });
  }

  openSourcePreview(): void {
    if (this.sourcePreviewUrl) {
      window.open(this.sourcePreviewUrl, '_blank', 'noopener');
    }
  }

  publishSourceFile(): void {
    if (!this.selectedSourceFile || !this.sourceValidation?.allowed) {
      return;
    }

    this.publishLoading = true;
    this.sourceError = '';

    this.complementService.publishSourceArchive(this.selectedSourceFile, this.buildSourcePublishPayload()).subscribe({
      next: (response) => {
        this.publishLoading = false;
        this.publishedSourceUrl = response.publishedUrl;
        this.lastIssuedToken = response.token || '';
        this.snackBar.open('Complemento publicado', 'Cerrar', { duration: 3000 });
        this.reload();
        this.select(response.complement);
        this.selectedTabIndex = 1;
      },
      error: (error: any) => {
        this.sourceError = error?.error?.message || 'No se pudo publicar el ZIP';
        this.publishLoading = false;
      }
    });
  }

  applySuggestedSourceConfig(): void {
    if (!this.sourceValidation?.suggestedConfig) {
      return;
    }

    const suggestion = this.sourceValidation.suggestedConfig;
    this.selectedComplement = null;
    this.form.patchValue({
      slug: suggestion.slug,
      name: suggestion.name,
      baseUrl: '',
      internalBaseUrl: '',
      dbName: suggestion.dbName,
      apiVersion: suggestion.apiVersion,
      status: suggestion.status,
      cleanupHookPath: suggestion.cleanupHookPath,
      healthPath: suggestion.healthPath,
      iframePath: suggestion.iframePath,
      scopes: suggestion.permissions.scopes,
      allowedCollections: suggestion.permissions.allowedCollections,
      visibleRoles: this.form.controls.visibleRoles.value || [],
      visibleCargoLabels: this.form.controls.visibleCargoLabels.value || []
    });
    this.selectedTabIndex = 1;
    this.advancedOpen = true;
    this.snackBar.open('Sugerencia aplicada. Solo falta completar la URL pública y, si corresponde, la interna.', 'Cerrar', { duration: 4000 });
  }

  formatPackageJsonSummary(analysis: ComplementSourceValidation): string {
    if (!analysis.packageJson) {
      return 'Sin package.json';
    }

    return [
      `name: ${analysis.packageJson.name || '—'}`,
      `version: ${analysis.packageJson.version || '—'}`,
      `scripts: ${analysis.packageJson.scripts.join(', ') || '—'}`,
      `dependencies: ${analysis.packageJson.dependencies.slice(0, 12).join(', ') || '—'}`,
      `devDependencies: ${analysis.packageJson.devDependencies.slice(0, 12).join(', ') || '—'}`
    ].join('\n');
  }

  startNew(): void {
    this.selectedComplement = null;
    this.lastIssuedToken = '';
    this.advancedOpen = false;
    this.sourcePreview = null;
    this.sourcePreviewUrl = '';
    this.safePreviewUrl = null;
    this.publishedSourceUrl = '';
    this.form.reset({
      slug: '',
      name: '',
      baseUrl: '',
      internalBaseUrl: '',
      dbName: 'bitacora_ext_app',
      apiVersion: 'v2',
      status: 'active',
      cleanupHookPath: '/hook/cleanup',
      healthPath: '/health',
      iframePath: '/',
      scopes: ['READ_CONTEXT', 'WRITE_ENTRIES', 'READ_STORAGE', 'WRITE_STORAGE', 'WRITE_LOGS'],
      allowedCollections: ['entries', 'shared_storage', 'auditlogs'],
      visibleRoles: [],
      visibleCargoLabels: []
    });
    this.syncDbName();
  }

  select(complement: Complement): void {
    this.selectedComplement = complement;
    this.lastIssuedToken = '';
    this.advancedOpen = true;
    this.publishedSourceUrl = complement.sourceArtifact?.publishedUrl || '';
    this.sourcePreviewUrl = complement.sourceArtifact?.previewUrl || '';
    this.safePreviewUrl = this.sourcePreviewUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(this.sourcePreviewUrl)
      : null;
    this.form.patchValue({
      slug: complement.slug,
      name: complement.name,
      baseUrl: complement.baseUrl,
      internalBaseUrl: complement.internalBaseUrl || '',
      dbName: complement.dbName,
      apiVersion: complement.apiVersion,
      status: complement.status,
      cleanupHookPath: complement.cleanupHookPath,
      healthPath: complement.healthPath,
      iframePath: new URL(complement.iframeUrl).pathname || '/',
      scopes: complement.permissions.scopes,
      allowedCollections: complement.permissions.allowedCollections,
      visibleRoles: complement.visibility?.roles || [],
      visibleCargoLabels: complement.visibility?.cargoLabels || []
    });
  }

  applyLocalStubPreset(): void {
    this.form.patchValue({
      baseUrl: 'http://localhost:8080',
      internalBaseUrl: 'http://complement-stub:8080',
      healthPath: '/health',
      cleanupHookPath: '/hook/cleanup',
      iframePath: '/',
      apiVersion: 'v2',
      status: 'active'
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const payload = this.toPayload(this.form.getRawValue() as ComplementFormValue);
    if (this.selectedComplement) {
      this.complementService.updateComplement(this.selectedComplement.slug, payload).subscribe({
        next: () => {
          this.snackBar.open('Complemento guardado', 'Cerrar', { duration: 2500 });
          this.reload();
        },
        error: (error: any) => {
          this.snackBar.open(error?.error?.message || 'Error guardando complemento', 'Cerrar', { duration: 3500 });
        }
      });
      return;
    }

    this.complementService.createComplement(payload).subscribe({
      next: (response) => {
        this.lastIssuedToken = response.token;
        this.snackBar.open('Complemento guardado', 'Cerrar', { duration: 2500 });
        this.reload();
      },
      error: (error: any) => {
        this.snackBar.open(error?.error?.message || 'Error guardando complemento', 'Cerrar', { duration: 3500 });
      }
    });
  }

  testSelected(): void {
    if (!this.selectedComplement) {
      return;
    }

    this.complementService.testComplement(this.selectedComplement.slug).subscribe({
      next: () => {
        this.snackBar.open('Prueba ejecutada', 'Cerrar', { duration: 2500 });
        this.reload();
      },
      error: (error: any) => {
        this.snackBar.open(error?.error?.message || 'Prueba fallida', 'Cerrar', { duration: 3500 });
      }
    });
  }

  regenerateToken(): void {
    if (!this.selectedComplement) {
      return;
    }

    this.complementService.regenerateToken(this.selectedComplement.slug).subscribe({
      next: (response) => {
        this.lastIssuedToken = response.token;
        this.snackBar.open('Token regenerado', 'Cerrar', { duration: 2500 });
        this.reload();
      }
    });
  }

  deleteSelected(): void {
    if (!this.selectedComplement) {
      return;
    }

    const confirmed = window.confirm(`Eliminar ${this.selectedComplement.slug} con wipe-out completo?`);
    if (!confirmed) {
      return;
    }

    this.complementService.deleteComplement(this.selectedComplement.slug, 'DELETE_COMPLEMENTO').subscribe({
      next: () => {
        this.snackBar.open('Complemento eliminado', 'Cerrar', { duration: 2500 });
        this.startNew();
        this.reload();
      },
      error: (error: any) => {
        this.snackBar.open(error?.error?.message || 'No se pudo eliminar', 'Cerrar', { duration: 3500 });
      }
    });
  }

  private reload(): void {
    this.complementService.getComplements().subscribe({
      next: (complements) => {
        this.complements = complements;
        if (this.selectedComplement) {
          const fresh = complements.find((item) => item.slug === this.selectedComplement?.slug) || null;
          if (fresh) {
            this.select(fresh);
          }
        }
      }
    });
  }

  private toPayload(value: ComplementFormValue): Record<string, unknown> {
    const slug = this.slugify(value.slug);
    return {
      slug,
      name: value.name.trim(),
      baseUrl: value.baseUrl.trim(),
      internalBaseUrl: value.internalBaseUrl.trim(),
      dbName: (value.dbName || this.buildDbName(slug)).trim(),
      apiVersion: value.apiVersion,
      status: value.status,
      cleanupHookPath: value.cleanupHookPath.trim(),
      healthPath: value.healthPath.trim(),
      iframePath: value.iframePath.trim(),
      permissions: {
        scopes: value.scopes,
        allowedCollections: value.allowedCollections
      },
      visibility: {
        roles: value.visibleRoles,
        cargoLabels: value.visibleCargoLabels
      }
    };
  }

  isVisibleRoleSelected(role: 'admin' | 'user' | 'auditor' | 'guest'): boolean {
    return (this.form.controls.visibleRoles.value || []).includes(role);
  }

  toggleVisibleRole(role: 'admin' | 'user' | 'auditor' | 'guest', checked: boolean): void {
    const current = new Set(this.form.controls.visibleRoles.value || []);
    if (checked) {
      current.add(role);
    } else {
      current.delete(role);
    }
    this.form.controls.visibleRoles.setValue(Array.from(current));
  }

  isVisibleCargoSelected(cargo: string): boolean {
    return (this.form.controls.visibleCargoLabels.value || []).includes(cargo);
  }

  toggleVisibleCargo(cargo: string, checked: boolean): void {
    const current = new Set(this.form.controls.visibleCargoLabels.value || []);
    if (checked) {
      current.add(cargo);
    } else {
      current.delete(cargo);
    }
    this.form.controls.visibleCargoLabels.setValue(Array.from(current));
  }

  get isStaticHtmlSource(): boolean {
    return this.sourceValidation?.detectedStack?.key === 'static-html';
  }

  isScopeSelected(scope: ComplementScope): boolean {
    return (this.form.controls.scopes.value || []).includes(scope);
  }

  toggleScope(scope: ComplementScope, checked: boolean): void {
    const current = new Set(this.form.controls.scopes.value || []);
    if (checked) {
      current.add(scope);
    } else {
      current.delete(scope);
    }
    this.form.controls.scopes.setValue(Array.from(current) as ComplementScope[]);
  }

  isCollectionSelected(collection: string): boolean {
    return (this.form.controls.allowedCollections.value || []).includes(collection);
  }

  toggleCollection(collection: string, checked: boolean): void {
    const current = new Set(this.form.controls.allowedCollections.value || []);
    if (checked) {
      current.add(collection);
    } else {
      current.delete(collection);
    }
    this.form.controls.allowedCollections.setValue(Array.from(current));
  }

  private loadAvailableCargoLabels(): void {
    this.userService.getUsersList().subscribe({
      next: (users) => {
        const labels = new Set(this.availableCargoLabels);
        users.forEach((user) => {
          const cargoLabel = String(user.cargoLabel || '').trim();
          if (cargoLabel) {
            labels.add(cargoLabel);
          }
        });
        this.availableCargoLabels = Array.from(labels).sort((a, b) => a.localeCompare(b));
      }
    });
  }

  private buildSourcePublishPayload(): Record<string, unknown> {
    const raw = this.form.getRawValue() as ComplementFormValue;
    const suggestion = this.sourceValidation?.suggestedConfig;
    const sourceFileName = this.selectedSourceFile?.name.replace(/\.zip$/i, '') || 'complemento';
    const slug = this.slugify(raw.slug || suggestion?.slug || sourceFileName);
    const name = String(raw.name || suggestion?.name || slug || 'Complemento').trim();

    return {
      slug,
      name,
      dbName: String(raw.dbName || suggestion?.dbName || this.buildDbName(slug)).trim(),
      apiVersion: raw.apiVersion || suggestion?.apiVersion || 'v2',
      status: raw.status || suggestion?.status || 'active',
      permissions: {
        scopes: (raw.scopes?.length ? raw.scopes : suggestion?.permissions.scopes) || [],
        allowedCollections: (raw.allowedCollections?.length ? raw.allowedCollections : suggestion?.permissions.allowedCollections) || []
      },
      visibility: {
        roles: raw.visibleRoles || [],
        cargoLabels: raw.visibleCargoLabels || []
      },
      sourceArtifact: {
        previewUrl: this.sourcePreviewUrl || null,
        previewRelativePath: this.sourcePreview?.previewRelativePath || null,
        lastPreviewAt: this.sourcePreview ? new Date().toISOString() : null
      }
    };
  }

  private syncDbName(): void {
    const slug = this.slugify(this.form.controls.slug.value || this.form.controls.name.value || 'app');
    this.form.controls.dbName.setValue(this.buildDbName(slug), { emitEvent: false });
  }

  private slugify(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 32);
  }

  private buildDbName(slug: string): string {
    const normalized = (slug || 'app').replace(/-/g, '_');
    return `bitacora_ext_${normalized}`;
  }
}