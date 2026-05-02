/**
 * File Purpose: frontend/src/app/pages/escalation/escalation-routing.module.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { EscalationSimpleComponent } from './escalation-simple/escalation-simple.component';
import { EscalationAdminSimpleComponent } from './escalation-admin-simple/escalation-admin-simple.component';
import { AdminGuard } from '../../guards/admin.guard';
import { AuthGuard } from '../../guards/auth.guard';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'view',
    pathMatch: 'full'
  },
  {
    path: 'view',
    component: EscalationSimpleComponent,
    canActivate: [AuthGuard]
  },
  {
    path: 'admin',
    component: EscalationAdminSimpleComponent,
    canActivate: [AuthGuard, AdminGuard]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class EscalationRoutingModule {}
