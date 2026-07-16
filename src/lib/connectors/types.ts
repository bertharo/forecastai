/**
 * Connector SDK — uniform lifecycle for all vendor adapters.
 * authenticate → discover → backfill → incremental → health
 */
export type ConnectorTier = 1 | 2 | 3 | 4;

export type SyncPhase =
  | "authenticate"
  | "discover"
  | "backfill"
  | "incremental"
  | "health";

/** FOCUS-aligned normalized usage row produced by every adapter */
export interface NormalizedUsageEvent {
  eventTime: Date;
  providerKey: string;
  skuId: string | null;
  meterKey: string;
  consumedQuantity: number;
  consumedUnit: string;
  requestId?: string;
  latencyMs?: number;
  tags: Record<string, string>;
  chargePeriodStart?: Date;
  chargePeriodEnd?: Date;
  serviceName: string;
  allocationStatus?: "allocated" | "unallocated";
}

export interface DiscoverResult {
  workspaces?: string[];
  projects?: string[];
  members?: number;
  estimatedMonthlySpend?: number;
}

export interface SyncResult {
  phase: SyncPhase;
  rowsIn: number;
  rowsWritten: number;
  events: NormalizedUsageEvent[];
  errors: string[];
}

export interface HealthStatus {
  ok: boolean;
  message: string;
  lastSyncedAt?: Date;
}

export interface ConnectorAdapter {
  providerKey: string;
  tier: ConnectorTier;
  displayName: string;
  authenticate(config: Record<string, unknown>): Promise<{ ok: boolean; message: string }>;
  discover(config: Record<string, unknown>): Promise<DiscoverResult>;
  backfill(config: Record<string, unknown>, since: Date): Promise<SyncResult>;
  incremental(config: Record<string, unknown>, since: Date): Promise<SyncResult>;
  health(config: Record<string, unknown>): Promise<HealthStatus>;
}
