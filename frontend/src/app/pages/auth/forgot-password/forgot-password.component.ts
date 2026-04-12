import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatIconModule
  ],
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.scss']
})
export class ForgotPasswordComponent {
  forgotForm: FormGroup;
  loading = false;
  emailSent = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private snackBar: MatSnackBar,
    private router: Router
  ) {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  onSubmit(): void {
    if (this.forgotForm.invalid) {
      return;
    }

    this.loading = true;
    const email = this.forgotForm.value.email;

    this.authService.forgotPassword(email).subscribe({
      next: (response) => {
        this.loading = false;
        this.emailSent = true;
        this.snackBar.open(
          response.message || 'Si el email existe, recibirás instrucciones para restablecer tu contraseña.',
          'Cerrar',
          { duration: 8000 }
        );
        
        // En desarrollo, mostrar el token si está disponible
        if (response.resetToken) {
          console.log('🔑 Token de reseteo (desarrollo):', response.resetToken);
          console.log('🔗 URL de reseteo:', response.resetUrl);
        }
      },
      error: (error) => {
        this.loading = false;
        this.snackBar.open(
          error.error?.message || 'Error al procesar la solicitud',
          'Cerrar',
          { duration: 5000 }
        );
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/login']);
  }
}
