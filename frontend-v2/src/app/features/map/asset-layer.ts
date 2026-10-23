import { MapAsset, MapAssetStatus, MapSpot } from '../../core/map/map.models';
import { I18nService } from '../../core/i18n/i18n.service';
import { PRIORITY_SHORT } from '../../core/tickets/ticket-view';

/**
 * Capa «Equipos» del Mapa: los equipos del Inventario con coordenadas. Verde
 * sin novedad, ámbar en mantenimiento y rojo con un ticket abierto, un
 * incidente abierto o una entrada de incidente en la Bitácora. Los equipos de
 * un mismo punto (un rack) son un solo pin con el color del peor.
 */

const ORDER: Record<MapAssetStatus, number> = { bad: 0, warn: 1, ok: 2 };

/** Un motivo de por qué el equipo no está en verde, con su enlace si lo tiene. */
export interface AssetReason {
  tone: 'bad' | 'warn';
  icon: string;
  text: string;
  link?: { path: string; query: Record<string, string> };
}

/** Los equipos agrupados por punto, los afectados primero dentro de cada uno. */
export function groupSpots(assets: MapAsset[]): MapSpot[] {
  const byKey = new Map<string, MapSpot>();
  for (const a of assets) {
    const key = `${a.latitude.toFixed(6)},${a.longitude.toFixed(6)}`;
    const spot = byKey.get(key) ?? { key, latitude: a.latitude, longitude: a.longitude, assets: [] };
    spot.assets.push(a);
    byKey.set(key, spot);
  }
  const spots = [...byKey.values()];
  for (const s of spots) s.assets.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name));
  return spots;
}

/** El color del pin: el del equipo en peor estado. */
export function spotTone(s: MapSpot): MapAssetStatus {
  return s.assets[0]?.status ?? 'ok';
}

export function affected(s: MapSpot): MapAsset[] {
  return s.assets.filter((a) => a.status !== 'ok');
}

/** «Rack A» si todos son del mismo grupo; si no, el nombre del primero. */
export function spotTitle(s: MapSpot): string {
  const group = s.assets[0].groupName;
  return group && s.assets.every((a) => a.groupName === group) ? group : s.assets[0].name;
}

/** El texto de la Bitácora es Markdown: para la tarjetita, una línea simple. */
export function plain(md: string, max = 140): string {
  const text = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#*_`>~|]/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** Qué le pasa al equipo y por qué, del más grave al más leve. */
export function reasons(a: MapAsset, i18n: I18nService, when: (iso: string) => string): AssetReason[] {
  const out: AssetReason[] = [];
  if (a.ticket) {
    const t = a.ticket;
    const priority = (PRIORITY_SHORT as Record<string, string>)[t.priority] ?? '';
    const more = t.count > 1 ? ' ' + i18n.tf('map.tip.more', t.count - 1) : '';
    out.push({ tone: 'bad', icon: 'confirmation_number', text: `${t.number} · ${t.title}${priority ? ' (' + priority + ')' : ''}${more}`, link: { path: '/tickets', query: { id: t.id } } });
  }
  if (a.incident) {
    out.push({ tone: 'bad', icon: 'error', text: i18n.tf('map.tip.incident', when(a.incident.openedAt)) + ': ' + a.incident.title });
  }
  if (a.entry) {
    const e = a.entry;
    out.push({ tone: 'bad', icon: 'edit_note', text: `${i18n.tf('map.tip.entry', `${e.author}, ${when(e.at)}`)}: «${plain(e.content)}»`, link: { path: '/entries', query: { entry: e.id } } });
  }
  if (a.maintenance) {
    out.push({ tone: 'warn', icon: 'engineering', text: i18n.tf('map.tip.maintenance', when(a.maintenance.until)) + ': ' + a.maintenance.title });
  }
  return out;
}

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * La tarjetita al pasar el mouse: el punto, el cliente y, por cada equipo
 * afectado, qué pasó y por qué. Se arma con textContent (el texto viene de
 * la Bitácora y de los tickets: nunca como HTML).
 */
export function tipElement(s: MapSpot, i18n: I18nService, when: (iso: string) => string): HTMLElement {
  const root = el('div', 'mp-tip__box');
  root.append(el('b', 'mp-tip__title', spotTitle(s)));
  const client = s.assets[0].clientName;
  const count = i18n.tf(s.assets.length === 1 ? 'map.assetOne' : 'map.assetMany', s.assets.length);
  root.append(el('span', 'mp-tip__sub', [client ?? i18n.t('map.client.internal'), count].join(' · ')));
  const hit = affected(s);
  if (!hit.length) {
    root.append(el('span', 'mp-tip__line mp-tip__line--ok', i18n.t('map.tip.ok')));
    return root;
  }
  for (const a of hit.slice(0, 3)) {
    if (s.assets.length > 1) root.append(el('span', 'mp-tip__asset', a.name));
    for (const r of reasons(a, i18n, when)) root.append(el('span', `mp-tip__line mp-tip__line--${r.tone}`, r.text));
  }
  if (hit.length > 3) root.append(el('span', 'mp-tip__sub', i18n.tf('map.tip.moreAssets', hit.length - 3)));
  return root;
}
