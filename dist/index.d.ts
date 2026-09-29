import { ChildProcess } from 'child_process';

interface EC2InstanceInfo {
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
interface RDSDatabaseInfo {
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
interface CacheClusterInfo {
    clusterId: string;
    engine: string;
    endpoint: string;
    port: number;
    status: string;
    vpcId?: string;
}
interface TunnelSession {
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
type DBClientType = "tableplus" | "dbeaver" | "psql" | "pgcli" | "mysql" | "mycli" | "redis-cli";
interface DBConnectionParams {
    engine: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
    database?: string;
}

/**
 * Check if a specific TCP port is available locally.
 */
declare function isPortAvailable(port: number): Promise<boolean>;
/**
 * Find an available local port starting from the preferred port.
 */
declare function findFreePort(preferredPort?: number, maxAttempts?: number): Promise<number>;

/**
 * Generate standard connection URL from connection parameters.
 */
declare function generateConnectionUrl(params: DBConnectionParams): string;
/**
 * Launch external Database Client UI or CLI tool.
 */
declare function launchDBClient(client: DBClientType, params: DBConnectionParams): Promise<void>;

interface AWSOptions {
    region?: string;
    profile?: string;
}
/**
 * Lists active and stopped EC2 instances in the current AWS region.
 */
declare function listEC2Instances(options?: AWSOptions): Promise<EC2InstanceInfo[]>;
/**
 * Lists RDS Database instances and Aurora clusters.
 */
declare function listRDSDatabases(options?: AWSOptions): Promise<RDSDatabaseInfo[]>;
/**
 * Lists ElastiCache Redis & Memcached clusters.
 */
declare function listCacheClusters(options?: AWSOptions): Promise<CacheClusterInfo[]>;
/**
 * Finds an online running EC2 instance inside a target VPC that can act as an SSM Jump Bastion.
 */
declare function findSSMBastionInstance(vpcId?: string, options?: AWSOptions): Promise<string | null>;

/**
 * Start an interactive SSM Shell session to an EC2 instance.
 */
declare function startSSMShell(instanceId: string, options?: {
    region?: string;
    profile?: string;
}): Promise<void>;
/**
 * Tunnel Manager handles persistent local background and foreground tunnels.
 */
declare class TunnelManager {
    private static loadState;
    private static saveState;
    /**
     * List all active background tunnels.
     */
    static listTunnels(): TunnelSession[];
    /**
     * Start a remote port forwarding session via AWS SSM.
     */
    static startTunnel(params: {
        bastionInstanceId: string;
        remoteHost: string;
        remotePort: number;
        localPort: number;
        targetName: string;
        targetType: "rds" | "redis" | "ec2" | "custom";
        region?: string;
        profile?: string;
        background?: boolean;
    }): Promise<{
        session: TunnelSession;
        child: ChildProcess;
    }>;
    /**
     * Stop a running tunnel by ID or Port.
     */
    static stopTunnel(identifier: string): boolean;
    /**
     * Stop all active background tunnels.
     */
    static stopAll(): number;
}

interface DiagnosticCheck {
    name: string;
    passed: boolean;
    message: string;
    details?: string;
}
/**
 * Run comprehensive developer environment and AWS connectivity diagnostics.
 */
declare function runDiagnostics(options?: {
    region?: string;
    profile?: string;
}): Promise<DiagnosticCheck[]>;

export { type AWSOptions, type CacheClusterInfo, type DBClientType, type DBConnectionParams, type DiagnosticCheck, type EC2InstanceInfo, type RDSDatabaseInfo, TunnelManager, type TunnelSession, findFreePort, findSSMBastionInstance, generateConnectionUrl, isPortAvailable, launchDBClient, listCacheClusters, listEC2Instances, listRDSDatabases, runDiagnostics, startSSMShell };
