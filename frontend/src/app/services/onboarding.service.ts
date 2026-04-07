import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class OnboardingService {
  private readonly prefix = 'bitacora:onboarding:hidden:';

  shouldShow(moduleKey: string, username: string | null | undefined): boolean {
    const key = this.buildKey(moduleKey, username);
    return localStorage.getItem(key) !== '1';
  }

  hide(moduleKey: string, username: string | null | undefined): void {
    const key = this.buildKey(moduleKey, username);
    localStorage.setItem(key, '1');
  }

  private buildKey(moduleKey: string, username: string | null | undefined): string {
    const safeUser = (username || 'anon').trim().toLowerCase();
    return `${this.prefix}${safeUser}:${moduleKey}`;
  }
}
