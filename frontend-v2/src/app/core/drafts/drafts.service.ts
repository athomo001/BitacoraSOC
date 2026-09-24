import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface Draft<T = unknown> {
  id: string;
  formType: string;
  draftKey: string;
  updatedAt: string;
  expiresAt: string;
  content: T;
}

/**
 * Autosave genérico (HU-7d): generaliza personal_notes a cualquier
 * formulario largo (bitácora, y lo que necesite la Fase 11 para checklist)
 * para que un reinicio o despliegue de bitacora-app no pierda trabajo en
 * curso.
 */
@Injectable({ providedIn: 'root' })
export class DraftsService {
  private readonly http = inject(HttpClient);

  async sync<T>(formType: string, draftKey: string, content: T): Promise<Draft<T>> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<Draft<T>>>('/api/drafts/sync', { formType, draftKey, content }))).data;
  }

  async list<T>(formType?: string): Promise<Draft<T>[]> {
    const params: Record<string, string> = {};
    if (formType) params['formType'] = formType;
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ items: Draft<T>[] }>>('/api/drafts', { params }))).data.items;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/drafts/${id}`));
  }

  /**
   * Autosave periódico de un formulario en curso: sincroniza cada
   * `intervalMs` (10s por defecto, HU-7d) y una última vez al ocultarse la
   * pestaña. Devuelve una función de limpieza para `ngOnDestroy`/`DestroyRef`.
   */
  autosave<T>(formType: string, draftKey: string, getContent: () => T, intervalMs = 10_000): () => void {
    const flush = () => {
      void this.sync(formType, draftKey, getContent());
    };
    const timer = setInterval(flush, intervalMs);
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }
}
