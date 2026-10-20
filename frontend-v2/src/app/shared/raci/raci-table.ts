import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { RACI_ROLES, RaciActivity, RaciRole, RaciTeam } from '../../core/raci/raci.service';

import '../../core/i18n/packs/raci';

interface TopicGroup {
  topic: string;
  rows: RaciActivity[];
}

/**
 * La matriz RACI de un cliente como en el legacy (tópico, actividad, las
 * cuatro letras y notas), agrupada por tópico. Cada letra muestra a la
 * persona o lista con su correo (se copia con un clic) y su teléfono. La usan
 * Escalamiento (solo mirar) y Administración → RACI (con editar y eliminar).
 */
@Component({
  selector: 'app-raci-table',
  standalone: true,
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './raci-table.css',
  template: `
    <div class="adm-table-wrap rt">
      <table class="adm-table rt__table">
        <thead>
          <tr>
            <th scope="col">{{ i18n.t('raci.col.activity') }}</th>
            @for (role of roles; track role) {
              <th scope="col" [attr.title]="i18n.t(hintKey(role))"><span class="rt__letter">{{ letter(role) }}</span>{{ i18n.t(roleKey(role)) }}</th>
            }
            <th scope="col">{{ i18n.t('raci.col.notes') }}</th>
            @if (editable()) { <th scope="col"><span class="rt__sr">{{ i18n.t('raci.admin.edit') }}</span></th> }
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.topic) {
            <tr class="rt__group">
              <th scope="colgroup" [attr.colspan]="editable() ? 7 : 6">{{ group.topic || i18n.t('raci.topicless') }}</th>
            </tr>
            @for (a of group.rows; track a.id) {
              <tr>
                <td class="rt__activity">
                  {{ a.activity }}
                  @if (showClient()) { <span class="adm-muted">{{ a.clientName }}</span> }
                </td>
                @for (role of roles; track role) {
                  <td class="rt__cell">
                    @for (team of a.letters[role]; track team.id) {
                      <div class="rt__who">
                        <strong>{{ team.name }}</strong>
                        @if (team.members.length > 1) { <span class="adm-muted">{{ i18n.tf('raci.people', team.members.length) }}</span> }
                        @for (m of shownMembers(team); track $index) {
                          @if (m.name !== team.name) { <span class="rt__member">{{ m.name }}</span> }
                          @for (c of m.channels; track c.value) {
                            @if (c.channelType === 'email') {
                              <button type="button" class="rt__chan mono" [attr.aria-label]="i18n.tf('raci.copy', c.value)" (click)="copy(c.value)">
                                <mat-icon>{{ copied() === c.value ? 'check' : 'mail' }}</mat-icon>{{ copied() === c.value ? i18n.t('raci.copied') : c.value }}
                              </button>
                            } @else if (c.href) {
                              <a class="rt__chan mono" [href]="c.href" [attr.aria-label]="i18n.tf('raci.call', c.value)"><mat-icon>{{ c.channelType === 'whatsapp' ? 'chat' : 'call' }}</mat-icon>{{ c.value }}</a>
                            }
                          }
                        }
                      </div>
                    } @empty {
                      <span class="adm-muted">—</span>
                    }
                  </td>
                }
                <td class="rt__notes">
                  @if (a.notes) { <span class="rt__note"><mat-icon>info</mat-icon>{{ a.notes }}</span> } @else { <span class="adm-muted">—</span> }
                </td>
                @if (editable()) {
                  <td class="rt__actions">
                    <button type="button" class="adm-icon-btn" [attr.aria-label]="i18n.t('raci.admin.edit')" [attr.title]="i18n.t('raci.admin.edit')" (click)="edit.emit(a)"><mat-icon>edit</mat-icon></button>
                    <button type="button" class="adm-icon-btn adm-icon-btn--danger" [attr.aria-label]="i18n.t('raci.admin.delete')" [attr.title]="i18n.t('raci.admin.delete')" (click)="remove.emit(a)"><mat-icon>delete</mat-icon></button>
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
})
export class RaciTableComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly roles = RACI_ROLES;

  readonly activities = input.required<RaciActivity[]>();
  readonly editable = input(false);
  /** Con «Todos los clientes» se ve de quién es cada actividad. */
  readonly showClient = input(false);
  readonly edit = output<RaciActivity>();
  readonly remove = output<RaciActivity>();

  protected readonly copied = signal<string | null>(null);

  protected readonly groups = computed<TopicGroup[]>(() => {
    const groups: TopicGroup[] = [];
    for (const a of this.activities()) {
      const last = groups.at(-1);
      if (last && last.topic === a.topic) last.rows.push(a);
      else groups.push({ topic: a.topic, rows: [a] });
    }
    return groups;
  });

  protected letter(role: RaciRole): string {
    return role.charAt(0).toUpperCase();
  }

  protected roleKey(role: RaciRole): MessageKey {
    return `raci.role.${role}` as MessageKey;
  }

  protected hintKey(role: RaciRole): MessageKey {
    return `raci.role.${role}Hint` as MessageKey;
  }

  /** Una lista grande no llena la celda: se ven los 3 primeros. */
  protected shownMembers(team: RaciTeam) {
    return team.members.slice(0, 3);
  }

  protected async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copied.set(value);
      setTimeout(() => this.copied.set(null), 1500);
    } catch {
      // Sin portapapeles (contexto no seguro): el correo sigue visible para copiarlo a mano.
    }
  }
}
