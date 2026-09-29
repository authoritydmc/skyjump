import { spawn } from "child_process";
import { DBConnectionParams, DBClientType } from "../types.js";

/**
 * Generate standard connection URL from connection parameters.
 */
export function generateConnectionUrl(params: DBConnectionParams): string {
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

/**
 * Launch external Database Client UI or CLI tool.
 */
export function launchDBClient(
  client: DBClientType,
  params: DBConnectionParams
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = generateConnectionUrl(params);

    if (client === "tableplus") {
      // TablePlus uses tableplus:// URL scheme
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
        stdio: "inherit",
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }

    if (client === "mysql" || client === "mycli") {
      const child = spawn(client, ["-h", params.host, "-P", String(params.port), "-u", params.username || "root", ...(params.database ? [params.database] : [])], {
        stdio: "inherit",
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }

    if (client === "redis-cli") {
      const child = spawn("redis-cli", ["-h", params.host, "-p", String(params.port)], {
        stdio: "inherit",
      });
      child.on("exit", () => resolve());
      child.on("error", reject);
      return;
    }

    reject(new Error(`Unknown DB client: ${client}`));
  });
}
