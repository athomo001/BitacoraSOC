import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ButtonComponent } from '../../shared/ui/button/button';
import { PermissionsService } from '../../core/auth/permissions.service';
import { ContactForm, DirectoryContact, DirectoryService, ImportCsvResult } from '../../core/directory/directory.service';
import { Organization, OrganizationsService } from '../../core/organizations/organizations.service';
import { PageMeta } from '../../core/territory/territory.models';
import { problemDetail } from '../../core/http-error';

const EMPTY_FORM: ContactForm = {
  organizationId: '',
  name: '',
  position: '',
  specialty: '',
  scope: 'external',
  isFavorite: false,
  email: '',
  phone: '',
};

/** Encabezados de la plantilla oficial del legacy + Especialidad (columna nueva). */
const CSV_TEMPLATE =
  'Nombre,Correo,Teléfono,Empresa,Cargo,Tipo,Ámbito,Favorito,Especialidad\n' +
  'Juan Pérez,juan.perez@empresa.cl,+56912345678,Empresa Ejemplo,Analista SOC,External,External,false,Fibra Óptica\n';

/**
 * Directorio Global (HU-DIR-1/2), portado de
 * frontend/src/app/pages/escalation/escalation-admin-simple/escalation-directory-tab
 * del legacy: misma barra de filtros y acciones, aviso de solo lectura, tabla
 * con clic-para-copiar y edición en línea bajo la fila. Cambios respecto del
 * legacy: la paginación y la búsqueda las hace el backend (el legacy traía
 * 500 contactos y filtraba en el navegador), "Empresa" es una organización
 * real en vez de texto libre, y los permisos salen de capacidades
 * (directory:write/delete), no del cargo tipeado.
 */
