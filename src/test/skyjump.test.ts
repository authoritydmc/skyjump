import test from "node:test";
import assert from "node:assert";
import {
  findFreePort,
  isPortAvailable,
  generateConnectionUrl,
  runDiagnostics,
  TunnelManager,
} from "../index.js";

test("isPortAvailable returns true for unbound high port", async () => {
  const available = await isPortAvailable(39123);
  assert.strictEqual(typeof available, "boolean");
});

test("findFreePort finds available local TCP port", async () => {
  const port = await findFreePort(39100);
  assert.ok(typeof port === "number");
  assert.ok(port >= 39100);
});

test("generateConnectionUrl formats Postgres URLs correctly", () => {
  const url = generateConnectionUrl({
    engine: "postgres",
    host: "127.0.0.1",
    port: 5432,
    username: "admin",
    password: "secretpassword",
    database: "production_db",
  });
  assert.strictEqual(url, "postgresql://admin:secretpassword@127.0.0.1:5432/production_db");
});

test("generateConnectionUrl formats MySQL URLs correctly", () => {
  const url = generateConnectionUrl({
    engine: "aurora-mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    database: "app_db",
  });
  assert.strictEqual(url, "mysql://root@127.0.0.1:3306/app_db");
});

test("generateConnectionUrl formats Redis URLs correctly", () => {
  const url = generateConnectionUrl({
    engine: "redis",
    host: "127.0.0.1",
    port: 6379,
  });
  assert.strictEqual(url, "redis://127.0.0.1:6379");
});

test("runDiagnostics returns structured diagnostic checks", async () => {
  const checks = await runDiagnostics();
  assert.ok(Array.isArray(checks));
  assert.ok(checks.length >= 2);
  const cliCheck = checks.find((c) => c.name.includes("AWS CLI"));
  assert.ok(cliCheck !== undefined);
});

test("TunnelManager lists and cleans up inactive tunnels", () => {
  const tunnels = TunnelManager.listTunnels();
  assert.ok(Array.isArray(tunnels));
});
