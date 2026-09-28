/**
 * Catálogo de temas de login, separado de login.component.ts a propósito:
 * el perfil del shell también lo usa, y si lo importara desde el componente
 * arrastraría el login completo (anime.js + ~57 kB de estilos) al bundle
 * inicial — pasó y rompió el presupuesto de 500 kB.
 */
export type LoginTheme = 'crt' | 'infoflow' | 'modern' | 'surrealism' | 'win311' | 'unix89';

export const LOGIN_THEMES: readonly LoginTheme[] = ['crt', 'infoflow', 'modern', 'surrealism', 'win311', 'unix89'];

export const LOGIN_THEME_LABELS: Record<LoginTheme, string> = {
  crt: 'CRT',
  infoflow: 'Infoflow',
  modern: 'Modern',
  surrealism: 'Surrealism',
  win311: 'Windows 3.11',
  unix89: 'Unix 89',
};

export const LOGIN_THEME_STORAGE_KEY = 'preferredLoginTheme';
