/**
 * File Purpose: frontend/src/app/pages/main/users/users.component.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

/**
 * Componente de Gestión de Usuarios (Admin)
 * 
 * Funcionalidad:
 *   - Listar todos los usuarios (tabla Material)
 *   - Crear usuarios (admin/user/guest)
 *   - Editar usuarios (fullName, email, phone, role)
 *   - Activar/Desactivar usuarios (isActive)
 *   - Eliminar usuarios (con confirmación)
 * 
 * Campos formulario:
 *   - username: min 3 chars, único (no editable)
 *   - password: min 6 chars, hasheado en backend (solo en creación)
 *   - fullName: nombre completo
 *   - email: validación email
 *   - phone: opcional
 *   - role: admin | user | guest (default user)
 * 
 * Reglas SOC:
 *   - Solo admin accede (protegido por AdminGuard)
 *   - Guests: expiresAt calculado según AppConfig.guestMaxDurationDays
 *   - No se puede eliminar el propio usuario (evitar lockout)
 *   - Desactivar usuario en lugar de eliminar (soft delete)
 * 
 * Tabla:
 *   - Columnas: username, fullName, email, phone, role, isActive, actions
 *   - Actions: editar, activar/desactivar, eliminar
 */
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { UserService } from '../../../services/user.service';
import { User, CreateUserRequest } from '../../../models/user.model';
import { MatFormField, MatLabel, MatHint } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { NgFor, NgIf } from '@angular/common';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';

@Component({
    selector: 'app-users',
    templateUrl: './users.component.html',
    styleUrls: ['./users.component.scss'],
    imports: [ReactiveFormsModule, MatFormField, MatLabel, MatInput, NgIf, NgFor, MatHint, MatSelect, MatOption, MatButton, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatIconButton, MatTooltip, MatIcon, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow]
})
export class UsersComponent implements OnInit {
  readonly baseCargos: string[] = [
    'N1',
    'N2',
    'N3',
    'QA Nivel 1',
    'QA Nivel 2',
    'Pentester N1',
    'Pentester N2',
    'Arquitecto SIEM',
    'Customer Success Manager (CSM)',
    'Jefe Área',
    'Gerente Área'
  ];

