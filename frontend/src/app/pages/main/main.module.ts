import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Routes } from '@angular/router';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';

// Angular Material
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatDialogModule } from '@angular/material/dialog';
import { MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatTabsModule } from '@angular/material/tabs';

// Components
import { MainLayoutComponent } from './main-layout.component';
import { EntriesComponent } from './entries/entries.component';
import { ChecklistComponent } from './checklist/checklist.component';
import { AllEntriesComponent } from './all-entries/all-entries.component';
import { ReportsComponent } from './reports/reports.component';
import { UsersComponent } from './users/users.component';
import { SettingsComponent } from './settings/settings.component';
import { ProfileComponent } from './profile/profile.component';
import { MyEntriesComponent } from './my-entries/my-entries.component';
import { TagsComponent } from './tags/tags.component';
import { LogoComponent } from './logo/logo.component';
import { BackupComponent } from './backup/backup.component';
import { ChecklistAdminComponent } from './checklist-admin/checklist-admin.component';
import { ChecklistHistoryComponent } from './checklist-history/checklist-history.component';
import { ReportGeneratorComponent } from './report-generator/report-generator.component';
import { CatalogAdminComponent } from './catalog-admin/catalog-admin.component';
import { AuditLogsComponent } from './audit-logs/audit-logs.component';
import { AdminConsoleComponent } from './admin-console/admin-console.component';
import { EscalationAdminSimpleComponent } from '../escalation/escalation-admin-simple/escalation-admin-simple.component';

// Shared Components


// Guards
import { AdminGuard } from '../../guards/admin.guard';

const routes: Routes = [
  {
    path: '',
    component: MainLayoutComponent,
    children: [
      { path: '', redirectTo: 'checklist', pathMatch: 'full' },
      { path: 'entries', component: EntriesComponent },
      { path: 'my-entries', component: MyEntriesComponent },
      { path: 'checklist', component: ChecklistComponent },
      { path: 'checklist-history', component: ChecklistHistoryComponent },
      { path: 'all-entries', component: AllEntriesComponent },
      { path: 'profile', component: ProfileComponent },
      { path: 'reports', component: ReportsComponent },
      { path: 'users', redirectTo: 'admin/users', pathMatch: 'full' },
      { path: 'tags', component: TagsComponent },
      { path: 'logo', component: LogoComponent },
      { path: 'backup', component: BackupComponent },
      { path: 'checklist-admin', redirectTo: 'admin/checklist', pathMatch: 'full' },
      { path: 'catalog-admin', redirectTo: 'admin/catalogs', pathMatch: 'full' },
      { path: 'audit-logs', component: AuditLogsComponent, canActivate: [AdminGuard] },
      { path: 'report-generator', component: ReportGeneratorComponent },
      { path: 'settings', redirectTo: 'admin/smtp', pathMatch: 'full' },
      {
        path: 'admin',
        component: AdminConsoleComponent,
        canActivate: [AdminGuard],
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          { path: 'users', component: UsersComponent },
          { path: 'checklist', component: ChecklistAdminComponent },
          {
            path: 'work-shifts',
            loadComponent: () => import('../work-shifts/work-shifts-admin/work-shifts-admin.component').then(m => m.WorkShiftsAdminComponent)
          },
          { path: 'catalogs', component: CatalogAdminComponent },
          { path: 'escalation', component: EscalationAdminSimpleComponent },
          { path: 'smtp', component: SettingsComponent },
          {
            path: 'security',
            loadComponent: () => import('./admin-security/admin-security.component').then(m => m.AdminSecurityComponent)
          },
          {
            path: 'integrations',
            loadComponent: () => import('./integrations/integrations.component').then(m => m.IntegrationsComponent)
          },
          {
            path: 'glpi',
            loadComponent: () => import('./glpi/glpi-integration.component').then(m => m.GlpiIntegrationComponent)
          },
          {
            path: 'appearance',
            loadComponent: () => import('./admin-appearance/admin-appearance.component').then(m => m.AdminAppearanceComponent)
          }
        ]
      },
      { 
        path: 'escalation', 
        loadChildren: () => import('../escalation/escalation.module').then(m => m.EscalationModule)
      },
      {
        path: 'work-shifts',
        redirectTo: 'admin/work-shifts',
        pathMatch: 'full'
      }
    ]
  }
];

@NgModule({
    imports: [
    CommonModule,
    RouterModule.forChild(routes),
    ReactiveFormsModule,
    FormsModule, // Para EntityAutocomplete
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatCardModule,
    MatTableModule,
    MatPaginatorModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatProgressSpinnerModule,
    MatRadioModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressBarModule,
    MatAutocompleteModule,
    MatTabsModule,
    AllEntriesComponent,
    MainLayoutComponent,
    EntriesComponent,
    ChecklistComponent,
    ReportsComponent,
    UsersComponent,
    SettingsComponent,
    ProfileComponent,
    MyEntriesComponent,
    TagsComponent,
    LogoComponent,
    BackupComponent,
    ChecklistAdminComponent,
    ChecklistHistoryComponent,
    CatalogAdminComponent,
    AdminConsoleComponent,
    AuditLogsComponent,
    ReportGeneratorComponent
]
})
export class MainModule { }
