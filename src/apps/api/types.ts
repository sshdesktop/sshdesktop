import { ApiHeader, ApiQueryParam, ApiFormDataItem, ApiResponsePayload } from '../../lib/tauri-bridge';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type BodyType = 'none' | 'json' | 'form-data' | 'x-www-form-urlencoded' | 'raw';

export type AuthType = 'none' | 'bearer' | 'basic' | 'apikey';

export interface ApiAuth {
  type: AuthType;
  bearerToken?: string;
  basicUser?: string;
  basicPass?: string;
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyLocation?: 'header' | 'query';
}

export interface ApiTabState {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  useSshTunnel: boolean;
  headers: ApiHeader[];
  queryParams: ApiQueryParam[];
  auth: ApiAuth;
  bodyType: BodyType;
  rawBody: string;
  formData: ApiFormDataItem[];
  timeoutSeconds: number;
  followRedirects: boolean;
  verifySsl: boolean;
  
  // Execution State
  isLoading: boolean;
  response: ApiResponsePayload | null;
  error: string | null;
  isDirty?: boolean;
}

export interface SavedRequest {
  id: string;
  collectionId?: string;
  name: string;
  method: HttpMethod;
  url: string;
  useSshTunnel: boolean;
  headers: ApiHeader[];
  queryParams: ApiQueryParam[];
  auth: ApiAuth;
  bodyType: BodyType;
  rawBody: string;
  formData: ApiFormDataItem[];
  updatedAt: string;
}

export interface ApiCollection {
  id: string;
  name: string;
  description?: string;
  requests: SavedRequest[];
}

export interface HistoryItem {
  id: string;
  timestamp: string;
  method: HttpMethod;
  url: string;
  status: number;
  durationMs: number;
  sizeBytes: number;
  useSshTunnel: boolean;
  requestSnapshot: ApiTabState;
}

export interface ApiEnvironment {
  id: string;
  name: string;
  variables: Array<{ key: string; value: string; enabled: boolean }>;
}
