import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Foto de perfil o, si no hay, las iniciales del nombre. */
@Component({
  selector: 'app-user-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src()) {
      <img [src]="src()" alt="" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
  host: { '[class.avatar--large]': 'size() === "large"' },
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      overflow: hidden;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 11px;
      font-weight: 700;
    }

    :host(.avatar--large) {
      width: 44px;
      height: 44px;
      font-size: 15px;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class UserAvatarComponent {
  readonly name = input('');
  readonly src = input<string | undefined>('');
  readonly size = input<'small' | 'large'>('small');

  protected readonly initials = computed(
    () =>
      (this.name() || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase() || '?',
  );
}
