"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  TunnelManager: () => TunnelManager,
  findFreePort: () => findFreePort,
  findSSMBastionInstance: () => findSSMBastionInstance,
  generateConnectionUrl: () => generateConnectionUrl,
  isPortAvailable: () => isPortAvailable,
  launchDBClient: () => launchDBClient,
  listCacheClusters: () => listCacheClusters,
  listEC2Instances: () => listEC2Instances,
  listRDSDatabases: () => listRDSDatabases,
  runDiagnostics: () => runDiagnostics,
  startSSMShell: () => startSSMShell
});
module.exports = __toCommonJS(src_exports);

// src/utils/ports.ts
var import_net = __toESM(require("net"));
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = import_net.default.createServer();
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
    const server = import_net.default.createServer();
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
var import_child_process = require("child_process");
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
      const child = (0, import_child_process.spawn)(openCmd, [tableplusUrl], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "dbeaver") {
      const openCmd = process.platform === "darwin" ? "open" : "dbeaver";
      const child = (0, import_child_process.spawn)(openCmd, ["-con", `url=${url}`], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "psql" || client === "pgcli") {
      const child = (0, import_child_process.spawn)(client, ["-h", params.host, "-p", String(params.port), "-U", params.username || "postgres", params.database || "postgres"], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "mysql" || client === "mycli") {
      const child = (0, import_child_process.spawn)(client, ["-h", params.host, "-P", String(params.port), "-u", params.username || "root", ...params.database ? [params.database] : []], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "redis-cli") {
      const child = (0, import_child_process.spawn)("redis-cli", ["-h", params.host, "-p", String(params.port)], {
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
var import_client_ec2 = require("@aws-sdk/client-ec2");
var import_client_rds = require("@aws-sdk/client-rds");
var import_client_elasticache = require("@aws-sdk/client-elasticache");
async function listEC2Instances(options = {}) {
  const client = new import_client_ec2.EC2Client({ region: options.region });
  const command = new import_client_ec2.DescribeInstancesCommand({});
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
  const client = new import_client_rds.RDSClient({ region: options.region });
  const databases = [];
  try {
    const instResponse = await client.send(new import_client_rds.DescribeDBInstancesCommand({}));
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
    const clusterResponse = await client.send(new import_client_rds.DescribeDBClustersCommand({}));
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
  const client = new import_client_elasticache.ElastiCacheClient({ region: options.region });
  const response = await client.send(new import_client_elasticache.DescribeCacheClustersCommand({ ShowCacheNodeInfo: true }));
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
var import_child_process2 = require("child_process");
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_os = __toESM(require("os"));
var CONFIG_DIR = import_path.default.join(import_os.default.homedir(), ".skyjump");
var STATE_FILE = import_path.default.join(CONFIG_DIR, "tunnels.json");
function ensureConfigDir() {
  if (!import_fs.default.existsSync(CONFIG_DIR)) {
    import_fs.default.mkdirSync(CONFIG_DIR, { recursive: true });
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
    const child = (0, import_child_process2.spawn)("aws", args, {
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
    if (!import_fs.default.existsSync(STATE_FILE)) return [];
    try {
      const data = import_fs.default.readFileSync(STATE_FILE, "utf-8");
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
    import_fs.default.writeFileSync(STATE_FILE, JSON.stringify(sessions, null, 2), "utf-8");
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
    const child = (0, import_child_process2.spawn)("aws", args, {
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
var import_child_process3 = require("child_process");
async function runDiagnostics(options = {}) {
  const checks = [];
  try {
    const version = (0, import_child_process3.execSync)("aws --version", { encoding: "utf-8" }).trim();
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
    const ssmPlugin = (0, import_child_process3.execSync)("session-manager-plugin", { encoding: "utf-8" }).trim();
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
    const identityRaw = (0, import_child_process3.execSync)(`aws sts get-caller-identity ${profArg} ${regArg}`, { encoding: "utf-8" });
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
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
});
//# sourceMappingURL=index.js.map