import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

export interface SystemFeature {
  code: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  configPayload: Record<string, unknown>;
  updatedAt: string;
}

/** GET/PATCH /api/system-features — "cero .env" (docs/adr/0009). */
@Injectable({ providedIn: 'root' })
export class SystemFeaturesService {
  private readonly http = inject(HttpClient);

  async list(): Promise<SystemFeature[]> {
    const response = await firstValueFrom(this.http.get<ApiEnvelope<SystemFeature[]>>('/api/system-features'));
    return response.data;
  }

  async setEnabled(code: string, isEnabled: boolean): Promise<SystemFeature> {
    const response = await firstValueFrom(
      this.http.patch<ApiEnvelope<SystemFeature>>(`/api/system-features/${code}`, { isEnabled }),
    );
    return response.data;
  }
}
