// src/utils/ports.ts
import net from "net";
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, "127.0.0.1");
  });
}
async function findFreePort(preferredPort, maxAttempts = 50) {
  const startPort = preferredPort || 5432;
  for (let port = startPort; port < startPort + maxAttempts; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
  }
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => resolve(startPort + 100));
      }
    });
  });
}

// src/utils/db-clients.ts
import { spawn } from "child_process";
function generateConnectionUrl(params) {
  const { engine, host, port, username, password, database } = params;
  let protocol = "postgresql";
  if (engine.includes("mysql") || engine.includes("aurora-mysql") || engine.includes("mariadb")) {
    protocol = "mysql";
  } else if (engine.includes("redis") || engine.includes("valkey")) {
    protocol = "redis";
  }
  const auth = username ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@` : "";
  const dbPath = database ? `/${encodeURIComponent(database)}` : "";
  return `${protocol}://${auth}${host}:${port}${dbPath}`;
}
function launchDBClient(client, params) {
  return new Promise((resolve, reject) => {
    const url = generateConnectionUrl(params);
    if (client === "tableplus") {
      const tableplusUrl = url.replace(/^postgresql:/, "tableplus:").replace(/^mysql:/, "tableplus:");
      const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
      const child = spawn(openCmd, [tableplusUrl], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "dbeaver") {
      const openCmd = process.platform === "darwin" ? "open" : "dbeaver";
      const child = spawn(openCmd, ["-con", `url=${url}`], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "psql" || client === "pgcli") {
      const child = spawn(client, ["-h", params.host, "-p", String(params.port), "-U", params.username || "postgres", params.database || "postgres"], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "mysql" || client === "mycli") {
      const child = spawn(client, ["-h", params.host, "-P", String(params.port), "-u", params.username || "root", ...params.database ? [params.database] : []], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "redis-cli") {
      const child = spawn("redis-cli", ["-h", params.host, "-p", String(params.port)], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    reject(new Error(`Unknown DB client: ${client}`));
  });
}

// src/services/aws-discovery.ts
import { EC2Client, DescribeInstancesCommand } from "@aws-sdk/client-ec2";
import { RDSClient, DescribeDBInstancesCommand, DescribeDBClustersCommand } from "@aws-sdk/client-rds";
import { ElastiCacheClient, DescribeCacheClustersCommand } from "@aws-sdk/client-elasticache";
async function listEC2Instances(options = {}) {
  const client = new EC2Client({ region: options.region });
  const command = new DescribeInstancesCommand({});
  const response = await client.send(command);
  const instances = [];
  for (const reservation of response.Reservations || []) {
    for (const inst of reservation.Instances || []) {
      const tags = {};
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
        tags
      });
    }
  }
  return instances;
}
async function listRDSDatabases(options = {}) {
  const client = new RDSClient({ region: options.region });
  const databases = [];
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
          dbName: db.DBName
        });
      }
    }
  } catch (err) {
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
          dbName: cluster.DatabaseName
        });
      }
    }
  } catch (err) {
  }
  return databases;
}
async function listCacheClusters(options = {}) {
  const client = new ElastiCacheClient({ region: options.region });
  const response = await client.send(new DescribeCacheClustersCommand({ ShowCacheNodeInfo: true }));
  const clusters = [];
  for (const c of response.CacheClusters || []) {
    const endpoint = c.ConfigurationEndpoint?.Address || c.CacheNodes?.[0]?.Endpoint?.Address || "";
    const port = c.ConfigurationEndpoint?.Port || c.CacheNodes?.[0]?.Endpoint?.Port || 6379;
    if (endpoint) {
      clusters.push({
        clusterId: c.CacheClusterId || "",
        engine: c.Engine || "redis",
        endpoint,
        port,
        status: c.CacheClusterStatus || "unknown"
      });
    }
  }
  return clusters;
}
async function findSSMBastionInstance(vpcId, options = {}) {
  const instances = await listEC2Instances(options);
  const running = instances.filter((i) => i.state === "running");
  if (vpcId) {
    const inVpc = running.filter((i) => i.vpcId === vpcId);
    const bastion2 = inVpc.find((i) => /bastion|jump|nat|gateway/i.test(i.name)) || inVpc[0];
    if (bastion2) return bastion2.instanceId;
  }
  const bastion = running.find((i) => /bastion|jump|nat|gateway/i.test(i.name)) || running[0];
  return bastion ? bastion.instanceId : null;
}

