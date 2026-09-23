export interface ModuleFlags {
  socEnabled: boolean;
  nocEnabled: boolean;
}

/** GET /api/setup/status */
export interface SetupStatus extends ModuleFlags {
  setupCompleted: boolean;
}

/** POST /api/setup/bootstrap */
export interface BootstrapRequest extends ModuleFlags {
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
}
