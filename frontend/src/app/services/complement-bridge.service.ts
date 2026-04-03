import { Injectable, OnDestroy } from '@angular/core';
import { EntryService } from './entry.service';
import { Theme } from '../models/user.model';
import { ComplementInboundEvent } from '../models/complement.model';

type RegisteredFrame = {
  slug: string;
  origin: string;
  frameWindow: Window | null;
  timestamps: number[];
};

type BridgeContext = {
  user?: Record<string, unknown> | null;
  shift?: Record<string, unknown> | null;
  checklist?: Record<string, unknown> | null;
  theme?: Theme;
};

@Injectable({
  providedIn: 'root'
})
export class ComplementBridgeService implements OnDestroy {
  private readonly registry = new Map<string, RegisteredFrame>();
  private readonly messageHandler = (event: MessageEvent) => this.handleMessage(event);
  private context: BridgeContext = {};

  constructor(private entryService: EntryService) {
    window.addEventListener('message', this.messageHandler);
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.messageHandler);
  }

  registerFrame(slug: string, frameWindow: Window | null, baseUrl: string): void {
    this.registry.set(slug, {
      slug,
      origin: new URL(baseUrl).origin,
      frameWindow,
      timestamps: []
    });
    this.publishTo(slug, 'CONTEXT_UPDATE', this.context);
  }

  unregisterFrame(slug: string): void {
    this.registry.delete(slug);
  }

  updateContext(patch: Partial<BridgeContext>): void {
    this.context = {
      ...this.context,
      ...patch
    };
    this.publish('CONTEXT_UPDATE', this.context);
  }

  publish(type: 'CONTEXT_UPDATE' | 'SHIFT_CHANGE' | 'USER_CHANGE' | 'THEME_CHANGE' | 'CHECKLIST_SUBMITTED', payload: Record<string, unknown>): void {
    this.registry.forEach((frame) => {
      frame.frameWindow?.postMessage({
        type,
        version: 1,
        timestamp: Date.now(),
        payload
      }, frame.origin);
    });
  }

  publishTo(slug: string, type: 'CONTEXT_UPDATE' | 'SHIFT_CHANGE' | 'USER_CHANGE' | 'THEME_CHANGE' | 'CHECKLIST_SUBMITTED', payload: BridgeContext): void {
    const frame = this.registry.get(slug);
    if (!frame) {
      return;
    }
    frame.frameWindow?.postMessage({
      type,
      version: 1,
      timestamp: Date.now(),
      payload
    }, frame.origin);
  }

  private handleMessage(event: MessageEvent): void {
    const matchedFrame = Array.from(this.registry.values()).find((frame) => frame.origin === event.origin && frame.frameWindow === event.source);
    if (!matchedFrame) {
      return;
    }

    const now = Date.now();
    matchedFrame.timestamps = matchedFrame.timestamps.filter((timestamp) => now - timestamp < 10000);
    matchedFrame.timestamps.push(now);
    if (matchedFrame.timestamps.length > 100) {
      this.unregisterFrame(matchedFrame.slug);
      return;
    }

    const payload = event.data as ComplementInboundEvent;
    if (!payload || typeof payload !== 'object' || payload.version !== 1 || typeof payload.type !== 'string') {
      return;
    }

    if (payload.type === 'REQUEST_CONTEXT') {
      this.publishTo(matchedFrame.slug, 'CONTEXT_UPDATE', this.context);
      return;
    }

    if (payload.type === 'CREATE_ENTRY') {
      const content = String(payload.payload?.['content'] || '').trim();
      if (!content) {
        return;
      }

      this.entryService.createEntry({
        content,
        entryType: (payload.payload?.['entryType'] as 'operativa' | 'incidente' | 'ofensa') || 'operativa',
        entryDate: new Date().toISOString().slice(0, 10),
        entryTime: new Date().toISOString().slice(11, 16)
      }).subscribe();
    }
  }
}