import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';
import { downloadFile } from '../download';

/** Lo que se carga por CSV (10g); cada uno vive bajo su propia ruta de la API. */
export type ImportKind = 'users' | 'organizations' | 'windows' | 'entries';

export interface ImportRow {
  line: number;
  code: string;
  name: string;
  action: 'create' | 'update' | 'unchanged' | 'error';
  detail?: string;
  error?: string;
  /** Contraseña temporal de un usuario recién creado: se muestra una sola vez. */
  secret?: string;
}

export interface ImportResult { rows: ImportRow[]; created: number; updated: number; unchanged: number; errors: number; applied: boolean; }

const BASE: Record<ImportKind, string> = {
  users: '/api/users',
  organizations: '/api/organizations',
  windows: '/api/maintenance-windows',
  entries: '/api/entries',
};

const FILE: Record<ImportKind, string> = {
  users: 'usuarios',
  organizations: 'organizaciones',
  windows: 'ventanas-de-mantenimiento',
  entries: 'bitacora-entradas',
};

/** Cargas masivas por CSV (10g): plantilla, exportar lo que hay, revisión y carga. */
@Injectable({ providedIn: 'root' })
export class ImportsService {
  private readonly http = inject(HttpClient);

  /** Usuarios y organizaciones se exportan en el formato de la carga; la Bitácora tiene su propio export. */
  exportable(kind: ImportKind): boolean {
    return kind === 'users' || kind === 'organizations';
  }

  /** Revisión (dryRun) o carga final: el archivo viaja desde el navegador y no se guarda. */
  async run(kind: ImportKind, csv: string, dryRun: boolean): Promise<ImportResult> {
    const params = new HttpParams().set('dryRun', String(dryRun));
    const headers = new HttpHeaders({ 'Content-Type': 'text/csv' });
    return (await firstValueFrom(this.http.post<ApiEnvelope<ImportResult>>(`${BASE[kind]}/import`, csv, { params, headers }))).data;
  }

  downloadTemplate(kind: ImportKind): Promise<void> {
    return downloadFile(this.http, `${BASE[kind]}/import/template`, `${FILE[kind]}.csv`);
  }

  downloadExport(kind: ImportKind): Promise<void> {
    return downloadFile(this.http, `${BASE[kind]}/export`, `${FILE[kind]}-exportado.csv`);
  }
}
