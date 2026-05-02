/**
 * File Purpose: frontend/src/app/guards/admin.guard.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Admin Guard - Protección de Rutas Admin
 * 
 * Funcionalidad:
 *   - Verifica que usuario autenticado sea admin
 *   - Si no es admin: redirige a /main/entries
 * 
 * Rutas protegidas:
 *   - /main/users (gestión de usuarios)
 *   - /main/settings (configuración global, SMTP, logo)
 *   - /main/reports (dashboards, exports)
 * 
 * Lógica:
 *   - getCurrentUser() obtiene user de localStorage
 *   - Valida role === 'admin'
 *   - Si falla: redirect a /main/entries (ruta segura para todos)
 */
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    const user = this.authService.getCurrentUser();
    const allowed = user?.role === 'admin' || user?.role === 'auditor';
    if (!allowed) {
      this.router.navigate(['/main/checklist']);
      return false;
    }
    return true;
  }
}
