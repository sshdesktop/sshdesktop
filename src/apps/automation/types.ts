import { SavedConnection } from '../../lib/types';

export type TargetServer = SavedConnection;

export interface TargetHealth {
  serverId: string;
  reachable: boolean;
  os?: string;
  kernel?: string;
  uptime?: string;
  loadAvg?: string;
  memUsage?: string;
  diskUsage?: string;
  latencyMs?: number;
  lastChecked?: number;
  error?: string;
}

export type ExecutionMode = 'parallel' | 'rolling';

export interface AutomationVariable {
  name: string;
  label: string;
  defaultValue: string;
  placeholder?: string;
  description?: string;
}

export type RecipeCategory = 
  | 'system'
  | 'maintenance' 
  | 'security' 
  | 'docker' 
  | 'web' 
  | 'cleanup' 
  | 'custom';

export interface AutomationRecipe {
  id: string;
  title: string;
  description: string;
  category: RecipeCategory;
  icon: string;
  command: string;
  isSudo: boolean;
  timeoutSeconds?: number;
  stopOnError?: boolean;
  variables?: AutomationVariable[];
  isBuiltIn?: boolean;
  createdAt?: number;
}

export interface ServerExecutionResult {
  serverId: string;
  serverName: string;
  host: string;
  port: number;
  username: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface AutomationExecutionRun {
  id: string;
  recipeId?: string;
  recipeTitle: string;
  command: string;
  mode: ExecutionMode;
  concurrency: number;
  timestamp: number;
  totalServers: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  durationMs: number;
  results: Record<string, ServerExecutionResult>;
}

// Enterprise Organization Hierarchy
export interface FleetOrganization {
  id: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: number;
}

export interface FleetGroup {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  tags?: string[];
  color?: string;
  createdAt: number;
}

export interface FleetMatrixData {
  organizations: FleetOrganization[];
  groups: FleetGroup[];
  // Mapping of serverId to { organizationId, groupId }
  mappings: Record<string, { organizationId: string; groupId: string }>;
}

// Replica Sets Cluster Management
export type ReplicationType = 'database' | 'rsync' | 'config' | 'service';

export interface ReplicaNodeStatus {
  role: 'primary' | 'replica';
  status: 'healthy' | 'lagging' | 'offline' | 'unknown';
  lastChecked?: number;
  details?: string;
}

export interface ReplicaSet {
  id: string;
  name: string;
  description?: string;
  primaryServerId: string;
  replicaServerIds: string[];
  replicationType: ReplicationType;
  syncCommand?: string;
  healthCheckCommand?: string;
  autoFailover?: boolean;
  healthStatus?: Record<string, ReplicaNodeStatus>;
  createdAt: number;
  updatedAt?: number;
}

export interface AutomationServerData {
  user: string;
  version: string;
  updated_at: string;
  custom_recipes: AutomationRecipe[];
  history: AutomationExecutionRun[];
  fleet_matrix?: FleetMatrixData;
  replica_sets?: ReplicaSet[];
  last_target_server_ids?: string[];
  client: string;
}

export interface AutomationSyncStatus {
  synced: boolean;
  syncing: boolean;
  lastSyncedAt?: number;
  serverPath: string;
  error?: string;
}
