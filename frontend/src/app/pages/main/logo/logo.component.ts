/**
 * File Purpose: frontend/src/app/pages/main/logo/logo.component.ts
 * Responsibilities: Define el comportamiento de control para la pantalla de Branding del sistema.
 * QA Notes: Integra la lógica de fuentes personalizadas, subida en memoria de logotipos y favicons, y un botón de guardado global.
 */

import { Component, OnInit, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { NgIf } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ReactiveFormsModule, FormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatSelect, MatOption } from '@angular/material/select';
import { NgFor } from '@angular/common';
import { CatalogService } from '../../../services/catalog.service';
import { ConfigService } from '../../../services/config.service';

@Component({
    selector: 'app-logo',
    templateUrl: './logo.component.html',
    styleUrls: ['./logo.component.scss'],
    imports: [NgIf, MatIcon, MatButton, MatProgressSpinner, MatFormField, MatLabel, MatInput, ReactiveFormsModule, FormsModule, MatHint, MatSelect, MatOption, NgFor]
})
export class LogoComponent implements OnInit {
  private http = inject(HttpClient);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private catalogService = inject(CatalogService);
  private configService = inject(ConfigService);

  // Estados actuales del Branding cargados del servidor
  currentLogo: string = '';
  currentFavicon: string = '';
  private backendBaseUrl = environment.backendBaseUrl;

  // Variables de control del formulario principal
  logSources: any[] = [];
  brandingForm: FormGroup;
  savingGlobal = false;

  // Tipos de origen para la subida de imágenes ('upload' = Local, 'url' = URL externa)
  logoSourceType: 'upload' | 'url' = 'upload';
  faviconSourceType: 'upload' | 'url' = 'upload';

  // Cambios pendientes en memoria para Logotipo
  pendingLogoFile: File | null = null;
  pendingLogoPreview: string = '';
  pendingLogoUrl: string = '';
  logoDeleted = false;

  // Cambios pendientes en memoria para Favicon
  pendingFaviconFile: File | null = null;
  pendingFaviconPreview: string = '';
  pendingFaviconUrl: string = '';
  faviconDeleted = false;

  // Gestión de fuentes tipográficas del título
  defaultFonts: string[] = ['Monarchia Momentum', 'Orbitron', 'Audiowide', 'Roboto', 'Courier New', 'Impact'];
  availableFonts: string[] = ['Monarchia Momentum', 'Orbitron', 'Audiowide', 'Roboto', 'Courier New', 'Impact'];
  customFonts: any[] = [];
  selectedFontFile: File | null = null;
  uploadingFont = false;
  // Control de visibilidad del instalador de fuentes integrado
  showFontManager = false;

  toggleFontManager(): void {
    this.showFontManager = !this.showFontManager;
  }

  constructor() {
    this.brandingForm = this.fb.group({
      appTitle: [''],
      titleFont: ['Monarchia Momentum'],
      loginTheme: ['crt'],
      defaultLogSourceId: [null]
    });
  }

  ngOnInit(): void {
    this.loadCurrentLogo();
    this.loadCurrentFavicon();
    this.loadLogSources();
    this.loadBrandingConfig();
    this.loadCustomFonts();
  }

  // Carga de catálogos de clientes/logsources
  loadLogSources(): void {
    this.catalogService.getAllLogSources().subscribe({
      next: (response: any) => {
        this.logSources = response.items || response || [];
      },
      error: (err: any) => {
        console.error('Error cargando LogSources:', err);
        this.snackBar.open('Error cargando LogSources', 'Cerrar', { duration: 3000 });
      }
    });
  }

