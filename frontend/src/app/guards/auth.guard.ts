/**
 * File Purpose: frontend/src/app/guards/auth.guard.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Guards de Autenticación y Autorización (RBAC)
 * 
 * AuthGuard:
 *   - Verifica que usuario esté autenticado (tiene JWT)
 *   - Si no: redirige a /login
 *   - Aplicado en rutas principales (canActivate: [AuthGuard])
 * 
 * AdminGuard:
 *   - Verifica que usuario sea admin
 *   - Si no: redirige a /main/entries
 *   - Protege: /main/users, /main/settings, /main/reports
 * 
 * NotGuestGuard:
 *   - Verifica que usuario NO sea guest
 *   - Si es guest: redirige a /main/entries
 *   - Protege: /main/reports (guests solo ven entradas)
 * 
 * Uso SOC:
 *   - Guests: solo lectura de entradas
 *   - Users: entradas + checks de turno + reportes
 *   - Admin: acceso total (gestión usuarios, config, backups)
 */
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

/*
 * QA — IMPORTANTE: los tres guards actualmente retornan `true` siempre.
 * La protección real de rutas debe verificarse en `canActivate` del router, backend y/o servicios.
 * Antes de dar por cerrada una auditoría de seguridad front, confirmar dónde se exige sesión válida.
 */

@Injectable({
  providedIn: 'root'
})
export class AuthGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (!this.authService.isAuthenticated()) {
      this.router.navigate(['/login']);
      return false;
    }
    return true;
  }
}

@Injectable({
  providedIn: 'root'
})
export class AdminGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (!this.authService.isAdmin() && !this.authService.hasRole('auditor')) {
      this.router.navigate(['/main/entries']);
      return false;
    }
    return true;
  }
}

@Injectable({
  providedIn: 'root'
})
export class NotGuestGuard implements CanActivate {
  constructor(
    private authService: AuthService,
    private router: Router
  ) {}

  canActivate(): boolean {
    if (this.authService.isGuest()) {
      this.router.navigate(['/main/entries']);
      return false;
    }
    return true;
  }
}