@Component({
  selector: 'app-directory',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, ButtonComponent],
  templateUrl: './directory.html',
  styleUrl: './directory.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectoryComponent implements OnInit {
  protected readonly perms = inject(PermissionsService);
  private readonly directory = inject(DirectoryService);
  private readonly organizationsApi = inject(OrganizationsService);

  protected readonly contacts = signal<DirectoryContact[]>([]);
  protected readonly organizations = signal<Organization[]>([]);
  protected readonly meta = signal<PageMeta>({ page: 1, pageSize: 50, total: 0 });
  protected readonly loading = signal(false);
  protected readonly notice = signal<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Filtros (misma barra que el legacy)
  protected readonly search = signal('');
  protected readonly scopeFilter = signal('');
  protected readonly organizationFilter = signal('');
  protected readonly favoritesOnly = signal(false);
  protected readonly pageSize = signal(50);

  // Formulario (alta arriba de la tabla, edición en línea bajo la fila)
  protected readonly showCreate = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly form = signal<ContactForm>({ ...EMPTY_FORM });
  protected readonly saving = signal(false);
  protected readonly editingSynced = computed(() => this.contacts().find((c) => c.id === this.editingId())?.source === 'user_sync');

  // CSV
  protected readonly importOrganization = signal('');
  protected readonly importing = signal(false);
  protected readonly importResult = signal<ImportCsvResult | null>(null);
  protected readonly merging = signal(false);

  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.meta().total / this.meta().pageSize)));
  protected readonly rangeLabel = computed(() => {
    const { page, pageSize, total } = this.meta();
    if (total === 0) return '0';
    const start = (page - 1) * pageSize + 1;
    return `${start}-${Math.min(page * pageSize, total)} de ${total}`;
  });

  private searchTimer?: ReturnType<typeof setTimeout>;

  async ngOnInit(): Promise<void> {
    await this.perms.load();
    try {
      this.organizations.set(await this.organizationsApi.list({ active: true }));
    } catch {
      // sin organizaciones el alta avisará; el listado igual se muestra
    }
    await this.load(1);
  }

  protected async load(page = this.meta().page): Promise<void> {
    this.loading.set(true);
    try {
      const { contacts, meta } = await this.directory.list({
        q: this.search().trim() || undefined,
        scope: this.scopeFilter() || undefined,
        organizationId: this.organizationFilter() || undefined,
        favorite: this.favoritesOnly() ? true : undefined,
        page,
        pageSize: this.pageSize(),
      });
      this.contacts.set(contacts);
      this.meta.set(meta);
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo cargar el directorio.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** La búsqueda espera 250ms tras la última tecla (el legacy filtraba en cada tecla). */
  protected onSearch(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(1), 250);
  }

  protected applyFilters(): void {
    void this.load(1);
  }

  protected setFormField<K extends keyof ContactForm>(key: K, value: ContactForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected startCreate(): void {
    this.editingId.set(null);
    this.form.set({ ...EMPTY_FORM, organizationId: this.organizationFilter() || this.organizations()[0]?.id || '' });
    this.showCreate.set(true);
  }

  protected startEdit(contact: DirectoryContact): void {
    if (this.editingId() === contact.id) {
      this.cancelForm();
      return;
    }
    this.showCreate.set(false);
    this.editingId.set(contact.id);
    this.form.set({
      organizationId: contact.organizationId,
      name: contact.name,
      position: contact.position ?? '',
      specialty: contact.specialty ?? '',
      scope: contact.scope,
      isFavorite: contact.isFavorite,
      email: contact.email,
      phone: contact.phone,
    });
  }

  protected cancelForm(): void {
    this.showCreate.set(false);
    this.editingId.set(null);
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form.name.trim()) {
      this.showError('El nombre es obligatorio.');
      return;
    }
    if (!form.organizationId) {
      this.showError('Elige la organización del contacto.');
      return;
    }
    this.saving.set(true);
    try {
      const id = this.editingId();
      if (id) {
        await this.directory.update(id, form);
        this.showOk('Contacto actualizado.');
      } else {
        await this.directory.create(form);
        this.showOk('Contacto creado.');
      }
      this.cancelForm();
      await this.load();
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo guardar el contacto.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(contact: DirectoryContact): Promise<void> {
    if (!confirm(`¿Eliminar a ${contact.name} del directorio?`)) return;
    try {
      await this.directory.remove(contact.id);
      this.showOk('Contacto eliminado.');
      await this.load();
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo eliminar.'));
    }
  }

  protected async toggleFavorite(contact: DirectoryContact): Promise<void> {
    if (!this.perms.canWriteDirectory()) return;
    try {
      await this.directory.update(contact.id, { isFavorite: !contact.isFavorite });
      await this.load();
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo marcar el favorito.'));
    }
  }

  /** Clic para copiar — mismo gesto que el legacy (copyDirectoryValue). */
  protected async copy(value: string, label: string): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      this.showOk(`${label} copiado al portapapeles.`);
    } catch {
      this.showError('El navegador no permitió copiar.');
    }
  }

  protected async onCsvSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a subir el mismo archivo corregido
    if (!file) return;
    this.importing.set(true);
    this.importResult.set(null);
    try {
      const result = await this.directory.importCsv(file, this.importOrganization() || undefined);
      this.importResult.set(result);
      this.showOk(`Importación: ${result.importedCount} nuevos, ${result.updatedCount} actualizados, ${result.errors.length} observaciones.`);
      await this.load(1);
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo procesar el CSV.'));
    } finally {
      this.importing.set(false);
    }
  }

  protected downloadTemplate(): void {
    // BOM para que Excel abra el UTF-8 con tildes (igual que el legacy).
    const blob = new Blob([String.fromCharCode(0xfeff) + CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla_contactos_directorio.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  protected async mergeDuplicates(): Promise<void> {
    if (!confirm('¿Consolidar contactos duplicados (mismo correo, mismo teléfono, o mismo nombre en la misma organización)?')) return;
    this.merging.set(true);
    try {
      const result = await this.directory.mergeDuplicates();
      this.showOk(`Consolidación: ${result.consolidatedCount} grupos, ${result.mergedContacts} duplicados fusionados.`);
      await this.load(1);
    } catch (error) {
      this.showError(problemDetail(error, 'No se pudo consolidar.'));
    } finally {
      this.merging.set(false);
    }
  }

  private showOk(text: string): void {
    this.notice.set({ kind: 'ok', text });
  }

  private showError(text: string): void {
    this.notice.set({ kind: 'error', text });
  }
}