  // Cargar configuración de Branding y rellenar formulario reactivo
  loadBrandingConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config: any) => {
        this.brandingForm.patchValue({
          appTitle: config.appTitle || '',
          titleFont: config.titleFont || 'Monarchia Momentum',
          loginTheme: config.loginTheme || 'crt'
        });

        // Configurar los orígenes en base al tipo guardado
        this.logoSourceType = (config.logoType === 'external' || config.logoType === 'url') ? 'url' : 'upload';
        this.faviconSourceType = (config.faviconType === 'external' || config.faviconType === 'url') ? 'url' : 'upload';

        // Inicializar URLs de entrada
        this.pendingLogoUrl = (config.logoType === 'external' || config.logoType === 'url') ? config.logoUrl || '' : '';
        this.pendingFaviconUrl = (config.faviconType === 'external' || config.faviconType === 'url') ? config.faviconUrl || '' : '';

        // Resetear cambios temporales
        this.pendingLogoFile = null;
        this.pendingLogoPreview = '';
        this.logoDeleted = false;

        this.pendingFaviconFile = null;
        this.pendingFaviconPreview = '';
        this.faviconDeleted = false;

        if (config.defaultLogSourceId) {
          const sourceId = typeof config.defaultLogSourceId === 'object' 
            ? config.defaultLogSourceId._id 
            : config.defaultLogSourceId;
          this.brandingForm.patchValue({
            defaultLogSourceId: sourceId
          });
        }

        // Marcar formulario como limpio al inicio
        this.brandingForm.markAsPristine();
      },
      error: (err: any) => {
        console.error('Error cargando config:', err);
      }
    });
  }

  // Controlar selección de archivos de logotipo
  onLogoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.match('image.*')) {
      this.snackBar.open('Solo se permiten imágenes', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open('La imagen es muy grande (máx 5MB)', 'Cerrar', { duration: 3000 });
      return;
    }

    this.pendingLogoFile = file;
    this.logoDeleted = false;
    this.brandingForm.markAsDirty();

    const reader = new FileReader();
    reader.onload = () => {
      this.pendingLogoPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  // Controlar selección de archivos de favicon
  onFaviconFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const allowedMimeTypes = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'];
    if (!allowedMimeTypes.includes(file.type)) {
      this.snackBar.open('Solo se permiten favicons PNG o ICO', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 256 * 1024) {
      this.snackBar.open('El favicon es muy grande (máx 256KB)', 'Cerrar', { duration: 3000 });
      return;
    }

    this.pendingFaviconFile = file;
    this.faviconDeleted = false;
    this.brandingForm.markAsDirty();

    const reader = new FileReader();
    reader.onload = () => {
      this.pendingFaviconPreview = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  // Acciones de marcado para eliminación de logotipo y favicon en UI
  deleteLogoVisual(): void {
    this.logoDeleted = true;
    this.pendingLogoFile = null;
    this.pendingLogoPreview = '';
    this.pendingLogoUrl = '';
    this.brandingForm.markAsDirty();
  }

  deleteFaviconVisual(): void {
    this.faviconDeleted = true;
    this.pendingFaviconFile = null;
    this.pendingFaviconPreview = '';
    this.pendingFaviconUrl = '';
    this.brandingForm.markAsDirty();
  }

  // Detectar cambios en inputs de texto de URLs externas
  onImageUrlChanged(): void {
    this.brandingForm.markAsDirty();
  }

  // Cambiar tipo de origen (Local / Externa)
  setLogoSourceType(type: 'upload' | 'url'): void {
    if (this.logoSourceType !== type) {
      this.logoSourceType = type;
      this.brandingForm.markAsDirty();
    }
  }

  setFaviconSourceType(type: 'upload' | 'url'): void {
    if (this.faviconSourceType !== type) {
      this.faviconSourceType = type;
      this.brandingForm.markAsDirty();
    }
  }

  // Verificar si hay algún cambio pendiente por guardar
  hasPendingChanges(): boolean {
    return this.brandingForm.dirty || 
           this.logoDeleted || 
           this.faviconDeleted || 
           !!this.pendingLogoPreview || 
           !!this.pendingFaviconPreview;
  }

  // Cancelar todos los cambios y restablecer estado original
  cancelChanges(): void {
    this.loadBrandingConfig();
    this.snackBar.open('Cambios cancelados', 'Cerrar', { duration: 2000 });
  }

  // Guardar todas las configuraciones globalmente
  saveGlobalChanges(): void {
    if (!this.brandingForm.valid) return;
    this.savingGlobal = true;

    // Arreglo de promesas para procesar cada cambio asíncrono
    const operations: Promise<any>[] = [];

    // 1. Guardar o eliminar el Logotipo
    if (this.logoDeleted) {
      operations.push(new Promise((resolve, reject) => {
        this.http.delete(`${environment.apiUrl}/config/logo`).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    } else if (this.logoSourceType === 'upload' && this.pendingLogoPreview) {
      operations.push(new Promise((resolve, reject) => {
        this.http.post<any>(`${environment.apiUrl}/config/logo`, { logoData: this.pendingLogoPreview }).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    } else if (this.logoSourceType === 'url' && this.pendingLogoUrl) {
      operations.push(new Promise((resolve, reject) => {
        this.http.post<any>(`${environment.apiUrl}/config/logo`, { logoUrl: this.pendingLogoUrl }).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    }

    // 2. Guardar o eliminar el Favicon
    if (this.faviconDeleted) {
      operations.push(new Promise((resolve, reject) => {
        this.http.delete(`${environment.apiUrl}/config/favicon`).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    } else if (this.faviconSourceType === 'upload' && this.pendingFaviconPreview) {
      operations.push(new Promise((resolve, reject) => {
        this.http.post<any>(`${environment.apiUrl}/config/favicon`, { faviconData: this.pendingFaviconPreview }).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    } else if (this.faviconSourceType === 'url' && this.pendingFaviconUrl) {
      operations.push(new Promise((resolve, reject) => {
        this.http.post<any>(`${environment.apiUrl}/config/favicon`, { faviconUrl: this.pendingFaviconUrl }).subscribe({
          next: () => resolve(true),
          error: (err) => reject(err)
        });
      }));
    }

    // 3. Guardar la configuración de texto y tema
    const configData = {
      appTitle: (this.brandingForm.value.appTitle || '').trim(),
      titleFont: this.brandingForm.value.titleFont || 'Monarchia Momentum',
      loginTheme: this.brandingForm.value.loginTheme || 'crt',
      defaultLogSourceId: this.brandingForm.value.defaultLogSourceId
    };

    operations.push(new Promise((resolve, reject) => {
      this.configService.updateConfig(configData).subscribe({
        next: () => resolve(true),
        error: (err) => reject(err)
      });
    }));

    // Ejecutar todas las transacciones asíncronas
    Promise.all(operations).then(() => {
      this.savingGlobal = false;
      this.snackBar.open('Configuración de branding guardada exitosamente', 'Cerrar', { duration: 3000 });
      this.loadCurrentLogo();
      this.loadCurrentFavicon();
      this.loadBrandingConfig();
    }).catch((err) => {
      this.savingGlobal = false;
      this.snackBar.open(err.error?.message || 'Error al guardar los cambios de branding', 'Cerrar', { duration: 3000 });
    });
  }

  // ─── MÉTODOS PARA GESTIÓN DE FUENTES PERSONALIZADAS ────────────────────────

  // Cargar fuentes personalizadas desde la base de datos y combinarlas con las por defecto
  loadCustomFonts(): void {
    this.configService.getCustomFonts().subscribe({
      next: (fonts) => {
        this.customFonts = fonts;
        this.availableFonts = [...this.defaultFonts, ...fonts.map(f => f.name)];

        // Inyectar en caliente en el DOM para previsualizar inmediatamente en los selectores y títulos
        const oldStyle = document.getElementById('dynamic-custom-fonts');
        if (oldStyle) {
          oldStyle.remove();
        }

        if (fonts && fonts.length > 0) {
          const style = document.createElement('style');
          style.id = 'dynamic-custom-fonts';
          style.innerHTML = fonts.map(f => `
            @font-face {
              font-family: '${f.name}';
              src: url('${this.getAssetUrl(f.url)}') format('${f.format}');
              font-weight: normal;
              font-style: normal;
              font-display: swap;
            }
          `).join('\n');
          document.head.appendChild(style);
        }
      },
      error: (err) => {
        console.error('Error al cargar fuentes personalizadas:', err);
      }
    });
  }

  // Manejar la selección del archivo de fuente tipográfica
  onFontFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    const allowedExtensions = ['.ttf', '.otf', '.woff', '.woff2'];
    const filename = file.name.toLowerCase();
    const isValid = allowedExtensions.some(ext => filename.endsWith(ext));

    if (!isValid) {
      this.snackBar.open('Solo se permiten archivos de fuentes (.ttf, .otf, .woff, .woff2)', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open('El archivo de fuente no puede superar los 5MB', 'Cerrar', { duration: 3000 });
      return;
    }

    this.selectedFontFile = file;
  }

  // Subir la fuente seleccionada al backend para detección de metadatos automáticos
  uploadCustomFont(): void {
    if (!this.selectedFontFile) {
      this.snackBar.open('Debe seleccionar un archivo de fuente primero', 'Cerrar', { duration: 3000 });
      return;
    }

    this.uploadingFont = true;
    this.configService.uploadCustomFont(this.selectedFontFile).subscribe({
      next: () => {
        this.uploadingFont = false;
        this.selectedFontFile = null;
        this.snackBar.open('Fuente personalizada instalada con éxito', 'Cerrar', { duration: 3000 });
        this.loadCustomFonts();
      },
      error: (err) => {
        this.uploadingFont = false;
        this.snackBar.open(err.error?.message || 'Error al subir la fuente tipográfica', 'Cerrar', { duration: 3000 });
      }
    });
  }

  // Eliminar una fuente personalizada
  deleteCustomFont(id: string, name: string): void {
    if (!confirm(`¿Estás seguro de eliminar la fuente "${name}"? Si está seleccionada para el título, se restablecerá a Monarchia Momentum.`)) {
      return;
    }

    this.configService.deleteCustomFont(id).subscribe({
      next: () => {
        this.snackBar.open('Fuente eliminada exitosamente', 'Cerrar', { duration: 3000 });
        // Si la fuente borrada es la activa en el select, la cambiamos a la predeterminada
        if (this.brandingForm.value.titleFont === name) {
          this.brandingForm.patchValue({ titleFont: 'Monarchia Momentum' });
        }
        this.loadCustomFonts();
      },
      error: (err) => {
        this.snackBar.open(err.error?.message || 'Error al eliminar la fuente', 'Cerrar', { duration: 3000 });
      }
    });
  }

  getAssetUrl(url: string): string {
    if (!url) return '';
    // Si es URL completa (http/https), retornarla tal cual
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    // Si es ruta relativa, construir URL del backend
    return `${this.backendBaseUrl}${url}`;
  }

  loadCurrentLogo(): void {
    this.http.get<any>(`${environment.apiUrl}/config/logo`).subscribe({
      next: (response) => {
        this.currentLogo = response.logoUrl || '';
      },
      error: () => {
        this.currentLogo = '';
      }
    });
  }

  loadCurrentFavicon(): void {
    this.http.get<any>(`${environment.apiUrl}/config/favicon`).subscribe({
      next: (response) => {
        this.currentFavicon = response.faviconUrl || '';
      },
      error: () => {
        this.currentFavicon = '';
      }
    });
  }
}
