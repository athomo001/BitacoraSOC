/**
 * File Purpose: frontend/src/app/pages/main/profile/profile.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { finalize } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { ThemeService } from '../../../services/theme.service';
import { Theme } from '../../../models/user.model';
import { UserService } from '../../../services/user.service';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { NgIf } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';

@Component({
    selector: 'app-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.scss'],
    imports: [ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatSelect, MatOption, MatButton, NgIf, MatProgressSpinner, MatHint]
})
export class ProfileComponent implements OnInit {
  profileForm!: FormGroup;
  passwordForm!: FormGroup;
  currentUser: any;
  isSavingProfile = false;
  isChangingPassword = false;
  themes: Theme[] = ['light', 'dark', 'sepia', 'pastel', 'cyberpunk'];

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private themeService: ThemeService,
    private userService: UserService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    this.initForms();
    this.loadProfile();
  }

  initForms(): void {
    this.profileForm = this.fb.group({
      fullName: [this.currentUser?.fullName || '', Validators.required],
      email: [this.currentUser?.email || '', [Validators.required, Validators.email]],
      theme: [this.themeService.getCurrentTheme(), Validators.required]
    });

    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    });
  }

  onThemeChange(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  private loadProfile(): void {
    this.userService.getProfile().subscribe({
      next: (user) => {
        this.currentUser = user;
        this.profileForm.patchValue({
          fullName: user.fullName,
          email: user.email,
          theme: user.theme || this.themeService.getCurrentTheme()
        });
        this.authService.updateCurrentUser(user);
      },
      error: (err) => {
        console.error('Error loading profile:', err);
        this.profileForm.patchValue({
          fullName: this.currentUser?.fullName || '',
          email: this.currentUser?.email || '',
          theme: this.themeService.getCurrentTheme()
        });
        this.profileForm.updateValueAndValidity({ emitEvent: false });
        this.snackBar.open(err.error?.message || 'No se pudo cargar el perfil', 'Cerrar', { duration: 3000 });
      }
    });
  }

  saveProfile(): void {
    if (this.profileForm.invalid) return;

    this.isSavingProfile = true;
    this.userService.updateProfile(this.profileForm.value)
      .pipe(finalize(() => {
        this.isSavingProfile = false;
      }))
      .subscribe({
        next: (response) => {
          const updatedUser = response.user;
          this.currentUser = updatedUser;
          this.authService.updateCurrentUser(updatedUser);
          this.themeService.setTheme(updatedUser.theme || this.profileForm.value.theme);
          this.snackBar.open('Perfil actualizado', 'Cerrar', { duration: 3000 });
        },
        error: (err) => {
          console.error('Error saving profile:', err);
          this.snackBar.open(err.error?.message || 'No se pudo actualizar el perfil', 'Cerrar', { duration: 3000 });
        }
      });
  }

  changePassword(): void {
    if (this.passwordForm.invalid) return;

    const { currentPassword, newPassword, confirmPassword } = this.passwordForm.value;
    if (newPassword !== confirmPassword) {
      this.snackBar.open('Las contrasenas no coinciden', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isChangingPassword = true;
    this.userService.updateProfile({ currentPassword, newPassword })
      .pipe(finalize(() => {
        this.isChangingPassword = false;
      }))
      .subscribe({
        next: () => {
          this.passwordForm.reset();
          this.snackBar.open('Contrasena actualizada', 'Cerrar', { duration: 3000 });
        },
        error: (err) => {
          console.error('Error changing password:', err);
          this.snackBar.open(err.error?.message || 'No se pudo cambiar la contrasena', 'Cerrar', { duration: 3000 });
        }
      });
  }
}