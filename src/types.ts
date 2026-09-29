export interface EC2InstanceInfo {
  instanceId: string;
  name: string;
  state: string;
  privateIp?: string;
  publicIp?: string;
  vpcId?: string;
  subnetId?: string;
  platform?: string;
  instanceType?: string;
  launchTime?: Date;
  tags: Record<string, string>;
}

export interface RDSDatabaseInfo {
  dbIdentifier: string;
  engine: string;
  engineVersion?: string;
  endpoint: string;
  port: number;
  status: string;
  vpcId?: string;
  masterUsername?: string;
  dbName?: string;
}

export interface CacheClusterInfo {
  clusterId: string;
  engine: string;
  endpoint: string;
  port: number;
  status: string;
  vpcId?: string;
}

export interface TunnelSession {
  id: string;
  targetType: "rds" | "redis" | "ec2" | "custom";
  targetName: string;
  remoteHost: string;
  remotePort: number;
  localPort: number;
  bastionInstanceId: string;
  pid?: number;
  startTime: string;
  status: "running" | "stopped" | "failed";
}

export type DBClientType =
  | "tableplus"
  | "dbeaver"
  | "psql"
  | "pgcli"
  | "mysql"
  | "mycli"
  | "redis-cli";

export interface DBConnectionParams {
  engine: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  database?: string;
}
