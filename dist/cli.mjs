// src/cli.ts
import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";

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
import { spawn } from "child_process";
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
    const child = spawn("aws", args, {
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
    const child = spawn("aws", args, {
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
import { spawn as spawn2 } from "child_process";
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
      const child = spawn2(openCmd, [tableplusUrl], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "dbeaver") {
      const openCmd = process.platform === "darwin" ? "open" : "dbeaver";
      const child = spawn2(openCmd, ["-con", `url=${url}`], { detached: true, stdio: "ignore" });
      child.unref();
      return resolve();
    }
    if (client === "psql" || client === "pgcli") {
      const child = spawn2(client, ["-h", params.host, "-p", String(params.port), "-U", params.username || "postgres", params.database || "postgres"], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "mysql" || client === "mycli") {
      const child = spawn2(client, ["-h", params.host, "-P", String(params.port), "-u", params.username || "root", ...params.database ? [params.database] : []], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    if (client === "redis-cli") {
      const child = spawn2("redis-cli", ["-h", params.host, "-p", String(params.port)], {
        stdio: "inherit"
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }
    reject(new Error(`Unknown DB client: ${client}`));
  });
}

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

// src/cli.ts
async function interactiveEC2(options) {
  const s = p.spinner();
  s.start("Discovering EC2 instances in AWS...");
  const instances = await listEC2Instances(options);
  s.stop(`Found ${instances.length} EC2 instance(s).`);
  if (instances.length === 0) {
    p.log.warn("No EC2 instances found in current region.");
    return;
  }
  const selection = await p.select({
    message: "Select an EC2 instance to connect to:",
    options: instances.map((inst) => ({
      value: inst.instanceId,
      label: `${inst.name} (${inst.instanceId})`,
      hint: `${inst.state} | ${inst.privateIp || "no-ip"} | ${inst.instanceType || ""}`
    }))
  });
  if (p.isCancel(selection)) return;
  p.log.info(pc.cyan(`Starting SSM Session to ${selection}...`));
  await startSSMShell(selection, options);
}
async function interactiveDB(options) {
  const s = p.spinner();
  s.start("Discovering RDS databases & clusters...");
  const databases = await listRDSDatabases(options);
  s.stop(`Found ${databases.length} RDS database(s).`);
  if (databases.length === 0) {
    p.log.warn("No RDS instances found.");
    return;
  }
  const selectedDBId = await p.select({
    message: "Select an RDS database to tunnel to:",
    options: databases.map((db2) => ({
      value: db2.dbIdentifier,
      label: `${db2.dbIdentifier} (${db2.engine})`,
      hint: `${db2.endpoint}:${db2.port} | ${db2.status}`
    }))
  });
  if (p.isCancel(selectedDBId)) return;
  const db = databases.find((d) => d.dbIdentifier === selectedDBId);
  s.start("Finding SSM Bastion Host in target VPC...");
  const bastion = await findSSMBastionInstance(db.vpcId, options);
  s.stop(bastion ? `Using Bastion instance: ${bastion}` : "No specific bastion found, using default instance");
  if (!bastion) {
    p.log.error("Could not find a running EC2 instance to act as SSM jump host in target VPC.");
    return;
  }
  const localPort = options.port || await findFreePort(db.port);
  p.log.success(pc.green(`Binding local port: ${localPort} -> remote ${db.endpoint}:${db.port}`));
  const { session, child } = await TunnelManager.startTunnel({
    bastionInstanceId: bastion,
    remoteHost: db.endpoint,
    remotePort: db.port,
    localPort,
    targetName: db.dbIdentifier,
    targetType: "rds",
    region: options.region,
    profile: options.profile,
    background: options.background
  });
  const connectionUrl = generateConnectionUrl({
    engine: db.engine,
    host: "127.0.0.1",
    port: localPort,
    username: db.masterUsername,
    database: db.dbName
  });
  console.log("\n" + pc.bold(pc.cyan("\u2728 Connection Ready:")));
  console.log(`  ${pc.bold("Local Endpoint:")}  127.0.0.1:${localPort}`);
  console.log(`  ${pc.bold("Connection URI:")}  ${pc.yellow(connectionUrl)}`);
  console.log(`  ${pc.bold("Target:")}          ${db.dbIdentifier} (${db.engine})
`);
  if (options.open) {
    p.log.info(`Launching ${options.open}...`);
    await launchDBClient(options.open, {
      engine: db.engine,
      host: "127.0.0.1",
      port: localPort,
      username: db.masterUsername,
      database: db.dbName
    });
  }
  if (!options.background) {
    p.log.message(pc.dim("Tunnel running in foreground. Press Ctrl+C to terminate."));
    await new Promise((resolve) => {
      child.on("exit", () => resolve());
      process.on("SIGINT", () => {
        child.kill();
        resolve();
      });
    });
  }
}
async function interactiveMainMenu() {
  p.intro(pc.bgCyan(pc.black(" skyjump \u2014 Zero-Friction AWS EC2 & RDS Tunneling ")));
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "ec2", label: "\u{1F5A5}\uFE0F  EC2 Instance Shell", hint: "Connect to EC2 via AWS SSM" },
      { value: "rds", label: "\u{1F5C4}\uFE0F  RDS Database Tunnel", hint: "Forward local port to private RDS" },
      { value: "redis", label: "\u26A1 ElastiCache Redis Tunnel", hint: "Forward local port to Redis cluster" },
      { value: "tunnels", label: "\u{1F4CA} Active Tunnels Manager", hint: "View & terminate running tunnels" },
      { value: "doctor", label: "\u{1FA7A} Connectivity Doctor", hint: "Check AWS CLI, SSM, and credentials" }
    ]
  });
  if (p.isCancel(action)) {
    p.outro("Goodbye!");
    return;
  }
  if (action === "ec2") {
    await interactiveEC2({});
  } else if (action === "rds") {
    await interactiveDB({});
  } else if (action === "tunnels") {
    showTunnels();
  } else if (action === "doctor") {
    await runDoctor({});
  }
  p.outro("Done!");
}
function showTunnels() {
  const tunnels = TunnelManager.listTunnels();
  if (tunnels.length === 0) {
    p.log.info("No active background tunnels running.");
    return;
  }
  console.log("\n" + pc.bold("Active Background Tunnels:"));
  for (const t of tunnels) {
    console.log(`  ${pc.cyan(t.id)} | ${pc.green(`127.0.0.1:${t.localPort}`)} -> ${t.remoteHost}:${t.remotePort} (${t.targetName}) [PID: ${t.pid}]`);
  }
  console.log();
}
async function runDoctor(options) {
  const s = p.spinner();
  s.start("Running AWS environment diagnostics...");
  const checks = await runDiagnostics(options);
  s.stop("Diagnostics completed.");
  console.log("\n" + pc.bold("Diagnostic Results:"));
  for (const c of checks) {
    const icon = c.passed ? pc.green("\u2714") : pc.red("\u2716");
    console.log(`  ${icon} ${pc.bold(c.name)}: ${c.message}`);
    if (c.details) {
      console.log(`     ${pc.dim(c.details)}`);
    }
  }
  console.log();
}
async function main() {
  const program = new Command();
  program.name("skyjump").description("Zero-friction AWS EC2/SSM shell sessions and automatic RDS/Redis port forwarding across private VPCs.").version("1.0.0", "-v, --version", "Output current version").option("-r, --region <region>", "AWS region to target").option("-p, --profile <profile>", "AWS CLI profile");
  program.command("ec2 [target]").description("Connect to an EC2 instance shell via AWS SSM").action(async (target, cmdOptions) => {
    const globalOpts = program.opts();
    if (target) {
      p.log.info(pc.cyan(`Starting SSM Session to ${target}...`));
      await startSSMShell(target, { region: globalOpts.region, profile: globalOpts.profile });
    } else {
      await interactiveEC2({ region: globalOpts.region, profile: globalOpts.profile });
    }
  });
  program.command("db [target]").alias("rds").description("Port forward to an RDS Database").option("-l, --port <port>", "Local port to bind to", (v) => parseInt(v, 10)).option("-o, --open <client>", "Launch database client (tableplus, dbeaver, psql, pgcli, mysql, mycli)").option("-b, --background", "Run tunnel in the background daemon mode", false).action(async (target, cmdOptions) => {
    const globalOpts = program.opts();
    await interactiveDB({
      region: globalOpts.region,
      profile: globalOpts.profile,
      port: cmdOptions.port,
      open: cmdOptions.open,
      background: cmdOptions.background
    });
  });
  program.command("tunnels").description("List and manage active background tunnels").argument("[action]", "Action to perform: list, stop <id>, stop-all", "list").argument("[id]", "Tunnel ID or Local Port to stop").action((action, id) => {
    if (action === "list") {
      showTunnels();
    } else if (action === "stop") {
      if (!id) {
        p.log.error("Please specify a tunnel ID or port to stop.");
        return;
      }
      const stopped = TunnelManager.stopTunnel(id);
      if (stopped) p.log.success(pc.green(`Stopped tunnel ${id}`));
      else p.log.warn(`No running tunnel found matching ${id}`);
    } else if (action === "stop-all") {
      const count = TunnelManager.stopAll();
      p.log.success(pc.green(`Stopped ${count} tunnel(s).`));
    }
  });
  program.command("doctor").description("Run connectivity and environment diagnostics").action(async () => {
    const globalOpts = program.opts();
    await runDoctor({ region: globalOpts.region, profile: globalOpts.profile });
  });
  if (process.argv.length <= 2) {
    await interactiveMainMenu();
    return;
  }
  await program.parseAsync(process.argv);
}
main().catch((err) => {
  console.error(pc.red(`Error: ${err.message || err}`));
  process.exit(1);
});
//# sourceMappingURL=cli.mjs.map