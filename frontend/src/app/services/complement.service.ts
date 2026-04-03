import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, tap } from 'rxjs';
import { environment } from '@env/environment';
import {
  Complement,
  ComplementSourceLimits,
  ComplementSourcePreview,
  ComplementSourcePublishResult,
  ComplementSourceValidation
} from '../models/complement.model';

@Injectable({
  providedIn: 'root'
})
export class ComplementService {
  private readonly API_URL = `${environment.apiUrl}/complements`;
  private readonly complementsChangedSubject = new Subject<void>();

  readonly complementsChanged$ = this.complementsChangedSubject.asObservable();

  constructor(private http: HttpClient) {}

  private notifyComplementsChanged(): void {
    this.complementsChangedSubject.next();
  }

  getActiveComplements(): Observable<Complement[]> {
    return this.http.get<Complement[]>(`${this.API_URL}/active`);
  }

  getSourceLimits(): Observable<ComplementSourceLimits> {
    return this.http.get<ComplementSourceLimits>(`${this.API_URL}/source/limits`);
  }

  validateSourceArchive(file: File): Observable<ComplementSourceValidation> {
    const formData = new FormData();
    formData.append('archive', file);
    return this.http.post<ComplementSourceValidation>(`${this.API_URL}/source/validate`, formData);
  }

  previewSourceArchive(file: File, config: Record<string, unknown> = {}): Observable<ComplementSourcePreview> {
    const formData = new FormData();
    formData.append('archive', file);
    formData.append('config', JSON.stringify(config));
    return this.http.post<ComplementSourcePreview>(`${this.API_URL}/source/preview`, formData);
  }

  publishSourceArchive(file: File, config: Record<string, unknown> = {}): Observable<ComplementSourcePublishResult> {
    const formData = new FormData();
    formData.append('archive', file);
    formData.append('config', JSON.stringify(config));
    return this.http
      .post<ComplementSourcePublishResult>(`${this.API_URL}/source/publish`, formData)
      .pipe(tap(() => this.notifyComplementsChanged()));
  }

  getComplements(): Observable<Complement[]> {
    return this.http.get<Complement[]>(this.API_URL);
  }

  getComplement(slug: string): Observable<Complement> {
    return this.http.get<Complement>(`${this.API_URL}/${slug}`);
  }

  createComplement(payload: Record<string, unknown>): Observable<{ complement: Complement; token: string; expiresAt: string }> {
    return this.http
      .post<{ complement: Complement; token: string; expiresAt: string }>(this.API_URL, payload)
      .pipe(tap(() => this.notifyComplementsChanged()));
  }

  updateComplement(slug: string, payload: Record<string, unknown>): Observable<Complement> {
    return this.http
      .put<Complement>(`${this.API_URL}/${slug}`, payload)
      .pipe(tap(() => this.notifyComplementsChanged()));
  }

  testComplement(slug: string): Observable<Record<string, unknown>> {
    return this.http.post<Record<string, unknown>>(`${this.API_URL}/${slug}/test`, {});
  }

  regenerateToken(slug: string): Observable<{ slug: string; token: string; expiresAt: string }> {
    return this.http.post<{ slug: string; token: string; expiresAt: string }>(`${this.API_URL}/${slug}/token`, {});
  }

  deleteComplement(slug: string, reason: string): Observable<{ message: string }> {
    return this.http
      .request<{ message: string }>('delete', `${this.API_URL}/${slug}`, {
        body: { reason }
      })
      .pipe(tap(() => this.notifyComplementsChanged()));
  }
}