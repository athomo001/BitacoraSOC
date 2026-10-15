import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ApiEnvelope } from '../auth/auth.models';

/** Una notificación de la campana (spec/16 §4.5, 9.5). */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Ruta de la app ("/agenda", "/tickets?id=…"); vacío = no lleva a otra pantalla. */
  link: string;
  count: number;
  toast: boolean;
  browser: boolean;
  createdAt: string;
  updatedAt: string;
  readAt?: string;
}

export interface NotifKindPref {
  kind: string;
  toast: boolean;
  email: boolean;
  emailAllowed: boolean;
  toastAllowed: boolean;
  locked: boolean;
  myToast?: boolean;
  myEmail?: boolean;
}

export interface NotifPrefs {
  kinds: NotifKindPref[];
  digest: boolean;
  browser: boolean;
  digestTime: string;
}

export interface NotifSettings {
  digestTime: string;
  lockedKinds: string[];
  groupMinutes: number;
  retentionDays: number;
  kinds: { kind: string; toastAllowed: boolean; emailAllowed: boolean }[];
}

export interface PendingNotice {
  id: string;
  title: string;
  body: string;
  publishAt: string;
  createdByName: string;
}

export interface NoticeAudience {
  kind: 'people' | 'level' | 'area' | 'all';
  userIds?: string[];
  areaIds?: string[];
  levelIds?: string[];
}

export interface SentNotice {
  id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  publishAt: string;
  expiresAt?: string;
  published: boolean;
  createdByName: string;
  total: number;
  read: number;
}

export interface NoticeRecipient {
  userId: string;
  name: string;
  readAt?: string;
  remindedAt?: string;
}

/**
 * Centro de notificaciones: la campana (número de no leídas en vivo), los
 * avisos emergentes, las notificaciones del navegador y los avisos con
 * acuse que esperan «Leído». El shell lo enciende con start() y le pasa los
 * eventos en vivo con onEvent().
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);

  readonly unread = signal(0);
  readonly items = signal<AppNotification[]>([]);
  readonly toasts = signal<AppNotification[]>([]);
  readonly pendingNotices = signal<PendingNotice[]>([]);
  readonly browserEnabled = signal(false);
  readonly canSendNotices = signal(false);

  private me = '';
  /** Lo que ya se mostró como emergente (id + última actualización). */
  private shown = new Set<string>();
  private started = false;

  /** Carga la campana y los avisos con acuse pendientes. No avisa lo que ya estaba. */
  async start(userId: string): Promise<void> {
    this.me = userId;
    if (this.started) return;
    this.started = true;
    await this.refresh(false);
    await this.refreshNotices();
    void this.noticesMeta().then((m) => this.canSendNotices.set(m.canSend), () => this.canSendNotices.set(false));
    try {
      const p = await this.prefs();
      this.browserEnabled.set(p.browser);
    } catch {
      // sin preferencias se usan las de por defecto
    }
  }

  /** Eventos en vivo: solo los que nombran al usuario. */
  onEvent(eventType: string, data: unknown): void {
    const users = (data as { users?: string[] } | null)?.users;
    if (!this.me || !Array.isArray(users) || !users.includes(this.me)) return;
    if (eventType === 'notifications.changed') void this.refresh(true);
    if (eventType === 'notices.published') void this.refreshNotices();
  }

  async refresh(announce: boolean): Promise<void> {
    try {
      const res = (await firstValueFrom(this.http.get<ApiEnvelope<{ items: AppNotification[]; unread: number }>>('/api/notifications', {
        params: new HttpParams().set('filter', 'all'),
      }))).data;
      this.items.set(res.items);
      this.unread.set(res.unread);
      for (const n of res.items) {
        const key = n.id + n.updatedAt;
        if (this.shown.has(key)) continue;
        this.shown.add(key);
        if (!announce || n.readAt) continue;
        if (n.toast) this.toasts.update((t) => [...t.filter((x) => x.id !== n.id), n]);
        if (n.browser) this.browserNotify(n);
      }
    } catch {
      // la campana reintenta con el próximo evento
    }
  }

  async refreshNotices(): Promise<void> {
    try {
      this.pendingNotices.set((await firstValueFrom(this.http.get<ApiEnvelope<PendingNotice[]>>('/api/notices/pending'))).data);
    } catch {
      // sin conexión se vuelve a intentar al próximo evento
    }
  }

  dismissToast(id: string): void {
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  async markRead(ids: string[]): Promise<void> {
    const res = (await firstValueFrom(this.http.post<ApiEnvelope<{ unread: number }>>('/api/notifications/read', { ids }))).data;
    const now = new Date().toISOString();
    this.items.update((list) => list.map((n) => (ids.length === 0 || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    this.unread.set(res.unread);
  }

  /** Notificación del sistema operativo: solo con la pestaña en segundo plano y permiso dado. */
  private browserNotify(n: AppNotification): void {
    if (!this.browserEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (typeof document !== 'undefined' && !document.hidden) return;
    try {
      new Notification(n.title, { body: n.body, tag: n.id });
    } catch {
      // algunos navegadores solo la permiten desde un service worker
    }
  }

  /** Pide permiso al navegador. Devuelve si quedó concedido. */
  async askBrowserPermission(): Promise<boolean> {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    return (await Notification.requestPermission()) === 'granted';
  }

  // ===== Preferencias y configuración =====

  async prefs(): Promise<NotifPrefs> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<NotifPrefs>>('/api/notifications/prefs'))).data;
  }

  async savePrefs(kinds: Record<string, { toast?: boolean; email?: boolean }>, digest: boolean, browser: boolean): Promise<NotifPrefs> {
    const p = (await firstValueFrom(this.http.put<ApiEnvelope<NotifPrefs>>('/api/notifications/prefs', { kinds, digest, browser }))).data;
    this.browserEnabled.set(p.browser);
    return p;
  }

  async settings(): Promise<NotifSettings> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<NotifSettings>>('/api/notifications/settings'))).data;
  }

  async saveSettings(s: Omit<NotifSettings, 'kinds'>): Promise<NotifSettings> {
    return (await firstValueFrom(this.http.put<ApiEnvelope<NotifSettings>>('/api/notifications/settings', s))).data;
  }

  // ===== Avisos con acuse =====

  async readNotice(id: string): Promise<void> {
    await firstValueFrom(this.http.post(`/api/notices/${id}/read`, {}));
    this.pendingNotices.update((list) => list.filter((n) => n.id !== id));
  }

  async noticesMeta(): Promise<{ canSend: boolean; seesAll: boolean }> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<{ canSend: boolean; seesAll: boolean }>>('/api/notices/meta'))).data;
  }

  async createNotice(n: { title: string; body: string; audience: NoticeAudience; publishAt?: string | null; expiresAt?: string | null }): Promise<SentNotice[]> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<SentNotice[]>>('/api/notices', n))).data;
  }

  async sentNotices(): Promise<SentNotice[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<SentNotice[]>>('/api/notices/sent'))).data;
  }

  async noticeRecipients(id: string): Promise<NoticeRecipient[]> {
    return (await firstValueFrom(this.http.get<ApiEnvelope<NoticeRecipient[]>>(`/api/notices/${id}/recipients`))).data;
  }

  async remindNotice(id: string): Promise<number> {
    return (await firstValueFrom(this.http.post<ApiEnvelope<{ reminded: number }>>(`/api/notices/${id}/remind`, {}))).data.reminded;
  }
}
