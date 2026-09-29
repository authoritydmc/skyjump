import { EC2Client, DescribeInstancesCommand, DescribeInstancesCommandOutput } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { ElastiCacheClient, DescribeCacheClustersCommand } from "@aws-sdk/client-elasticache";
import { EC2InstanceInfo, RDSDatabaseInfo, CacheClusterInfo } from "../types.js";

export interface AWSOptions {
  region?: string;
  profile?: string;
}

/**
 * Lists active and stopped EC2 instances in the current AWS region.
 */
export async function listEC2Instances(options: AWSOptions = {}): Promise<EC2InstanceInfo[]> {
  const client = new EC2Client({ region: options.region });
  const command = new DescribeInstancesCommand({});
  const response: DescribeInstancesCommandOutput = await client.send(command);

  const instances: EC2InstanceInfo[] = [];

  for (const reservation of response.Reservations || []) {
    for (const inst of reservation.Instances || []) {
      const tags: Record<string, string> = {};
      let name = inst.InstanceId || "Unnamed";

      for (const t of inst.Tags || []) {
        if (t.Key && t.Value) {
          tags[t.Key] = t.Value;
          if (t.Key.toLowerCase() === "name") {
            name = t.Value;
          }
        }
      }

      instances.push({
        instanceId: inst.InstanceId || "",
        name,
        state: inst.State?.Name || "unknown",
        privateIp: inst.PrivateIpAddress,
        publicIp: inst.PublicIpAddress,
        vpcId: inst.VpcId,
        subnetId: inst.SubnetId,
        platform: inst.PlatformDetails || inst.Platform || "Linux/UNIX",
        instanceType: inst.InstanceType,
        launchTime: inst.LaunchTime,
        tags,
      });
    }
  }

  return instances;
}

/**
 * Lists RDS Database instances and Aurora clusters.
 */
export async function listRDSDatabases(options: AWSOptions = {}): Promise<RDSDatabaseInfo[]> {
  const client = new RDSClient({ region: options.region });
  const databases: RDSDatabaseInfo[] = [];

  try {
    const instResponse = await client.send(new DescribeDBInstancesCommand({}));
    for (const db of instResponse.DBInstances || []) {
      if (db.Endpoint?.Address) {
        databases.push({
          dbIdentifier: db.DBInstanceIdentifier || "",
          engine: db.Engine || "unknown",
          engineVersion: db.EngineVersion,
          endpoint: db.Endpoint.Address,
          port: db.Endpoint.Port || (db.Engine?.includes("mysql") ? 3306 : 5432),
          status: db.DBInstanceStatus || "unknown",
          vpcId: db.DBSubnetGroup?.VpcId,
          masterUsername: db.MasterUsername,
          dbName: db.DBName,
        });
      }
    }
  } catch (err) {
    // Continue to check clusters if permissions allow
  }

  try {
    const clusterResponse = await client.send(new DescribeDBClustersCommand({}));
    for (const cluster of clusterResponse.DBClusters || []) {
      if (cluster.Endpoint) {
        databases.push({
          dbIdentifier: `${cluster.DBClusterIdentifier} (Aurora Cluster)`,
          engine: cluster.Engine || "aurora",
          engineVersion: cluster.EngineVersion,
          endpoint: cluster.Endpoint,
          port: cluster.Port || 5432,
          status: cluster.Status || "unknown",
          vpcId: cluster.DBSubnetGroup,
          masterUsername: cluster.MasterUsername,
          dbName: cluster.DatabaseName,
        });
      }
    }
  } catch (err) {}

  return databases;
}

/**
 * Lists ElastiCache Redis & Memcached clusters.
 */
export async function listCacheClusters(options: AWSOptions = {}): Promise<CacheClusterInfo[]> {
  const client = new ElastiCacheClient({ region: options.region });
  const response = await client.send(new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true }));
  const clusters: CacheClusterInfo[] = [];

  for (const c of response.CacheClusters || []) {
    const endpoint = c.ConfigurationEndpoint?.Address || c.CacheNodes?.[0]?.Endpoint?.Address || "";
    const port = c.ConfigurationEndpoint?.Port || c.CacheNodes?.[0]?.Endpoint?.Port || 6379;

    if (endpoint) {
      clusters.push({
        clusterId: c.CacheClusterId || "",
        engine: c.Engine || "redis",
        endpoint,
        port,
        status: c.CacheClusterStatus || "unknown",
      });
    }
  }

  return clusters;
}

/**
 * Finds an online running EC2 instance inside a target VPC that can act as an SSM Jump Bastion.
 */
export async function findSSMBastionInstance(vpcId?: string, options: AWSOptions = {}): Promise<string | null> {
  const instances = await listEC2Instances(options);
  const running = instances.filter((i) => i.state === "running");

  if (vpcId) {
    // Find bastion or running instance in that VPC
    const inVpc = running.filter((i) => i.vpcId === vpcId);
    // Prefer instance with 'bastion' or 'jump' or 'ssm' in name
    const bastion = inVpc.find((i) => /bastion|jump|nat|gateway/i.test(i.name)) || inVpc[0];
    if (bastion) return bastion.instanceId;
  }

  // Fallback to any running bastion or running instance
  const bastion = running.find((i) => /bastion|jump|nat|gateway/i.test(i.name)) || running[0];
  return bastion ? bastion.instanceId : null;
}
