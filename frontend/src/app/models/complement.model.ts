/**
 * File Purpose: frontend/src/app/models/complement.model.ts
 * Responsibilities: Define the module behavior and maintain clear contracts.
 * QA Notes: Keep business rules explicit, validate edge cases, and preserve traceability.
 */

export type ComplementScope =
  | 'READ_CONTEXT'
  | 'READ_LOGS'
  | 'WRITE_ENTRIES'
  | 'READ_STORAGE'
  | 'WRITE_STORAGE'
  | 'WRITE_LOGS';

export interface Complement {
  _id: string;
  slug: string;
  name: string;
  baseUrl: string;
  internalBaseUrl?: string;
  iframeUrl: string;
  dbName: string;
  apiVersion: 'v1' | 'v2';
  status: 'active' | 'disabled' | 'maintenance';
  cleanupHookPath: string;
  healthPath: string;
  permissions: {
    scopes: ComplementScope[];
    allowedCollections: string[];
  };
  visibility?: ComplementVisibility;
  sourceArtifact?: ComplementSourceArtifact | null;
  runtimePolicy?: ComplementRuntimePolicy;
  metadata?: Record<string, unknown>;
  lastTokenIssuedAt?: string | null;
  circuit: {
    state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    failCount: number;
    lastFailure?: string | null;
    lastCheck?: string | null;
    lastError?: string | null;
  };
}

export interface ComplementVisibility {
  roles: Array<'admin' | 'user' | 'auditor' | 'guest'>;
  cargoLabels: string[];
}

export interface ComplementSourceArtifact {
  sourceType: 'manual' | 'zip-static';
  stackKey?: string | null;
  originalFileName?: string | null;
  previewUrl?: string | null;
  previewRelativePath?: string | null;
  publishedUrl?: string | null;
  publishedRelativePath?: string | null;
  managedByPlatform?: boolean;
  lastPreviewAt?: string | null;
  publishedAt?: string | null;
}

export interface ComplementRuntimePolicy {
  csp: {
    allowUnsafeEval: boolean;
    allowBlobWorker: boolean;
    extraConnectSrc: string[];
    extraChildSrc: string[];
  };
  iframeSandbox: {
    allowPointerLock: boolean;
    allowPopups: boolean;
    allowDownloads: boolean;
  };
}

export interface ComplementFormValue {
  slug: string;
  name: string;
  baseUrl: string;
  internalBaseUrl: string;
  dbName: string;
  apiVersion: 'v1' | 'v2';
  status: 'active' | 'disabled' | 'maintenance';
  cleanupHookPath: string;
  healthPath: string;
  iframePath: string;
  scopes: ComplementScope[];
  allowedCollections: string[];
  visibleRoles: Array<'admin' | 'user' | 'auditor' | 'guest'>;
  visibleCargoLabels: string[];
  allowUnsafeEval: boolean;
  allowBlobWorker: boolean;
  extraConnectSrc: string;
  extraChildSrc: string;
  sandboxAllowPointerLock: boolean;
  sandboxAllowPopups: boolean;
  sandboxAllowDownloads: boolean;
}

export interface ComplementSourceStackInfo {
  key: string;
  label: string;
  description: string;
  runtime: string;
  recommendedPermissions: {
    scopes: ComplementScope[];
    allowedCollections: string[];
  };
}

export interface ComplementSourceLimits {
  maxArchiveBytes: number;
  maxArchiveMb: number;
  maxFiles: number;
  maxUncompressedBytes: number;
  maxUncompressedMb: number;
  acceptedExtensions: string[];
  supportedLanguageSummary: string[];
  unsupportedPolicy: string;
  supportedStacks: ComplementSourceStackInfo[];
  blockedLanguages: string[];
  notes: string[];
}

export interface ComplementSourceValidation {
  fileName: string;
  fileSize: number;
  allowed: boolean;
  detectedStack: ComplementSourceStackInfo | null;
  detectedLanguage: string;
  reason: string;
  packageJson: {
    name: string;
    version: string;
    scripts: string[];
    dependencies: string[];
    devDependencies: string[];
  } | null;
  archive: {
    fileCount: number;
    totalUncompressedBytes: number;
    sampleFiles: string[];
  };
  limits: ComplementSourceLimits;
  suggestedConfig: {
    slug: string;
    name: string;
    dbName: string;
    apiVersion: 'v1' | 'v2';
    status: 'active' | 'disabled' | 'maintenance';
    healthPath: string;
    cleanupHookPath: string;
    iframePath: string;
    permissions: {
      scopes: ComplementScope[];
      allowedCollections: string[];
    };
  } | null;
  nextStep: string;
}

export interface ComplementSourcePreview {
  analysis: ComplementSourceValidation;
  previewUrl: string;
  previewBaseUrl: string;
  previewRelativePath: string;
}

export interface ComplementSourcePublishResult {
  mode: 'created' | 'updated';
  complement: Complement;
  token?: string;
  expiresAt?: string;
  publishedUrl: string;
}

export interface ComplementContextEvent {
  type: 'CONTEXT_UPDATE' | 'SHIFT_CHANGE' | 'USER_CHANGE' | 'THEME_CHANGE' | 'CHECKLIST_SUBMITTED';
  version: 1;
  timestamp: number;
  payload: Record<string, unknown>;
}

export interface ComplementInboundEvent {
  type: 'REQUEST_CONTEXT' | 'CREATE_ENTRY' | 'NOTIFY_ERROR';
  version: 1;
  slug?: string;
  payload?: Record<string, unknown>;
}