import { ChangeDetectionStrategy, Component, Injector, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DialogRef } from '@angular/cdk/dialog';
import { MatIconModule } from '@angular/material/icon';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { MarkdownComponent } from './markdown';

interface Example {
  id: string;
  src: string;
  /** Nota que acompaña al ejemplo en vez de la indicación genérica. */
  noteKey?: MessageKey;
}

const SECTIONS: readonly { titleKey: MessageKey; rows: readonly Example[] }[] = [
  {
    titleKey: 'mdHelp.s.text',
    rows: [
      { id: 'bold', src: '**importante**' },
      { id: 'italic', src: '*a confirmar*' },
      { id: 'strike', src: '~~falso positivo~~' },
      { id: 'inline', src: '`192.168.1.10`' },
    ],
  },
  {
    titleKey: 'mdHelp.s.lists',
    rows: [
      { id: 'list', src: '- Router caído\n- Switch en revisión' },
      { id: 'num', src: '1. Avisar al cliente\n2. Abrir ticket' },
      { id: 'todo', src: '- [ ] Revisar logs\n- [x] Escalar a N2' },
    ],
  },
  {
    titleKey: 'mdHelp.s.headings',
    rows: [
      { id: 'h2', src: '## Resumen del incidente' },
      { id: 'quote', src: '> El cliente confirma el corte' },
    ],
  },
  {
    titleKey: 'mdHelp.s.blocks',
    rows: [
      { id: 'link', src: '[Ticket GLPI](https://glpi.example/5806)' },
      { id: 'block', src: '```\nERROR 504 gateway timeout\n```' },
      { id: 'table', src: '| IP | Estado |\n|---|---|\n| 10.0.0.1 | caído |' },
    ],
  },
  {
    titleKey: 'mdHelp.s.own',
    rows: [
      { id: 'enter', src: 'línea uno\nlínea dos', noteKey: 'mdHelp.note.enter' },
      { id: 'defang', src: 'hxxp://malo[.]com 1.2.3[.]4', noteKey: 'mdHelp.note.defang' },
    ],
  },
];

/**
 * Guía de formato (comentario del dueño #9, artboard "Bitácora: ayuda de
 * formato", aprobado 2026-10-03): lo que escribes y cómo se ve, renderizado
 * con el mismo Markdown de la app. Tocar una fila lo lleva a "Pruébalo";
 * "Agregar a mi entrada" cierra devolviendo el texto para sumarlo a lo escrito.
 */
@Component({
  selector: 'app-markdown-help-dialog',
  standalone: true,
  imports: [FormsModule, MatIconModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mh" role="document">
      <header class="mh__head">
        <span class="mh__title"><mat-icon>text_format</mat-icon>{{ i18n.t('mdHelp.title') }}</span>
        <span class="mh__sub">{{ i18n.t('mdHelp.subtitle') }}</span>
        <button type="button" class="mh__x" [attr.aria-label]="i18n.t('mdHelp.close')" (click)="ref.close()"><mat-icon>close</mat-icon></button>
      </header>
      <div class="mh__body">
        <div class="mh__list">
          @for (s of sections; track s.titleKey) {
            <span class="mh__label">{{ i18n.t(s.titleKey) }}</span>
            <div class="mh__table" role="list">
              <div class="mh__row mh__row--head"><span>{{ i18n.t('mdHelp.write') }}</span><span>{{ i18n.t('mdHelp.looks') }}</span></div>
              @for (r of s.rows; track r.id) {
                <button type="button" role="listitem" class="mh__row" [class.mh__row--on]="picked() === r.id" [title]="i18n.t('mdHelp.try')" (click)="pick(r)">
                  <span class="mh__src">{{ r.src }}</span>
                  <app-markdown class="app-markdown--compact" [content]="r.src" />
                </button>
              }
            </div>
          }
        </div>
        <aside class="mh__try">
          <span class="mh__label">{{ i18n.t('mdHelp.tryTitle') }}</span>
          <textarea class="mh__src" rows="6" name="mdTry" [attr.aria-label]="i18n.t('mdHelp.tryTitle')" [ngModel]="text()" (ngModelChange)="text.set($event)"></textarea>
          <span class="mh__hint">{{ i18n.t('mdHelp.tryHint') }}</span>
          <span class="mh__label">{{ i18n.t('mdHelp.looks') }}</span>
          <div class="mh__out"><app-markdown class="app-markdown--compact" [content]="text()" /></div>
          <button type="button" class="mh__insert" [disabled]="!text().trim()" (click)="ref.close(text())"><mat-icon>south</mat-icon>{{ i18n.t('mdHelp.insert') }}</button>
          <span class="mh__hint mh__hint--center">{{ note() }}</span>
        </aside>
      </div>
    </div>
  `,
  styleUrl: './markdown-help-dialog.css',
})
export class MarkdownHelpDialogComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly ref = inject<DialogRef<string>>(DialogRef);
  protected readonly sections = SECTIONS;
  protected readonly picked = signal('bold');
  protected readonly text = signal(SECTIONS[0].rows[0].src);
  private readonly noteKey = signal<MessageKey | undefined>(undefined);
  protected readonly note = computed(() => this.i18n.t(this.noteKey() ?? 'mdHelp.insertHint'));

  protected pick(row: Example): void {
    this.picked.set(row.id);
    this.text.set(row.src);
    this.noteKey.set(row.noteKey);
  }
}

/**
 * Abre la guía (carga diferida) y devuelve el texto a agregar, o undefined si
 * se cerró sin agregar. Uso: `const md = await openMarkdownHelp(this.injector)`.
 */
export async function openMarkdownHelp(injector: Injector): Promise<string | undefined> {
  const { Dialog } = await import('@angular/cdk/dialog');
  const i18n = injector.get(I18nService);
  const ref = injector.get(Dialog).open<string>(MarkdownHelpDialogComponent, { ariaLabel: i18n.t('mdHelp.title'), maxWidth: '100vw' });
  return new Promise((resolve) => ref.closed.subscribe((value) => resolve(value ?? undefined)));
}

/** Suma un fragmento al final de un texto, en su propia línea. */
export function appendSnippet(text: string, snippet: string): string {
  if (!text.trim()) return snippet;
  return text.replace(/\s+$/, '') + '\n' + snippet;
}
