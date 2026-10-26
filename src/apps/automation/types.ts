import { SavedConnection } from '../../lib/types';

export interface TargetServer {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  private_key_path?: string;
  privateKeyPath?: string;
  authMethod?: string;
  authType?: 'password' | 'privateKey' | 'agent';
  color?: string;
  group?: string;
  tags?: string[];
  status?: 'active' | 'inactive';
  organizationId?: string;
  groupId?: string;
  notes?: string;
  osType?: string;
}

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

export interface FleetServer {
  id: string;
  organizationId: string;
  groupId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  authType?: 'password' | 'privateKey' | 'agent';
  tags?: string[];
  osType?: string;
  status: 'active' | 'inactive';
  notes?: string;
  lastChecked?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface FleetMatrixData {
  organizations: FleetOrganization[];
  groups: FleetGroup[];
  servers: FleetServer[];
  mappings?: Record<string, { organizationId: string; groupId: string }>;
}

export interface AutomationServerData {
  user: string;
  version: string;
  updated_at: string;
  custom_recipes: AutomationRecipe[];
  history: AutomationExecutionRun[];
  fleet_matrix?: FleetMatrixData;
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
