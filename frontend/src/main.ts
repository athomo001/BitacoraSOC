import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { AuthInterceptor } from './app/interceptors/auth.interceptor';
import { LOCALE_ID, Injectable, importProvidersFrom } from '@angular/core';
import { MAT_DATE_LOCALE, DateAdapter, NativeDateAdapter, MatNativeDateModule } from '@angular/material/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideAnimations } from '@angular/platform-browser/animations';
import { registerLocaleData } from '@angular/common';
import localeEsCL from '@angular/common/locales/es-CL';
import { AppRoutingModule } from './app/app-routing.module';
import { AppComponent } from './app/app.component';

registerLocaleData(localeEsCL);

@Injectable()
class MondayFirstDateAdapter extends NativeDateAdapter {
    override getFirstDayOfWeek(): number {
        return 1;
    }
}

bootstrapApplication(AppComponent, {
    providers: [
                importProvidersFrom(AppRoutingModule, MatNativeDateModule),
        {
            provide: HTTP_INTERCEPTORS,
            useClass: AuthInterceptor,
            multi: true
        },
        { provide: LOCALE_ID, useValue: 'es-CL' },
        { provide: MAT_DATE_LOCALE, useValue: 'es-CL' },
                { provide: DateAdapter, useClass: MondayFirstDateAdapter },
        provideHttpClient(withInterceptorsFromDi()),
        provideAnimations()
    ]
})
  .catch(err => console.error(err));
