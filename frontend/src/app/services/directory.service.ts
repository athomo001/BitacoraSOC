import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type DirectoryContactType = 'Internal' | 'External' | 'List';
export type DirectoryContactScope = 'Internal' | 'External';
export type DirectoryContactSource = 'User' | 'Manual' | 'Sync';

export interface DirectoryContact {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  type: DirectoryContactType;
  scope?: DirectoryContactScope;
  source?: DirectoryContactSource;
  isFavorite: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface DirectoryContactPayload {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  position?: string;
  type?: DirectoryContactType;
  scope?: DirectoryContactScope;
  source?: DirectoryContactSource;
  isFavorite?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class DirectoryService {
  private readonly apiUrl = `${environment.apiUrl}/directory`;

  constructor(private readonly http: HttpClient) {}

  getAll(type?: DirectoryContactType): Observable<DirectoryContact[]> {
    let params = new HttpParams();
    if (type) {
      params = params.set('type', type);
    }
    return this.http.get<DirectoryContact[]>(this.apiUrl, { params });
  }

  quickSearch(query: string): Observable<DirectoryContact[]> {
    const params = new HttpParams().set('query', query.trim());
    return this.http.get<DirectoryContact[]>(`${this.apiUrl}/search`, { params });
  }

  create(payload: DirectoryContactPayload): Observable<DirectoryContact> {
    return this.http.post<DirectoryContact>(this.apiUrl, payload);
  }

  update(id: string, payload: DirectoryContactPayload): Observable<DirectoryContact> {
    return this.http.put<DirectoryContact>(`${this.apiUrl}/${id}`, payload);
  }

  delete(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }

  rebuildFromEscalation(): Observable<{ message: string; totalDirectoryContacts: number }> {
    return this.http.post<{ message: string; totalDirectoryContacts: number }>(
      `${this.apiUrl}/rebuild-from-escalation`,
      {}
    );
  }

  mergeDuplicates(): Observable<{
    message: string;
    mergedGroups: number;
    removedDuplicates: number;
    totalDirectoryContacts: number;
  }> {
    return this.http.post<{
      message: string;
      mergedGroups: number;
      removedDuplicates: number;
      totalDirectoryContacts: number;
    }>(`${this.apiUrl}/merge-duplicates`, {});
  }

  syncUsersFromDirectory(): Observable<{
    message: string;
    scannedInternalContacts: number;
    matchedUsers: number;
    updatedUsers: number;
  }> {
    return this.http.post<{
      message: string;
      scannedInternalContacts: number;
      matchedUsers: number;
      updatedUsers: number;
    }>(`${this.apiUrl}/sync-users-from-directory`, {});
  }

  syncUsersToDirectory(): Observable<{
    message: string;
    totalUsers: number;
    syncedCount: number;
    errorCount: number;
    defaultCompany: string;
  }> {
    return this.http.post<{
      message: string;
      totalUsers: number;
      syncedCount: number;
      errorCount: number;
      defaultCompany: string;
    }>(`${this.apiUrl}/sync-users-to-directory`, {});
  }

  /**
   * Envía un archivo CSV al backend para importar masivamente contactos al directorio.
   * @param file - Archivo CSV a importar.
   */
  importCsv(file: File): Observable<{
    message: string;
    created: number;
    updated: number;
    errorCount: number;
    errors?: any[];
  }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http.post<{
      message: string;
      created: number;
      updated: number;
      errorCount: number;
      errors?: any[];
    }>(`${this.apiUrl}/import-csv`, formData);
  }
}
