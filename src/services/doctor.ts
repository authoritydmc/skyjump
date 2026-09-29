import { execSync } from "child_process";

export interface DiagnosticCheck {
  name: string;
  passed: boolean;
  message: string;
  details?: string;
}

/**
 * Run comprehensive developer environment and AWS connectivity diagnostics.
 */
export async function runDiagnostics(options: { region?: string; profile?: string } = {}): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];

  // Check 1: AWS CLI Binary
  try {
    const version = execSync("aws --version", { encoding: "utf-8" }).trim();
    checks.push({
      name: "AWS CLI Installation",
      passed: true,
      message: "AWS CLI is installed",
      details: version,
    });
  } catch {
    checks.push({
      name: "AWS CLI Installation",
      passed: false,
      message: "AWS CLI not found in PATH",
      details: "Please install AWS CLI v2: https://aws.amazon.com/cli/",
    });
  }

  // Check 2: Session Manager Plugin
  try {
    const ssmPlugin = execSync("session-manager-plugin", { encoding: "utf-8" }).trim();
    checks.push({
      name: "SSM Session Manager Plugin",
      passed: true,
      message: "Session Manager Plugin is installed",
      details: ssmPlugin,
    });
  } catch (e: any) {
    const output = (e.stdout || e.stderr || "").toString();
    if (output.includes("SessionManagerPlugin") || output.includes("Usage")) {
      checks.push({
        name: "SSM Session Manager Plugin",
        passed: true,
        message: "Session Manager Plugin is installed",
      });
    } else {
      checks.push({
        name: "SSM Session Manager Plugin",
        passed: false,
        message: "session-manager-plugin not found",
        details: "Install plugin for port-forwarding: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html",
      });
    }
  }

  // Check 3: AWS Credentials & Caller Identity
  try {
    const profArg = options.profile ? `--profile ${options.profile}` : "";
    const regArg = options.region ? `--region ${options.region}` : "";
    const identityRaw = execSync(`aws sts get-caller-identity ${profArg} ${regArg}`, { encoding: "utf-8" });
    const identity = JSON.parse(identityRaw);

    checks.push({
      name: "AWS Authentication & IAM",
      passed: true,
      message: `Authenticated as: ${identity.Arn || identity.UserId}`,
      details: `Account: ${identity.Account}`,
    });
  } catch (err: any) {
    checks.push({
      name: "AWS Authentication & IAM",
      passed: false,
      message: "Failed to authenticate with AWS credentials",
      details: "Run 'aws sso login' or configure your credentials via 'aws configure'.",
    });
  }

  return checks;
}