// src/services/ssm-tunnel.ts
import { spawn as spawn2 } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
var CONFIG_DIR = path.join(os.homedir(), ".skyjump");
var STATE_FILE = path.join(CONFIG_DIR, "tunnels.json");
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}
function startSSMShell(instanceId, options = {}) {
  return new Promise((resolve, reject) => {
    const args = ["ssm", "start-session", "--target", instanceId];
    if (options.region) {
      args.push("--region", options.region);
    }
    if (options.profile) {
      args.push("--profile", options.profile);
    }
    const child = spawn2("aws", args, {
      stdio: "inherit"
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`SSM session exited with code ${code}`));
    });
    child.on("error", (err) => {
      reject(new Error(`Failed to start AWS SSM session: ${err.message}. Ensure AWS CLI & Session Manager Plugin are installed.`));
    });
  });
}
var TunnelManager = class {
  static loadState() {
    ensureConfigDir();
    if (!fs.existsSync(STATE_FILE)) return [];
    try {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      const sessions = JSON.parse(data);
      return sessions.filter((s) => {
        if (!s.pid) return false;
        try {
          process.kill(s.pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }
  static saveState(sessions) {
    ensureConfigDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(sessions, null, 2), "utf-8");
  }
  /**
   * List all active background tunnels.
   */
  static listTunnels() {
    const liveSessions = this.loadState();
    this.saveState(liveSessions);
    return liveSessions;
  }
  /**
   * Start a remote port forwarding session via AWS SSM.
   */
  static async startTunnel(params) {
    const { bastionInstanceId, remoteHost, remotePort, localPort, targetName, targetType, region, profile, background } = params;
    const sessionParams = JSON.stringify({
      host: [remoteHost],
      portNumber: [String(remotePort)],
      localPortNumber: [String(localPort)]
    });
    const args = [
      "ssm",
      "start-session",
      "--target",
      bastionInstanceId,
      "--document-name",
      "AWS-StartPortForwardingSessionToRemoteHost",
      "--parameters",
      sessionParams
    ];
    if (region) args.push("--region", region);
    if (profile) args.push("--profile", profile);
    const child = spawn2("aws", args, {
      stdio: background ? "ignore" : ["inherit", "pipe", "pipe"],
      detached: Boolean(background)
    });
    if (background) {
      child.unref();
    }
    const sessionId = `tun-${Date.now()}-${localPort}`;
    const session = {
      id: sessionId,
      targetType,
      targetName,
      remoteHost,
      remotePort,
      localPort,
      bastionInstanceId,
      pid: child.pid,
      startTime: (/* @__PURE__ */ new Date()).toISOString(),
      status: "running"
    };
    if (background && child.pid) {
      const active = this.loadState();
      active.push(session);
      this.saveState(active);
    }
    return { session, child };
  }
  /**
   * Stop a running tunnel by ID or Port.
   */
  static stopTunnel(identifier) {
    const active = this.loadState();
    const target = active.find((s) => s.id === identifier || String(s.localPort) === identifier || s.targetName === identifier);
    if (target && target.pid) {
      try {
        process.kill(target.pid, "SIGTERM");
      } catch {
      }
      const remaining = active.filter((s) => s.id !== target.id);
      this.saveState(remaining);
      return true;
    }
    return false;
  }
  /**
   * Stop all active background tunnels.
   */
  static stopAll() {
    const active = this.loadState();
    let count = 0;
    for (const session of active) {
      if (session.pid) {
        try {
          process.kill(session.pid, "SIGTERM");
          count++;
        } catch {
        }
      }
    }
    this.saveState([]);
    return count;
  }
};

// src/services/doctor.ts
import { execSync } from "child_process";
async function runDiagnostics(options = {}) {
  const checks = [];
  try {
    const version = execSync("aws --version", { encoding: "utf-8" }).trim();
    checks.push({
      name: "AWS CLI Installation",
      passed: true,
      message: "AWS CLI is installed",
      details: version
    });
  } catch {
    checks.push({
      name: "AWS CLI Installation",
      passed: false,
      message: "AWS CLI not found in PATH",
      details: "Please install AWS CLI v2: https://aws.amazon.com/cli/"
    });
  }
  try {
    const ssmPlugin = execSync("session-manager-plugin", { encoding: "utf-8" }).trim();
    checks.push({
      name: "SSM Session Manager Plugin",
      passed: true,
      message: "Session Manager Plugin is installed",
      details: ssmPlugin
    });
  } catch (e) {
    const output = (e.stdout || e.stderr || "").toString();
    if (output.includes("SessionManagerPlugin") || output.includes("Usage")) {
      checks.push({
        name: "SSM Session Manager Plugin",
        passed: true,
        message: "Session Manager Plugin is installed"
      });
    } else {
      checks.push({
        name: "SSM Session Manager Plugin",
        passed: false,
        message: "session-manager-plugin not found",
        details: "Install plugin for port-forwarding: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html"
      });
    }
  }
  try {
    const profArg = options.profile ? `--profile ${options.profile}` : "";
    const regArg = options.region ? `--region ${options.region}` : "";
    const identityRaw = execSync(`aws sts get-caller-identity ${profArg} ${regArg}`, { encoding: "utf-8" });
    const identity = JSON.parse(identityRaw);
    checks.push({
      name: "AWS Authentication & IAM",
      passed: true,
      message: `Authenticated as: ${identity.Arn || identity.UserId}`,
      details: `Account: ${identity.Account}`
    });
  } catch (err) {
    checks.push({
      name: "AWS Authentication & IAM",
      passed: false,
      message: "Failed to authenticate with AWS credentials",
      details: "Run 'aws sso login' or configure your credentials via 'aws configure'."
    });
  }
  return checks;
}
export {
  TunnelManager,
  findFreePort,
  findSSMBastionInstance,
  generateConnectionUrl,
  isPortAvailable,
  launchDBClient,
  listCacheClusters,
  listEC2Instances,
  listRDSDatabases,
  runDiagnostics,
  startSSMShell
};
//# sourceMappingURL=index.mjs.map