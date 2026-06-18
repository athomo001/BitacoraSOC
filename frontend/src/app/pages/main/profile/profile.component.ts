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
import { environment } from '@env/environment';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton } from '@angular/material/button';
import { NgIf, UpperCasePipe } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.scss'],
    imports: [ReactiveFormsModule, MatFormField, MatLabel, MatInput, MatSelect, MatOption, MatButton, NgIf, UpperCasePipe, MatProgressSpinner, MatHint, MatIcon]
})
export class ProfileComponent implements OnInit {
  profileForm!: FormGroup;
  passwordForm!: FormGroup;
  mfaForm!: FormGroup;
  mfaDisableForm!: FormGroup;
  currentUser: any;
  isSavingProfile = false;
  isChangingPassword = false;
  isSavingMfa = false;
  isDisablingMfa = false;
  isUploadingAvatar = false;
  backendBaseUrl = environment.backendBaseUrl;
  // Comentario: Listado local de temas visuales que se exponen al usuario en su formulario de perfil. Se eliminan sepia y dark.
  themes: Theme[] = ['light', 'pastel', 'cyberpunk'];
  mfaStep: 'inactive' | 'setup' | 'active' = 'inactive';
  mfaQrCode = '';
  mfaSecret = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private themeService: ThemeService,
    private userService: UserService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.currentUser = this.authService.getCurrentUser();
    if (this.currentUser) {
      this.mfaStep = this.currentUser.mfaEnabled ? 'active' : 'inactive';
    }
    this.initForms();
    this.loadProfile();
  }

  initForms(): void {
    this.profileForm = this.fb.group({
      fullName: [this.currentUser?.fullName || '', Validators.required],
      email: [this.currentUser?.email || '', [Validators.required, Validators.email]],
      theme: [this.themeService.getCurrentTheme(), Validators.required],
      phone: [this.currentUser?.phone || '', [Validators.maxLength(20)]]
    });

    this.passwordForm = this.fb.group({
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', Validators.required]
    });

    this.mfaForm = this.fb.group({
      code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });

    this.mfaDisableForm = this.fb.group({
      password: ['', Validators.required]
    });
  }

  onThemeChange(theme: Theme): void {
    this.themeService.setTheme(theme);
  }

  private loadProfile(): void {
    this.userService.getProfile().subscribe({
      next: (user) => {
        this.currentUser = user;
        this.mfaStep = user.mfaEnabled ? 'active' : 'inactive';
        this.profileForm.patchValue({
          fullName: user.fullName,
          email: user.email,
          theme: user.theme || this.themeService.getCurrentTheme(),
          phone: user.phone || ''
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
      // Corrección ortográfica: ñ agregada a contraseñas
      this.snackBar.open('Las contraseñas no coinciden', 'Cerrar', { duration: 3000 });
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
          // Corrección ortográfica: ñ y tilde agregadas en contraseña
          this.snackBar.open('Contraseña actualizada', 'Cerrar', { duration: 3000 });
        },
        error: (err) => {
          console.error('Error changing password:', err);
          // Corrección ortográfica: ñ y tilde agregadas en contraseña
          this.snackBar.open(err.error?.message || 'No se pudo cambiar la contraseña', 'Cerrar', { duration: 3000 });
        }
      });
  }

  /**
   * Inicia el proceso de enrolamiento de MFA solicitando la semilla/QR al backend.
   */
  startMfaSetup(): void {
    this.isSavingMfa = true;
    this.authService.mfaSetup().subscribe({
      next: (res) => {
        this.mfaQrCode = res.qrCode;
        this.mfaSecret = res.secret;
        this.mfaStep = 'setup';
        this.mfaForm.reset();
        this.isSavingMfa = false;
      },
      error: (err) => {
        console.error('Error al iniciar setup de MFA:', err);
        this.snackBar.open(err.error?.message || 'No se pudo iniciar la configuración de MFA', 'Cerrar', { duration: 3000 });
        this.isSavingMfa = false;
      }
    });
  }

  /**
   * Cancela el flujo actual de configuración y limpia variables temporales.
   */
  cancelMfaSetup(): void {
    this.mfaStep = 'inactive';
    this.mfaQrCode = '';
    this.mfaSecret = '';
    this.mfaForm.reset();
  }

  /**
   * Envía el código TOTP de prueba al backend para activar el MFA.
   */
  verifyMfaSetup(): void {
    if (this.mfaForm.invalid) return;
    this.isSavingMfa = true;
    const code = this.mfaForm.value.code;
    this.authService.mfaVerify(code).subscribe({
      next: (res) => {
        this.snackBar.open('MFA activado con éxito', 'Cerrar', { duration: 3000 });
        this.mfaStep = 'active';
        this.currentUser.mfaEnabled = true;
        this.authService.updateCurrentUser(this.currentUser);
        this.isSavingMfa = false;
      },
      error: (err) => {
        console.error('Error al verificar MFA:', err);
        this.snackBar.open(err.error?.message || 'Código de verificación inválido', 'Cerrar', { duration: 3000 });
        this.isSavingMfa = false;
      }
    });
  }

  /**
   * Solicita al backend desactivar el MFA validando la contraseña actual.
   */
  disableMfa(): void {
    if (this.mfaDisableForm.invalid) return;
    this.isDisablingMfa = true;
    const password = this.mfaDisableForm.value.password;
    this.authService.mfaDisable(password).subscribe({
      next: () => {
        this.snackBar.open('MFA desactivado con éxito', 'Cerrar', { duration: 3000 });
        this.mfaStep = 'inactive';
        this.currentUser.mfaEnabled = false;
        this.authService.updateCurrentUser(this.currentUser);
        this.mfaDisableForm.reset();
        this.isDisablingMfa = false;
      },
        error: (err) => {
          console.error('Error al desactivar MFA:', err);
          this.snackBar.open(err.error?.message || 'Contraseña incorrecta', 'Cerrar', { duration: 3000 });
          this.isDisablingMfa = false;
        }
      });
  }

  getAssetUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return `${this.backendBaseUrl}${url}`;
  }

  triggerAvatarUpload(input: HTMLInputElement): void {
    input.click();
  }

  onAvatarSelected(event: any): void {
    const file = event.target?.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      this.snackBar.open('Formato no permitido. Solo se aceptan imágenes JPG, JPEG, PNG y WEBP.', 'Cerrar', { duration: 3000 });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      this.snackBar.open('El archivo es demasiado grande. Máximo 2MB.', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isUploadingAvatar = true;
    this.userService.uploadAvatar(file)
      .pipe(finalize(() => {
        this.isUploadingAvatar = false;
      }))
      .subscribe({
        next: (res) => {
          this.currentUser = res.user;
          this.authService.updateCurrentUser(res.user);
          this.snackBar.open('Avatar actualizado con éxito', 'Cerrar', { duration: 3000 });
        },
        error: (err) => {
          console.error('Error al subir avatar:', err);
          this.snackBar.open(err.error?.message || 'Error al subir la imagen de avatar', 'Cerrar', { duration: 3000 });
        }
      });
  }
}