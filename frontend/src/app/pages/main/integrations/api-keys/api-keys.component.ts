/**
 * File Purpose: frontend/src/app/pages/main/integrations/api-keys/api-keys.component.ts
 * Responsibilities: Definir el controlador para el módulo de administración de API Keys y logs de auditoría.
 * QA Notes: Implementa validaciones reactivas, manejo de errores detallado y compatibilidad con Angular Material.
 */

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../environments/environment';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect, MatOption } from '@angular/material/select';
import { MatButton } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { NgFor, NgIf, DatePipe } from '@angular/common';

interface ApiKeyData {
  _id: string;
  name: string;
  prefix: string;
  status: 'active' | 'revoked' | 'expired';
  permissions: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy?: {
    username: string;
    fullName: string;
  };
}

interface ApiLogData {
  _id: string;
  apiKeyId: string | null;
  apiKeyName: string;
  endpoint: string;
  method: string;
  ipAddress: string;
  status: number;
  actionDetails: string;
  timestamp: string;
}

@Component({
  selector: 'app-api-keys',
  templateUrl: './api-keys.component.html',
  styleUrls: ['./api-keys.component.scss'],
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatFormField,
    MatLabel,
    MatHint,
    MatInput,
    MatSelect,
    MatOption,
    MatButton,
    MatChipsModule,
    MatExpansionModule,
    NgIf,
    NgFor,
    DatePipe
  ]
})
export class ApiKeysComponent implements OnInit {
  // Opciones de permisos granulares
  readonly availablePermissions = [
    { value: 'users:read', label: 'Consultar Usuarios (users:read)' },
    { value: 'events:read', label: 'Consultar Eventos de Bitácora (events:read)' },
    { value: 'events:write', label: 'Registrar Eventos de Bitácora (events:write)' },
    { value: 'escalations:read', label: 'Consultar Escalaciones y Contactos (escalations:read)' },
    { value: 'templates:render', label: 'Renderizar Plantillas de Incidentes (templates:render)' }
  ];

  apiKeyForm: FormGroup;
  apiKeys: ApiKeyData[] = [];
  logs: ApiLogData[] = [];
  
  // Variables de paginación de logs
  logPage = 1;
  logTotalPages = 1;
  logLimit = 15;
  totalLogsCount = 0;

  // Estados
  loadingKeys = false;
  loadingLogs = false;
  creatingKey = false;
  revokingKeyId: string | null = null;
  showCreateForm = false;

  // Credencial recién creada (se muestra solo una vez en texto plano)
  newApiKeySecret: string | null = null;
  newApiKeyName: string | null = null;

  constructor(
    private fb: FormBuilder,
    private http: HttpClient,
    private snackBar: MatSnackBar
  ) {
    this.apiKeyForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100)]],
      permissions: [[], [Validators.required, Validators.minLength(1)]],
      expiresAt: [null]
    });
  }

  ngOnInit(): void {
    this.loadApiKeys();
    this.loadLogs();
  }

  /**
   * Carga las API Keys registradas
   */
  loadApiKeys(): void {
    this.loadingKeys = true;
    this.http.get<ApiKeyData[]>(`${environment.apiUrl}/api-keys`).subscribe({
      next: (data) => {
        this.apiKeys = data;
        this.loadingKeys = false;
      },
      error: (err) => {
        this.loadingKeys = false;
        console.error('[ApiKeysComponent/loadApiKeys] Error:', err);
        this.snackBar.open('Error al cargar las claves de API', 'Cerrar', { duration: 3000 });
      }
    });
  }

  /**
   * Carga el historial de logs de la API con paginación
   */
  loadLogs(): void {
    this.loadingLogs = true;
    this.http.get<any>(`${environment.apiUrl}/api-keys/logs`, {
      params: {
        page: this.logPage.toString(),
        limit: this.logLimit.toString()
      }
    }).subscribe({
      next: (res) => {
        this.logs = res.logs || [];
        this.logTotalPages = res.pagination?.pages || 1;
        this.totalLogsCount = res.pagination?.total || 0;
        this.loadingLogs = false;
      },
      error: (err) => {
        this.loadingLogs = false;
        console.error('[ApiKeysComponent/loadLogs] Error:', err);
        this.snackBar.open('Error al cargar el historial de logs', 'Cerrar', { duration: 3000 });
      }
    });
  }

  /**
   * Envía el formulario para crear una nueva clave
   */
  onCreateKey(): void {
    if (this.apiKeyForm.invalid) {
      this.apiKeyForm.markAllAsTouched();
      return;
    }

    this.creatingKey = true;
    const payload = this.apiKeyForm.value;

    this.http.post<any>(`${environment.apiUrl}/api-keys`, payload).subscribe({
      next: (res) => {
        this.creatingKey = false;
        this.newApiKeySecret = res.apiKey;
        this.newApiKeyName = res.data.name;
        this.apiKeyForm.reset({ permissions: [] });
        this.showCreateForm = false;
        this.snackBar.open('Clave de API generada con éxito.', 'Cerrar', { duration: 4000 });
        this.loadApiKeys();
      },
      error: (err) => {
        this.creatingKey = false;
        console.error('[ApiKeysComponent/create] Error:', err);
        const message = err.error?.message || 'Error al generar la clave de API';
        this.snackBar.open(message, 'Cerrar', { duration: 4000 });
      }
    });
  }

  /**
   * Revoca una API Key activa
   */
  onRevokeKey(id: string): void {
    if (!confirm('¿Está seguro de que desea revocar esta clave de API? Esta acción es irreversible y bloqueará todo acceso asociado de inmediato.')) {
      return;
    }

    this.revokingKeyId = id;
    this.http.put<any>(`${environment.apiUrl}/api-keys/${id}/revoke`, {}).subscribe({
      next: () => {
        this.revokingKeyId = null;
        this.snackBar.open('Clave de API revocada correctamente', 'Cerrar', { duration: 3000 });
        this.loadApiKeys();
        this.loadLogs(); // Refrescar los logs para mostrar la revocación
      },
      error: (err) => {
        this.revokingKeyId = null;
        console.error('[ApiKeysComponent/revoke] Error:', err);
        this.snackBar.open('Error al revocar la clave de API', 'Cerrar', { duration: 3000 });
      }
    });
  }

  /**
   * Copia la clave secreta al portapapeles
   */
  copySecretToClipboard(): void {
    if (!this.newApiKeySecret) return;
    navigator.clipboard.writeText(this.newApiKeySecret).then(() => {
      this.snackBar.open('Clave copiada al portapapeles', 'Cerrar', { duration: 2500 });
    }).catch(err => {
      console.error('[ApiKeysComponent/copy] Error copying text:', err);
      this.snackBar.open('No se pudo copiar de forma automática. Selecciónela manualmente.', 'Cerrar', { duration: 3500 });
    });
  }

  /**
   * Limpia la clave recién creada de la memoria
   */
  dismissSecretBanner(): void {
    this.newApiKeySecret = null;
    this.newApiKeyName = null;
  }

  // Métodos de paginación de logs
  goToPrevPage(): void {
    if (this.logPage > 1) {
      this.logPage--;
      this.loadLogs();
    }
  }

  goToNextPage(): void {
    if (this.logPage < this.logTotalPages) {
      this.logPage++;
      this.loadLogs();
    }
  }
}
