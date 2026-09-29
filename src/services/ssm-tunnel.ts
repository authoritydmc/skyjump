import { spawn, ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { TunnelSession } from "../types.js";

const CONFIG_DIR = path.join(os.homedir(), ".skyjump");
const STATE_FILE = path.join(CONFIG_DIR, "tunnels.json");

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Start an interactive SSM Shell session to an EC2 instance.
 */
export function startSSMShell(instanceId: string, options: { region?: string; profile?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["ssm", "start-session", "--target", instanceId];

    if (options.region) {
      args.push("--region", options.region);
    }
    if (options.profile) {
      args.push("--profile", options.profile);
    }

    const child = spawn("aws", args, {
      stdio: "inherit",
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

/**
 * Tunnel Manager handles persistent local background and foreground tunnels.
 */
export class TunnelManager {
  private static loadState(): TunnelSession[] {
    ensureConfigDir();
    if (!fs.existsSync(STATE_FILE)) return [];
    try {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      const sessions: TunnelSession[] = JSON.parse(data);

      // Filter out stale PIDs
      return sessions.filter((s) => {
        if (!s.pid) return false;
        try {
          process.kill(s.pid, 0); // Check if process is alive
          return true;
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  private static saveState(sessions: TunnelSession[]): void {
    ensureConfigDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(sessions, null, 2), "utf-8");
  }

  /**
   * List all active background tunnels.
   */
  public static listTunnels(): TunnelSession[] {
    const liveSessions = this.loadState();
    this.saveState(liveSessions);
    return liveSessions;
  }

  /**
   * Start a remote port forwarding session via AWS SSM.
   */
  public static async startTunnel(params: {
    bastionInstanceId: string;
    remoteHost: string;
    remotePort: number;
    localPort: number;
    targetName: string;
    targetType: "rds" | "redis" | "ec2" | "custom";
    region?: string;
    profile?: string;
    background?: boolean;
  }): Promise<{ session: TunnelSession; child: ChildProcess }> {
    const { bastionInstanceId, remoteHost, remotePort, localPort, targetName, targetType, region, profile, background } = params;

    const sessionParams = JSON.stringify({
      host: [remoteHost],
      portNumber: [String(remotePort)],
      localPortNumber: [String(localPort)],
    });

    const args = [
      "ssm",
      "start-session",
      "--target",
      bastionInstanceId,
      "--document-name",
      "AWS-StartPortForwardingSessionToRemoteHost",
      "--parameters",
      sessionParams,
    ];

    if (region) args.push("--region", region);
    if (profile) args.push("--profile", profile);

    const child = spawn("aws", args, {
      stdio: background ? "ignore" : ["inherit", "pipe", "pipe"],
      detached: Boolean(background),
    });

    if (background) {
      child.unref();
    }

    const sessionId = `tun-${Date.now()}-${localPort}`;
    const session: TunnelSession = {
      id: sessionId,
      targetType,
      targetName,
      remoteHost,
      remotePort,
      localPort,
      bastionInstanceId,
      pid: child.pid,
      startTime: new Date().toISOString(),
      status: "running",
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
  public static stopTunnel(identifier: string): boolean {
    const active = this.loadState();
    const target = active.find((s) => s.id === identifier || String(s.localPort) === identifier || s.targetName === identifier);

    if (target && target.pid) {
      try {
        process.kill(target.pid, "SIGTERM");
      } catch {}
      const remaining = active.filter((s) => s.id !== target.id);
      this.saveState(remaining);
      return true;
    }

    return false;
  }

  /**
   * Stop all active background tunnels.
   */
  public static stopAll(): number {
    const active = this.loadState();
    let count = 0;

    for (const session of active) {
      if (session.pid) {
        try {
          process.kill(session.pid, "SIGTERM");
          count++;
        } catch {}
      }
    }

    this.saveState([]);
    return count;
  }
}
