export interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'paused' | 'stopped';
  statusText: string;
  ports: string;
  created: string;
  cpu: string;
  mem: string;
}

export interface ImageItem {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface VolumeItem {
  name: string;
  driver: string;
  scope: string;
  mountpoint?: string;
  size?: string;
}

export interface NetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnet?: string;
}

export interface ContainerInspectData {
  id: string;
  name: string;
  image: string;
  status: string;
  startedAt: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
  restartPolicy: string;
  env: string[];
  ports: { hostPort: string; containerPort: string; protocol: string }[];
  mounts: { source: string; destination: string; mode: string; type: string }[];
  rawJson?: string;
}

export interface DockerAuthInfo {
  username: string;
  registry: string;
  loggedIn: boolean;
}

export interface SavedDockerCredential {
  id: string;
  registry: string;
  username: string;
  savedAt: string;
}

export type ResourceDeleteType = 'container' | 'bulk-containers' | 'image' | 'volume' | 'network';

export interface ResourceInUseItem {
  name: string;
  id?: string;
  status?: string;
  details?: string;
}

export interface ResourceDeleteTarget {
  type: ResourceDeleteType;
  id: string;
  name: string;
  subText?: string;
  isRunning?: boolean;
  bulkIds?: string[];
  inUseBy?: ResourceInUseItem[];
  allowForce?: boolean;
}
