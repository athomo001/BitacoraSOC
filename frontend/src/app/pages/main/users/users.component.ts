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
import { FormBuilder, FormControl, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { UserService } from '../../../services/user.service';
import { ConfigService } from '../../../services/config.service';
import { AuthService } from '../../../services/auth.service';
import { DirectoryService, DirectoryContact } from '../../../services/directory.service';
import { User, CreateUserRequest } from '../../../models/user.model';
import { MatFormField, MatLabel, MatHint, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { NgFor, NgIf } from '@angular/common';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatAutocomplete, MatAutocompleteTrigger, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { MatCheckbox } from '@angular/material/checkbox';

@Component({
    selector: 'app-users',
    templateUrl: './users.component.html',
    styleUrls: ['./users.component.scss'],
    imports: [ReactiveFormsModule, FormsModule, MatFormField, MatLabel, MatInput, NgIf, NgFor, MatHint, MatSuffix, MatSelect, MatOption, MatAutocomplete, MatAutocompleteTrigger, MatButton, MatTable, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCellDef, MatCell, MatIconButton, MatTooltip, MatIcon, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatCheckbox]
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
  displayedColumns: string[] = ['username', 'fullName', 'email', 'phone', 'cargoLabel', 'role', 'mfaEnabled', 'isActive', 'actions'];
  editingUserId: string | null = null;

  // Estado y configuraciones para la automatización de correos de cumpleaños
  birthdayEmailsEnabled: boolean = false;
  birthdayEmailsTime: string = '09:00';
  isSavingBirthdayConfig: boolean = false;
  // Correo del área en copia (CC): se puede escribir libre o elegir del directorio de contactos
  birthdayCcEmailControl = new FormControl('');
  areaEmailSuggestions: DirectoryContact[] = [];

  constructor(
    private fb: FormBuilder,
    private userService: UserService,
    private snackBar: MatSnackBar,
    private dialog: MatDialog,
    private configService: ConfigService,
    private authService: AuthService,
    private directoryService: DirectoryService
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
      cargoCustom: [''],
      mfaEnabled: [false]
    });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.configureCargoValidators();
    this.loadBirthdayConfig();

    // Sugiere contactos del directorio a medida que se escribe el correo del área (CC)
    this.birthdayCcEmailControl.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged())
      .subscribe((value) => {
        const query = (value || '').trim();
        if (query.length < 2) {
          this.areaEmailSuggestions = [];
          return;
        }
        this.directoryService.quickSearch(query).subscribe({
          next: (contacts) => {
            this.areaEmailSuggestions = (contacts || []).filter((c) => !!c.email);
          },
          error: () => {
            this.areaEmailSuggestions = [];
          }
        });
      });
  }

  onAreaContactSelected(event: MatAutocompleteSelectedEvent): void {
    this.birthdayCcEmailControl.setValue(event.option.value, { emitEvent: false });
    this.areaEmailSuggestions = [];
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
          cargoLabel: this.resolveCargoLabelFromForm(),
          mfaEnabled: this.userForm.value.mfaEnabled
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
        const rawPhone = this.userForm.value.phone;
        const normalizedPhone = typeof rawPhone === 'string'
          ? rawPhone.trim()
          : '';

        const data: CreateUserRequest = {
          username: this.userForm.value.username,
          password: this.userForm.value.password,
          fullName: this.userForm.value.fullName,
          email: this.userForm.value.email,
          phone: normalizedPhone || undefined,
          role: this.userForm.value.role,
          cargoLabel: this.resolveCargoLabelFromForm(),
          mfaEnabled: this.userForm.value.mfaEnabled
        };
        this.userService.createUser(data).subscribe({
          next: () => {
            this.snackBar.open('Usuario creado', 'Cerrar', { duration: 2000 });
            this.userForm.reset({ role: 'user', cargoOption: this.baseCargos[0], cargoCustom: '', mfaEnabled: false });
            this.applyCargoValidators();
            this.loadUsers();
          },
          error: (err) => {
            console.error('Error creando usuario:', err);
            const validationMsg = Array.isArray(err?.error?.errors) && err.error.errors.length > 0
              ? err.error.errors[0]?.msg
              : null;
            this.snackBar.open(validationMsg || err.error?.message || 'Error creando usuario', 'Cerrar', { duration: 3000 });
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
      newPassword: '',
      mfaEnabled: !!user.mfaEnabled
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
    this.userForm.reset({ role: 'user', cargoOption: this.baseCargos[0], cargoCustom: '', newPassword: '', mfaEnabled: false });
    this.userForm.get('username')?.enable();
    this.userForm.get('password')?.setValidators([Validators.required]);
    this.userForm.get('password')?.updateValueAndValidity();
    this.applyCargoValidators();
  }

  toggleActive(user: User): void {
    const action = user.isActive ? 'desactivar' : 'activar';
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `${user.isActive ? 'Desactivar' : 'Activar'} Usuario`,
        message: `¿Estás seguro de ${action} a <strong>${user.username}</strong>?`,
        confirmText: user.isActive ? 'Desactivar' : 'Activar',
        isDestructive: user.isActive
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.updateUser(user._id, { isActive: !user.isActive }).subscribe({
          next: () => {
            this.snackBar.open(`Usuario ${action}do`, 'Cerrar', { duration: 2000 });
            this.loadUsers();
          },
          error: (err) => this.snackBar.open(`Error al ${action} usuario`, 'Cerrar', { duration: 3000 })
        });
      }
    });
  }

  deleteUser(id: string): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Eliminar Usuario',
        message: '¿Estás seguro de eliminar este usuario? Esta acción no se puede deshacer.',
        confirmText: 'Eliminar',
        isDestructive: true
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.deleteUser(id).subscribe({
          next: () => {
            this.snackBar.open('Usuario eliminado', 'Cerrar', { duration: 2000 });
            this.loadUsers();
          },
          error: (err) => this.snackBar.open('Error eliminando usuario', 'Cerrar', { duration: 3000 })
        });
      }
    });
  }

  /**
   * Carga la configuración global de la aplicación, específicamente los parámetros
   * relacionados con el envío programado de felicitaciones de cumpleaños.
   */
  loadBirthdayConfig(): void {
    this.configService.getConfig().subscribe({
      next: (config) => {
        this.birthdayEmailsEnabled = !!config.birthdayEmailsEnabled;
        this.birthdayEmailsTime = config.birthdayEmailsTime || '09:00';
        this.birthdayCcEmailControl.setValue(config.birthdayEmailsCcAddress || '', { emitEvent: false });
      },
      error: (err) => {
        console.error('Error cargando configuración de cumpleaños:', err);
        this.snackBar.open('Error al cargar la configuración de cumpleaños', 'Cerrar', { duration: 3000 });
      }
    });
  }

  /**
   * Guarda los cambios de configuración del envío automático de felicitaciones de cumpleaños.
   * Valida que la hora tenga un formato válido de 24 horas si las felicitaciones están habilitadas.
   */
  saveBirthdayConfig(): void {
    if (this.birthdayEmailsEnabled && !this.birthdayEmailsTime) {
      this.snackBar.open('Por favor, especifica una hora válida de envío', 'Cerrar', { duration: 3000 });
      return;
    }

    const ccAddress = (this.birthdayCcEmailControl.value || '').trim();
    if (ccAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccAddress)) {
      this.snackBar.open('El correo del área no es válido', 'Cerrar', { duration: 3000 });
      return;
    }

    this.isSavingBirthdayConfig = true;
    this.configService.updateConfig({
      birthdayEmailsEnabled: this.birthdayEmailsEnabled,
      birthdayEmailsTime: this.birthdayEmailsTime,
      birthdayEmailsCcAddress: ccAddress
    }).subscribe({
      next: (res) => {
        this.snackBar.open('Configuración de cumpleaños actualizada con éxito', 'Cerrar', { duration: 2000 });
        this.isSavingBirthdayConfig = false;
      },
      error: (err) => {
        console.error('Error guardando configuración de cumpleaños:', err);
        this.snackBar.open(err.error?.message || 'Error al guardar la configuración de cumpleaños', 'Cerrar', { duration: 3000 });
        this.isSavingBirthdayConfig = false;
      }
    });
  }

  /**
   * Solicita confirmación y fuerza a todos los usuarios activos del sistema a restablecer
   * su contraseña y configurar su fecha de nacimiento en el próximo inicio de sesión.
   * Se excluye explícitamente al administrador actual para evitar bloqueos.
   */
  forcePasswordResetAll(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      disableClose: true,
      data: {
        title: 'Restablecimiento Masivo de Contraseñas',
        message: '¿Confirmas forzar el cambio de contraseña para TODOS los usuarios internos activos?<br><br>Además, se enviará un correo informativo a cada usuario interno para avisar que debe actualizar su clave en su próximo ingreso.',
        confirmText: 'Sí, Forzar y Notificar',
        cancelText: 'Cancelar',
        isDestructive: true
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.forcePasswordChangeAll().subscribe({
          next: (res) => {
            this.snackBar.open(res.message || 'Restablecimiento masivo ordenado correctamente', 'Cerrar', { duration: 3000 });
            this.loadUsers();
          },
          error: (err) => {
            console.error('Error al forzar restablecimiento masivo:', err);
            this.snackBar.open(err.error?.message || 'Error al ejecutar el restablecimiento masivo', 'Cerrar', { duration: 3000 });
          }
        });
      }
    });
  }

  /**
   * Solicita confirmación para obligar a un usuario en particular a cambiar su contraseña
   * y establecer su fecha de nacimiento en su próximo ingreso.
   */
  forcePasswordResetIndividual(user: User): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Forzar Restablecimiento de Contraseña',
        message: `¿Estás seguro de obligar a <strong>${user.username}</strong> a cambiar su contraseña y registrar su cumpleaños en su próximo ingreso?`,
        confirmText: 'Forzar Restablecimiento',
        isDestructive: true
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.userService.updateUser(user._id, { mustChangePassword: true }).subscribe({
          next: () => {
            this.snackBar.open(`Se ha forzado el cambio de contraseña para ${user.username}`, 'Cerrar', { duration: 2000 });
            this.loadUsers();
          },
          error: (err) => {
            console.error('Error al forzar restablecimiento individual:', err);
            this.snackBar.open('Error al forzar restablecimiento individual', 'Cerrar', { duration: 3000 });
          }
        });
      }
    });
  }

  /**
   * Determina si el usuario proveído corresponde al administrador con sesión iniciada actualmente.
   */
  isCurrentUser(user: User): boolean {
    const currentUser = this.authService.getCurrentUser();
    return currentUser ? currentUser._id === user._id : false;
  }
}
