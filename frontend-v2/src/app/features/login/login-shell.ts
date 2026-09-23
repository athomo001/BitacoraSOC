import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

export type LoginSkin = 'modern' | 'cyber' | 'crt' | 'win311' | 'unix89' | 'surrealism';

interface SkinOption {
  id: LoginSkin;
  label: string;
}

const SKINS: readonly SkinOption[] = [
  { id: 'modern', label: 'Industrial Modern' },
  { id: 'cyber', label: 'Cyber/Matrix (Infoflow)' },
  { id: 'crt', label: 'Fósforo CRT' },
  { id: 'win311', label: 'Windows 3.11' },
  { id: 'unix89', label: 'Unix 1989' },
  { id: 'surrealism', label: 'Surrealismo' },
];

/**
 * Componente único de login con los 6 skins históricos (spec/06-frontend-
 * arquitectura-y-ui.md sección 8) — un solo formulario/lógica, la identidad
 * visual conmuta por completo vía CSS puro sobre `[data-skin]` en el
 * contenedor raíz. Fase 3: formulario sin conectar a auth real todavía
 * (eso llega en la Fase 4) — `onSubmit()` es un stub.
 */
@Component({
  selector: 'app-login-shell',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login-shell.html',
  styleUrl: './login-shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginShellComponent {
  protected readonly skins = SKINS;
  protected readonly currentSkin = signal<LoginSkin>('modern');

  protected username = '';
  protected password = '';

  protected setSkin(skin: LoginSkin): void {
    this.currentSkin.set(skin);
  }

  protected onSubmit(): void {
    // Fase 4 conecta esto a POST /api/auth/login — acá es intencionalmente
    // un stub (Fase 3: "Fuera de alcance: cualquier llamada HTTP real").
  }
}
