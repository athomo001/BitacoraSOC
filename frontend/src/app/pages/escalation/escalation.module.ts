import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

// Angular Material
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatCheckboxModule } from '@angular/material/checkbox';

// Routing
import { EscalationRoutingModule } from './escalation-routing.module';

// Components
import { EscalationSimpleComponent } from './escalation-simple/escalation-simple.component';
import { EscalationAdminSimpleComponent } from './escalation-admin-simple/escalation-admin-simple.component';

@NgModule({
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    EscalationRoutingModule,
    // Material Modules
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    MatDialogModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatAutocompleteModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
    MatDividerModule,
    MatCheckboxModule,
    // Componentes standalone
    EscalationSimpleComponent,
    EscalationAdminSimpleComponent
  ]
})
export class EscalationModule { }
