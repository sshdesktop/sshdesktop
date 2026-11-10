// ─── SSH Desktop Database Studio Types ────────────────────────────────
export type DbEngine = 
  | 'postgresql' 
  | 'mysql' 
  | 'mariadb' 
  | 'sqlite' 
  | 'mssql' 
  | 'mongodb' 
  | 'redis' 
  | 'oracle' 
  | 'dynamodb' 
  | 'cosmos' 
  | 'cassandra' 
  | 'db2';

export interface DbConnectionProfile {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  schema?: string;
  useSsl?: boolean;
  sslVerify?: boolean;
  useSsh?: boolean;
  sshConnectionId?: string;
  sqlitePath?: string;
  // Cloud & NoSQL parameters
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  endpointUrl?: string;
  keyspace?: string;
  sid?: string;
  color?: string;
  lastConnected?: string;
  saveCredentials?: boolean;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  isForeignKey?: boolean;
  referencedTable?: string;
  referencedColumn?: string;
  extra?: string;
}

export interface TableItem {
  name: string;
  type: 'table' | 'view' | 'collection' | 'keyspace';
  schema?: string;
  rowCount?: number;
  columns?: ColumnDefinition[];
  partitionKey?: string;
  sortKey?: string;
  isExpanded?: boolean;
}

export interface RoutineItem {
  name: string;
  type: 'procedure' | 'function';
  returnType?: string;
}

export interface TriggerItem {
  name: string;
  tableName: string;
  timing?: string;
  event?: string;
}

export interface IndexItem {
  name: string;
  tableName: string;
  columnName: string;
  isUnique: boolean;
  type: string;
}

export interface ForeignKeyRelation {
  tableName: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
  constraintName?: string;
}

export interface BatchStatementResult {
  statement: string;
  columns: { name: string; data_type: string }[];
  rows: any[];
  affected_rows: number;
  last_insert_id?: number | null;
  execution_time_ms: number;
  error?: string | null;
}

export interface QueryTab {
  id: string;
  title: string;
  query: string;
  results: any[];
  columns: string[];
  rawOutput: string;
  execTime: string;
  error: string | null;
  successInfo: string | null;
  allResults?: BatchStatementResult[];
  activeResultIndex?: number;
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  splitMode?: 'horizontal' | 'vertical' | 'editor-only' | 'results-only';
  fontSize?: number;
  wordWrap?: boolean;
  showMinimap?: boolean;
  isExecuting?: boolean;
}

export interface DataGridState {
  table: string | null;
  rows: any[];
  columns: string[];
  totalCount: number;
  pageSize: number;
  currentPage: number;
  loading: boolean;
  error: string | null;
  selectedRowIndex: number | null;
  selectedColumnIndex: number | null;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
}

export interface RowCreateModel {
  tableName: string;
  engine?: DbEngine;
  values?: Record<string, any>;
  autoGenFields?: Record<string, boolean>;
}

export interface DatabaseCatalogItem {
  name: string;
  isCurrent?: boolean;
  size?: string;
}
