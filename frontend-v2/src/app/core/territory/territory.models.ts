/** ENUM técnico territorial_kind — nunca se muestra tal cual (HU-TERR-1). */
export type TerritorialKind = 'country' | 'region' | 'zone' | 'site';

export const TERRITORIAL_KINDS: readonly TerritorialKind[] = ['country', 'region', 'zone', 'site'];

/** app_config.territorial_kind_labels — lo que la UI muestra por nivel. */
export type TerritorialLabels = Record<TerritorialKind, string>;

export interface TerritorialUnit {
  id: string;
  parentId: string | null;
  kind: TerritorialKind;
  name: string;
  code: string;
  path: string;
  depth: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  active: boolean;
  childCount?: number;
}

export interface ImportResult {
  importedCount: number;
  updatedCount: number;
  errors: { code: string; reason: string }[];
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}
