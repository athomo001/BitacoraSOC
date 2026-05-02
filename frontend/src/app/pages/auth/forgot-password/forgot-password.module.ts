/**
 * File Purpose: frontend/src/app/pages/auth/forgot-password/forgot-password.module.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ForgotPasswordComponent } from './forgot-password.component';

const routes: Routes = [
  { path: '', component: ForgotPasswordComponent }
];

@NgModule({
  imports: [
    CommonModule,
    ForgotPasswordComponent,
    RouterModule.forChild(routes)
  ]
})
export class ForgotPasswordModule { }
