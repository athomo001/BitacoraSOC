/**
 * File Purpose: frontend/src/app/pages/auth/reset-password/reset-password.module.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ResetPasswordComponent } from './reset-password.component';

const routes: Routes = [
  { path: '', component: ResetPasswordComponent }
];

@NgModule({
  imports: [
    CommonModule,
    ResetPasswordComponent,
    RouterModule.forChild(routes)
  ]
})
export class ResetPasswordModule { }
