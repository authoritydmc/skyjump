# skyjump 🚀

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

> **Zero-friction AWS EC2/SSM shell sessions and automatic RDS/Redis port forwarding across private VPCs.**

Connect to private AWS RDS databases, Redis clusters, and EC2 instances through AWS Systems Manager (SSM) Session Manager without opening SSH port 22 or managing static bastion keys.

---

## ✨ Key Features

- 🔌 **Automatic RDS & ElastiCache Tunneling**: Auto-discovers private RDS and ElastiCache endpoints and forwards local ports via AWS SSM.
- ⚡ **Zero Open Port 22 / Bastion Hygiene**: Works entirely over AWS SSM Session Manager (`AWS-StartPortForwardingSessionToRemoteHost`).
- 🔄 **Smart Port Collision Handling**: Detects if your local port (e.g. 5432) is occupied by Docker and automatically allocates the next available port.
- 🛠️ **1-Click DB Client Launch**: Automatically opens TablePlus (`tableplus://`), DBeaver, `psql`, `pgcli`, `mysql`, `mycli`, or `redis-cli`.
- 📊 **Background Tunnel Manager**: Start, list, and kill background tunnels with no zombie processes left behind.
- 🩺 **Built-in Connectivity Doctor**: Diagnoses AWS CLI, Session Manager plugin, and IAM credentials.
- 🎯 **Interactive TUI**: Beautiful fuzzy selector for EC2 instances, RDS databases, and tunnels when run without arguments.

---

## 🚀 Installation

```bash
npm install -g skyjump
# or shorthand alias
npm install -g sj
```

### Prerequisites
- [AWS CLI v2](https://aws.amazon.com/cli/)
- [AWS Session Manager Plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html)

---

## 🛠️ CLI Usage

### 1. Interactive Mode
Run without arguments to open the interactive selection menu:
```bash
skyjump
```

### 2. Connect to EC2 Instance Shell
```bash
# Interactive selection
skyjump ec2

# Direct connection by instance ID or tag
skyjump ec2 i-0123456789abcdef0
```

### 3. Forward Port to Private RDS Database
```bash
# Interactive DB selection & tunnel
skyjump db

# Quick tunnel with automatic client launch
skyjump db --open tableplus
skyjump db --open psql
skyjump db --open dbeaver

# Run tunnel in background
skyjump db --background
```

### 4. Manage Background Tunnels
```bash
# List all active tunnels
skyjump tunnels list

# Stop a tunnel by local port or ID
skyjump tunnels stop 5433

# Stop all running tunnels
skyjump tunnels stop-all
```

### 5. Environment & Connectivity Diagnostics
```bash
skyjump doctor
```

---

## 📖 Programmatic API (TypeScript & JavaScript)

```typescript
import { 
  listEC2Instances, 
  listRDSDatabases, 
  TunnelManager, 
  findFreePort 
} from "skyjump";

// List running EC2 instances
const instances = await listEC2Instances({ region: "us-east-1" });

// Start a background port forward session
const { session } = await TunnelManager.startTunnel({
  bastionInstanceId: "i-0abcd1234ef567890",
  remoteHost: "prod-db.c123456789.us-east-1.rds.amazonaws.com",
  remotePort: 5432,
  localPort: 5433,
  targetName: "production-postgres",
  targetType: "rds",
  background: true,
});

console.log(`Tunnel active on 127.0.0.1:${session.localPort}`);
```

---

## 📄 License

[MIT](LICENSE) © 2026
