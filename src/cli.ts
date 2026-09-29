#!/usr/bin/env node
import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { listEC2Instances, listRDSDatabases, listCacheClusters, findSSMBastionInstance } from "./services/aws-discovery.js";
import { startSSMShell, TunnelManager } from "./services/ssm-tunnel.js";
import { findFreePort } from "./utils/ports.js";
import { generateConnectionUrl, launchDBClient } from "./utils/db-clients.js";
import { runDiagnostics } from "./services/doctor.js";
import { DBClientType } from "./types.js";

async function interactiveEC2(options: { region?: string; profile?: string }): Promise<void> {
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
      hint: `${inst.state} | ${inst.privateIp || "no-ip"} | ${inst.instanceType || ""}`,
    })),
  });

  if (p.isCancel(selection)) return;

  p.log.info(pc.cyan(`Starting SSM Session to ${selection}...`));
  await startSSMShell(selection as string, options);
}

async function interactiveDB(options: { region?: string; profile?: string; port?: number; open?: string; background?: boolean }): Promise<void> {
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
    options: databases.map((db) => ({
      value: db.dbIdentifier,
      label: `${db.dbIdentifier} (${db.engine})`,
      hint: `${db.endpoint}:${db.port} | ${db.status}`,
    })),
  });

  if (p.isCancel(selectedDBId)) return;

  const db = databases.find((d) => d.dbIdentifier === selectedDBId)!;

  s.start("Finding SSM Bastion Host in target VPC...");
  const bastion = await findSSMBastionInstance(db.vpcId, options);
  s.stop(bastion ? `Using Bastion instance: ${bastion}` : "No specific bastion found, using default instance");

  if (!bastion) {
    p.log.error("Could not find a running EC2 instance to act as SSM jump host in target VPC.");
    return;
  }

  const localPort = options.port || (await findFreePort(db.port));
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
    background: options.background,
  });

  const connectionUrl = generateConnectionUrl({
    engine: db.engine,
    host: "127.0.0.1",
    port: localPort,
    username: db.masterUsername,
    database: db.dbName,
  });

  console.log("\n" + pc.bold(pc.cyan("✨ Connection Ready:")));
  console.log(`  ${pc.bold("Local Endpoint:")}  127.0.0.1:${localPort}`);
  console.log(`  ${pc.bold("Connection URI:")}  ${pc.yellow(connectionUrl)}`);
  console.log(`  ${pc.bold("Target:")}          ${db.dbIdentifier} (${db.engine})\n`);

  if (options.open) {
    p.log.info(`Launching ${options.open}...`);
    await launchDBClient(options.open as DBClientType, {
      engine: db.engine,
      host: "127.0.0.1",
      port: localPort,
      username: db.masterUsername,
      database: db.dbName,
    });
  }

  if (!options.background) {
    p.log.message(pc.dim("Tunnel running in foreground. Press Ctrl+C to terminate."));
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      process.on("SIGINT", () => {
        child.kill();
        resolve();
      });
    });
  }
}

async function interactiveMainMenu(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" skyjump — Zero-Friction AWS EC2 & RDS Tunneling ")));

  const action = await p.select({
    message: "What would you like to do?",
    options: [
      { value: "ec2", label: "🖥️  EC2 Instance Shell", hint: "Connect to EC2 via AWS SSM" },
      { value: "rds", label: "🗄️  RDS Database Tunnel", hint: "Forward local port to private RDS" },
      { value: "redis", label: "⚡ ElastiCache Redis Tunnel", hint: "Forward local port to Redis cluster" },
      { value: "tunnels", label: "📊 Active Tunnels Manager", hint: "View & terminate running tunnels" },
      { value: "doctor", label: "🩺 Connectivity Doctor", hint: "Check AWS CLI, SSM, and credentials" },
    ],
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

function showTunnels(): void {
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

async function runDoctor(options: { region?: string; profile?: string }): Promise<void> {
  const s = p.spinner();
  s.start("Running AWS environment diagnostics...");
  const checks = await runDiagnostics(options);
  s.stop("Diagnostics completed.");

  console.log("\n" + pc.bold("Diagnostic Results:"));
  for (const c of checks) {
    const icon = c.passed ? pc.green("✔") : pc.red("✖");
    console.log(`  ${icon} ${pc.bold(c.name)}: ${c.message}`);
    if (c.details) {
      console.log(`     ${pc.dim(c.details)}`);
    }
  }
  console.log();
}

async function main() {
  const program = new Command();

  program
    .name("skyjump")
    .description("Zero-friction AWS EC2/SSM shell sessions and automatic RDS/Redis port forwarding across private VPCs.")
    .version("1.0.1", "-v, --version", "Output current version")
    .option("-r, --region <region>", "AWS region to target")
    .option("-p, --profile <profile>", "AWS CLI profile");

  program
    .command("ec2 [target]")
    .description("Connect to an EC2 instance shell via AWS SSM")
    .action(async (target, cmdOptions) => {
      const globalOpts = program.opts();
      if (target) {
        p.log.info(pc.cyan(`Starting SSM Session to ${target}...`));
        await startSSMShell(target, { region: globalOpts.region, profile: globalOpts.profile });
      } else {
        await interactiveEC2({ region: globalOpts.region, profile: globalOpts.profile });
      }
    });

  program
    .command("db [target]")
    .alias("rds")
    .description("Port forward to an RDS Database")
    .option("-l, --port <port>", "Local port to bind to", (v) => parseInt(v, 10))
    .option("-o, --open <client>", "Launch database client (tableplus, dbeaver, psql, pgcli, mysql, mycli)")
    .option("-b, --background", "Run tunnel in the background daemon mode", false)
    .action(async (target, cmdOptions) => {
      const globalOpts = program.opts();
      await interactiveDB({
        region: globalOpts.region,
        profile: globalOpts.profile,
        port: cmdOptions.port,
        open: cmdOptions.open,
        background: cmdOptions.background,
      });
    });

  program
    .command("tunnels")
    .description("List and manage active background tunnels")
    .argument("[action]", "Action to perform: list, stop <id>, stop-all", "list")
    .argument("[id]", "Tunnel ID or Local Port to stop")
    .action((action, id) => {
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

  program
    .command("doctor")
    .description("Run connectivity and environment diagnostics")
    .action(async () => {
      const globalOpts = program.opts();
      await runDoctor({ region: globalOpts.region, profile: globalOpts.profile });
    });

  // If invoked with no arguments, launch the interactive main menu
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
