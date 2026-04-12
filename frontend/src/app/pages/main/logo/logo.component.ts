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

  currentLogo: string = '';
  currentFavicon: string = '';
  logoUrl: string = '';
  faviconUrl: string = '';
  isLoading = false;
  previewUrl: string = '';
  faviconPreviewUrl: string = '';
  private backendBaseUrl = environment.backendBaseUrl;

  // LogSource
  logSources: any[] = [];
  brandingForm: FormGroup;
  savingBranding = false;
  savingAppTitle = false;
  loginTheme: 'crt' | 'infoflow' = 'crt';
  savingLoginTheme = false;

  constructor() {
    this.brandingForm = this.fb.group({
      appTitle: [''],
      defaultLogSourceId: [null]
    });
  }

  ngOnInit(): void {
    this.loadCurrentLogo();
    this.loadCurrentFavicon();
    this.loadLogSources();
    this.loadBrandingConfig();
  }

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

  loadBrandingConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config: any) => {
        this.brandingForm.patchValue({
          appTitle: config.appTitle || ''
        });

        this.loginTheme = config.loginTheme || 'crt';

        if (config.defaultLogSourceId) {
          const sourceId = typeof config.defaultLogSourceId === 'object' 
            ? config.defaultLogSourceId._id 
            : config.defaultLogSourceId;
          this.brandingForm.patchValue({
            defaultLogSourceId: sourceId
          });
        }
      },
      error: (err: any) => {
        console.error('Error cargando config:', err);
      }
    });
  }

  saveAppTitle(): void {
    this.savingAppTitle = true;
    const data = {
      appTitle: (this.brandingForm.value.appTitle || '').trim()
    };

    this.configService.updateConfig(data).subscribe({
      next: () => {
        this.savingAppTitle = false;
        this.snackBar.open('Título superior guardado', 'Cerrar', { duration: 3000 });
      },
      error: (err: any) => {
        this.savingAppTitle = false;
        this.snackBar.open(err.error?.message || 'Error guardando título', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveBrandingConfig(): void {
    if (!this.brandingForm.valid) return;

    this.savingBranding = true;
    const data = {
      defaultLogSourceId: this.brandingForm.value.defaultLogSourceId
    };

    this.configService.updateConfig(data).subscribe({
      next: () => {
        this.savingBranding = false;
        this.snackBar.open('Configuración por defecto guardada', 'Cerrar', { duration: 3000 });
      },
      error: (err: any) => {
        this.savingBranding = false;
        this.snackBar.open(err.error?.message || 'Error guardando configuración', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveLoginTheme(): void {
    this.savingLoginTheme = true;
    this.configService.updateConfig({ loginTheme: this.loginTheme }).subscribe({
      next: () => {
        this.savingLoginTheme = false;
        this.snackBar.open('Tema de login actualizado', 'Cerrar', { duration: 3000 });
      },
      error: (err: any) => {
        this.savingLoginTheme = false;
        this.snackBar.open(err.error?.message || 'Error guardando tema', 'Cerrar', { duration: 3000 });
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
        this.logoUrl = this.currentLogo;
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
        this.faviconUrl = this.currentFavicon;
      },
      error: () => {
        this.currentFavicon = '';
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (!file.type.match('image.*')) {
      this.snackBar.open('Solo se permiten imágenes', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.snackBar.open('El archivo es muy grande (máx 5MB)', 'Cerrar', { duration: 3000 });
      return;
    }

    // Preview
    const reader = new FileReader();
    reader.onload = () => {
      this.previewUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  uploadLogo(): void {
    if (!this.previewUrl) {
      this.snackBar.open('Selecciona una imagen primero', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.http.post<any>(`${environment.apiUrl}/config/logo`, { 
      logoData: this.previewUrl 
    }).subscribe({
      next: (response) => {
        this.currentLogo = response.logoUrl;
        this.previewUrl = '';
        this.isLoading = false;
        this.snackBar.open('Logo actualizado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error subiendo logo', 'Cerrar', { duration: 3000 });
      }
    });
  }

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

    const reader = new FileReader();
    reader.onload = () => {
      this.faviconPreviewUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  uploadFavicon(): void {
    if (!this.faviconPreviewUrl) {
      this.snackBar.open('Selecciona un favicon primero', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.http.post<any>(`${environment.apiUrl}/config/favicon`, {
      faviconData: this.faviconPreviewUrl
    }).subscribe({
      next: (response) => {
        this.currentFavicon = response.faviconUrl;
        this.faviconUrl = this.currentFavicon;
        this.faviconPreviewUrl = '';
        this.isLoading = false;
        this.snackBar.open('Favicon actualizado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error subiendo favicon', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveLogo(): void {
    if (!this.logoUrl) {
      this.snackBar.open('Ingresa una URL', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.http.post<any>(`${environment.apiUrl}/config/logo`, { 
      logoUrl: this.logoUrl 
    }).subscribe({
      next: (response) => {
        this.currentLogo = response.logoUrl;
        this.isLoading = false;
        this.snackBar.open('Logo actualizado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error guardando logo', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveFavicon(): void {
    if (!this.faviconUrl) {
      this.snackBar.open('Ingresa una URL', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    this.http.post<any>(`${environment.apiUrl}/config/favicon`, {
      faviconUrl: this.faviconUrl
    }).subscribe({
      next: (response) => {
        this.currentFavicon = response.faviconUrl;
        this.isLoading = false;
        this.snackBar.open('Favicon actualizado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error guardando favicon', 'Cerrar', { duration: 3000 });
      }
    });
  }

  removeLogo(): void {
    if (!confirm('¿Eliminar el logo actual?')) return;

    this.isLoading = true;
    this.http.delete(`${environment.apiUrl}/config/logo`).subscribe({
      next: () => {
        this.currentLogo = '';
        this.logoUrl = '';
        this.previewUrl = '';
        this.isLoading = false;
        this.snackBar.open('Logo eliminado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error eliminando logo', 'Cerrar', { duration: 3000 });
      }
    });
  }

  removeFavicon(): void {
    if (!confirm('¿Eliminar el favicon actual?')) return;

    this.isLoading = true;
    this.http.delete(`${environment.apiUrl}/config/favicon`).subscribe({
      next: () => {
        this.currentFavicon = '';
        this.faviconUrl = '';
        this.faviconPreviewUrl = '';
        this.isLoading = false;
        this.snackBar.open('Favicon eliminado', 'Cerrar', { duration: 3000 });
      },
      error: (err) => {
        this.isLoading = false;
        this.snackBar.open(err.error?.message || 'Error eliminando favicon', 'Cerrar', { duration: 3000 });
      }
    });
  }
}
