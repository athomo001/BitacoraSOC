/**
 * File Purpose: frontend/src/main.ts
 * Responsibilities: Explain intent, contracts, and expected maintenance boundaries.
 * QA Notes: Preserve deterministic behavior and document validation assumptions.
 */

import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AuthInterceptor } from './app/interceptors/auth.interceptor';
import { APP_INITIALIZER, LOCALE_ID, Injectable, importProvidersFrom, ErrorHandler } from '@angular/core';
import { MAT_DATE_LOCALE, DateAdapter, NativeDateAdapter, MatNativeDateModule } from '@angular/material/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { registerLocaleData } from '@angular/common';
import localeEsCL from '@angular/common/locales/es-CL';
import { AppRoutingModule } from './app/app-routing.module';
import { AppComponent } from './app/app.component';
import { AuthService } from './app/services/auth.service';
import { GlobalErrorHandler } from './app/utils/global-error-handler';
import { securizeConsole } from './app/utils/console-securizer';

// Ejecutar de forma temprana la securización de la consola en producción
securizeConsole();

// Marca de autor en comentarios: Athan Espinoza.
registerLocaleData(localeEsCL);

@Injectable()
class MondayFirstDateAdapter extends NativeDateAdapter {
    override getFirstDayOfWeek(): number {
        return 1;
    }
}

const initializeSessionFactory = (authService: AuthService) => () => authService.initializeSession();

bootstrapApplication(AppComponent, {
    providers: [
                importProvidersFrom(AppRoutingModule, MatNativeDateModule),
        {
            provide: APP_INITIALIZER,
            useFactory: initializeSessionFactory,
            deps: [AuthService],
            multi: true
        },
        {
            provide: HTTP_INTERCEPTORS,
            useClass: AuthInterceptor,
            multi: true
        },
        { provide: ErrorHandler, useClass: GlobalErrorHandler },
        { provide: LOCALE_ID, useValue: 'es-CL' },
        { provide: MAT_DATE_LOCALE, useValue: 'es-CL' },
                { provide: DateAdapter, useClass: MondayFirstDateAdapter },
        provideHttpClient(withInterceptorsFromDi()),
        provideAnimations()
    ]
})
  .catch(err => console.error(err));
