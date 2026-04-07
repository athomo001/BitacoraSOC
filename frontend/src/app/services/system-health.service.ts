import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '@env/environment';

export interface HealthServiceState {
  status: 'ok' | 'warn' | 'down';
  detail: string;
  lastCheckAt?: string | null;
  checkedAt?: string | null;
}

export interface HealthSummaryResponse {
  checkedAt: string;
  services: {
    smtp: HealthServiceState;
    mongo: HealthServiceState;
    internalApi: HealthServiceState;
    integrations: HealthServiceState;
  };
}

@Injectable({
  providedIn: 'root'
})
export class SystemHealthService {
  private readonly apiUrl = `${environment.apiUrl}/system/health-summary`;

  constructor(private http: HttpClient) {}

  getHealthSummary(): Observable<HealthSummaryResponse> {
    return this.http.get<HealthSummaryResponse>(this.apiUrl);
  }
}
