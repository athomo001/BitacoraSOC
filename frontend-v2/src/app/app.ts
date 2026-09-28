import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PreferencesService } from './core/preferences/preferences.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Se instancia al arrancar para aplicar tema/idioma/fuente guardados antes
  // de la primera pantalla, no recién cuando se monta el shell.
  private readonly prefs = inject(PreferencesService);
}