  readonly customCargoOption = '__custom__';
  users: User[] = [];
  userForm: FormGroup;
  displayedColumns: string[] = ['username', 'fullName', 'email', 'phone', 'cargoLabel', 'role', 'isActive', 'actions'];
  editingUserId: string | null = null;

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private snackBar: MatSnackBar
  ) {
    this.userForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', [Validators.required]],  // Admin: sin mínimo de caracteres
      newPassword: [''],                        // Solo en edición, opcional
      fullName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      role: ['user', Validators.required],
      cargoOption: [this.baseCargos[0], Validators.required],
      cargoCustom: ['']
    });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.configureCargoValidators();
  }

  private configureCargoValidators(): void {
    this.userForm.get('role')?.valueChanges.subscribe(() => this.applyCargoValidators());
    this.userForm.get('cargoOption')?.valueChanges.subscribe(() => this.applyCargoValidators());
    this.applyCargoValidators();
  }

  private applyCargoValidators(): void {
    const role = this.userForm.get('role')?.value;
    const cargoOptionControl = this.userForm.get('cargoOption');
    const cargoCustomControl = this.userForm.get('cargoCustom');
    const isGuest = role === 'guest';
    const isCustom = cargoOptionControl?.value === this.customCargoOption;

    if (isGuest) {
      cargoOptionControl?.clearValidators();
      cargoCustomControl?.clearValidators();
      cargoOptionControl?.setValue('', { emitEvent: false });
      cargoCustomControl?.setValue('', { emitEvent: false });
    } else {
      cargoOptionControl?.setValidators([Validators.required]);

      if (!cargoOptionControl?.value) {
        cargoOptionControl?.setValue(this.baseCargos[0], { emitEvent: false });
      }

      if (isCustom) {
        cargoCustomControl?.setValidators([Validators.required, Validators.maxLength(120)]);
      } else {
        cargoCustomControl?.clearValidators();
        cargoCustomControl?.setValue('', { emitEvent: false });
      }
    }

    cargoOptionControl?.updateValueAndValidity({ emitEvent: false });
    cargoCustomControl?.updateValueAndValidity({ emitEvent: false });
  }

  isCustomCargoSelected(): boolean {
    return this.userForm.get('cargoOption')?.value === this.customCargoOption;
  }

  isGuestRoleSelected(): boolean {
    return this.userForm.get('role')?.value === 'guest';
  }

  private resolveCargoLabelFromForm(): string | null {
    if (this.isGuestRoleSelected()) {
      return null;
    }
    const cargoOption = (this.userForm.get('cargoOption')?.value || '').trim();
    if (cargoOption === this.customCargoOption) {
      const customValue = (this.userForm.get('cargoCustom')?.value || '').trim();
      return customValue || null;
    }
    return cargoOption || null;
  }

  loadUsers(): void {
    this.userService.getUsers().subscribe({
      next: (users) => this.users = users,
      error: (err) => this.snackBar.open('Error cargando usuarios', 'Cerrar', { duration: 3000 })
    });
  }

  onSubmit(): void {
    if (this.userForm.valid) {
      if (this.editingUserId) {
        // Modo edición
        const data: any = {
          fullName: this.userForm.value.fullName,
          email: this.userForm.value.email,
          phone: this.userForm.value.phone || undefined,
          role: this.userForm.value.role,
          cargoLabel: this.resolveCargoLabelFromForm()
        };
        // Incluir newPassword solo si el admin escribió algo
        const newPwd = (this.userForm.value.newPassword || '').trim();
        if (newPwd) {
          data.newPassword = newPwd;
        }
        this.userService.updateUser(this.editingUserId, data).subscribe({
          next: () => {
            this.snackBar.open('Usuario actualizado', 'Cerrar', { duration: 2000 });
            this.cancelEdit();
            this.loadUsers();
          },
          error: (err) => {
            console.error('Error actualizando usuario:', err);
            this.snackBar.open(err.error?.message || 'Error actualizando usuario', 'Cerrar', { duration: 3000 });
          }
        });
      } else {
        // Modo creación
        const data: CreateUserRequest = {
          username: this.userForm.value.username,
          password: this.userForm.value.password,
          fullName: this.userForm.value.fullName,
          email: this.userForm.value.email,
          phone: this.userForm.value.phone,
          role: this.userForm.value.role,
          cargoLabel: this.resolveCargoLabelFromForm()
        };
        if (data.phone === '') {
          delete data.phone;
        }
        this.userService.createUser(data).subscribe({
          next: () => {
            this.snackBar.open('Usuario creado', 'Cerrar', { duration: 2000 });
            this.userForm.reset({ role: 'user', cargoOption: this.baseCargos[0], cargoCustom: '' });
            this.applyCargoValidators();
            this.loadUsers();
          },
          error: (err) => {
            console.error('Error creando usuario:', err);
            this.snackBar.open(err.error?.message || 'Error creando usuario', 'Cerrar', { duration: 3000 });
          }
        });
      }
    }
  }

  editUser(user: User): void {
    this.editingUserId = user._id;
    this.userForm.patchValue({
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      cargoOption: '',
      cargoCustom: '',
      newPassword: ''
    });

    if (user.role !== 'guest') {
      const existingCargo = (user.cargoLabel || '').trim();
      if (existingCargo && this.baseCargos.includes(existingCargo)) {
        this.userForm.patchValue({ cargoOption: existingCargo, cargoCustom: '' }, { emitEvent: false });
      } else if (existingCargo) {
        this.userForm.patchValue({ cargoOption: this.customCargoOption, cargoCustom: existingCargo }, { emitEvent: false });
      }
    }

    this.applyCargoValidators();

    // Deshabilitar username y password en modo edición
    this.userForm.get('username')?.disable();
    this.userForm.get('password')?.clearValidators();
    this.userForm.get('password')?.updateValueAndValidity();
  }

  cancelEdit(): void {
    this.editingUserId = null;
    this.userForm.reset({ role: 'user', cargoOption: this.baseCargos[0], cargoCustom: '', newPassword: '' });
    this.userForm.get('username')?.enable();
    this.userForm.get('password')?.setValidators([Validators.required]);
    this.userForm.get('password')?.updateValueAndValidity();
    this.applyCargoValidators();
  }

  toggleActive(user: User): void {
    const action = user.isActive ? 'desactivar' : 'activar';
    if (confirm(`¿Estás seguro de ${action} a ${user.username}?`)) {
      this.userService.updateUser(user._id, { isActive: !user.isActive }).subscribe({
        next: () => {
          this.snackBar.open(`Usuario ${action}do`, 'Cerrar', { duration: 2000 });
          this.loadUsers();
        },
        error: (err) => this.snackBar.open(`Error al ${action} usuario`, 'Cerrar', { duration: 3000 })
      });
    }
  }

  deleteUser(id: string): void {
    if (confirm('¿Eliminar este usuario? Esta acción no se puede deshacer.')) {
      this.userService.deleteUser(id).subscribe({
        next: () => {
          this.snackBar.open('Usuario eliminado', 'Cerrar', { duration: 2000 });
          this.loadUsers();
        },
        error: (err) => this.snackBar.open('Error eliminando usuario', 'Cerrar', { duration: 3000 })
      });
    }
  }
}
