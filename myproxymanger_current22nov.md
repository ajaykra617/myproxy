This file is a merged representation of a subset of the codebase, containing files not matching ignore patterns, combined into a single document by Repomix.

<file_summary>
This section contains a summary of this file.

<purpose>
This file contains a packed representation of a subset of the repository's contents that is considered the most important context.
It is designed to be easily consumable by AI systems for analysis, code review,
or other automated processes.
</purpose>

<file_format>
The content is organized as follows:
1. This summary section
2. Repository information
3. Directory structure
4. Repository files (if enabled)
5. Multiple file entries, each consisting of:
  - File path as an attribute
  - Full contents of the file
</file_format>

<usage_guidelines>
- This file should be treated as read-only. Any changes should be made to the
  original repository files, not this packed version.
- When processing this file, use the file path to distinguish
  between different files in the repository.
- Be aware that this file may contain sensitive information. Handle it with
  the same level of security as you would the original repository.
</usage_guidelines>

<notes>
- Some files may have been excluded based on .gitignore rules and Repomix's configuration
- Binary files are not included in this packed representation. Please refer to the Repository Structure section for a complete list of file paths, including binary files
- Files matching these patterns are excluded: node_modules/**
- Files matching patterns in .gitignore are excluded
- Files matching default ignore patterns are excluded
- Files are sorted by Git change count (files with more changes are at the bottom)
</notes>

</file_summary>

<directory_structure>
sql/
  init.sql
  seed.sql
src/
  api/
    routes/
      health.js
      index.js
      proxies.js
  db/
    postgres.js
    redis.js
  tools/
    importProxies.js
  utils/
    config.js
    logger.js
  server.js
.env.example
.gitignore
docker-compose.yml
make_myproxy_zip.sh
NOTES.md
package.json
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="sql/seed.sql">
INSERT INTO proxies (ip, port, username, password, protocol, provider, region, type, score, healthy) VALUES
('p.webshare.io',80,'omgfwsyp-1','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-2','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-3','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-4','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-5','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-6','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-7','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-8','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-9','1iin2otw4dk9','http','webshare','global','internal',100,true),
('p.webshare.io',80,'omgfwsyp-10','1iin2otw4dk9','http','webshare','global','internal',100,true);
</file>

<file path="src/api/routes/health.js">
import { Router } from "express";
const router = Router();
router.get("/health",(req,res)=>res.send({status:"ok",uptime:process.uptime(),ts:new Date()}));
export default router;
</file>

<file path="src/api/routes/index.js">
import { Router } from "express";
import healthRouter from "./health.js";
import proxyRouter from "./proxies.js";
const router = Router();
router.use("/v1", proxyRouter);
router.use("/", healthRouter);
export default router;
</file>

<file path="src/api/routes/proxies.js">
import { Router } from "express";
import { pg } from "../../db/postgres.js";
const router = Router();
router.get("/proxies/random", async (req,res)=>{
  const { rows } = await pg.query("SELECT * FROM proxies WHERE healthy=true ORDER BY RANDOM() LIMIT 1");
  if(!rows.length) return res.status(404).send({error:"No proxies"});
  const p = rows[0];
  const proxy = p.username ? `${p.protocol}://${p.username}:${p.password}@${p.ip}:${p.port}` : `${p.protocol}://${p.ip}:${p.port}`;
  res.send({ proxy, id:p.id });
});
export default router;
</file>

<file path="src/db/postgres.js">
import pkg from "pg";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
const { Pool } = pkg;
export const pg = new Pool({ connectionString: config.postgresUrl });
pg.connect().then(()=>logger.info("Connected to Postgres")).catch(e=>logger.error("Postgres error:",e));
</file>

<file path="src/db/redis.js">
import Redis from "ioredis";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
export const redis = new Redis(config.redisUrl);
redis.on("connect",()=>logger.info("Connected to Redis"));
redis.on("error",(e)=>logger.error("Redis error:",e));
</file>

<file path="src/tools/importProxies.js">
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pg } from "../db/postgres.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proxyDir = path.join(__dirname, "../../proxy_lists");

function parseProxyLine(line) {
  line = line.trim();
  if (!line || line.startsWith("#")) return null;

  // Remove any leading protocol
  line = line.replace(/^(http|https|socks5|socks):\/\//i, "");

  let username, password, ip, port;

  // Case 1: user:pass@ip:port
  if (line.includes("@")) {
    const [auth, host] = line.split("@");
    [username, password] = auth.split(":");
    [ip, port] = host.split(":");
  }

  // Case 2: ip:port:user:pass
  else if (line.split(":").length >= 4) {
    [ip, port, username, password] = line.split(":");
  }

  // Case 3: ip:port
  else if (line.split(":").length === 2) {
    [ip, port] = line.split(":");
  }

  if (!ip || !port) return null;

  return {
    ip: ip.trim(),
    port: parseInt(port.trim(), 10),
    username: username?.trim() || null,
    password: password?.trim() || null
  };
}

async function importProxies() {
  const files = fs.readdirSync(proxyDir).filter(f => f.endsWith(".txt"));
  if (!files.length) {
    logger.warn("No .txt proxy lists found in proxy_lists/");
    return;
  }

  for (const file of files) {
        const providerParts = file.replace(".txt", "").split("_");

        // expected patterns:
        // provider[_country][_type][_protocol]
        const provider = providerParts[0];
        let country = null;
        let providerType = "generic";
        let protocol = "http";

        if (providerParts.length === 2) {
        // webshare_us.txt
        if (providerParts[1].length === 2) country = providerParts[1].toUpperCase();
        else providerType = providerParts[1];
        } else if (providerParts.length === 3) {
        // webshare_us_http OR ipdealer_mobile_socks
        if (providerParts[1].length === 2) {
            country = providerParts[1].toUpperCase();
            protocol = providerParts[2];
        } else {
            providerType = providerParts[1];
            protocol = providerParts[2];
        }
        } else if (providerParts.length >= 4) {
        // ipdealer_in_mobile_socks.txt
        country = providerParts[1].toUpperCase();
        providerType = providerParts[2];
        protocol = providerParts[3];
        }


    logger.info(`📥 Importing from: ${file} (provider=${provider}, type=${providerType}, protocol=${protocol})`);

    const content = fs.readFileSync(path.join(proxyDir, file), "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    let success = 0;

    for (const line of lines) {
      const proxy = parseProxyLine(line);
      if (!proxy) {
        logger.warn(`⚠️ Skipping invalid line: ${line}`);
        continue;
      }

      try {
        await pg.query(
        `INSERT INTO proxies (ip, port, username, password, protocol, provider, provider_type, country, healthy)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
        ON CONFLICT DO NOTHING`,
        [
            proxy.ip,
            proxy.port,
            proxy.username,
            proxy.password,
            protocol,
            provider,
            providerType,
            country
        ]
        );

        success++;
      } catch (err) {
        logger.error(`Error inserting ${line}: ${err.message}`);
      }
    }

    logger.info(`✅ Imported ${success}/${lines.length} proxies from ${file}`);
  }

  await pg.end();
  logger.info("🎯 All proxy lists imported successfully!");
}

importProxies().catch(err => logger.error(err));
</file>

<file path="src/utils/logger.js">
export const logger = {
  info: (...a)=>console.log("[INFO]",...a),
  error: (...a)=>console.error("[ERROR]",...a),
  warn: (...a)=>console.warn("[WARN]",...a)
};
</file>

<file path="src/server.js">
import express from "express";
import api from "./api/routes/index.js";
import { config } from "./utils/config.js";
import { logger } from "./utils/logger.js";
const app = express();
app.use(express.json());
app.use("/", api);
app.listen(config.port, () => logger.info(`Proxy Manager API running on port ${config.port}`));
</file>

<file path=".gitignore">
# Ignore proxy lists (they may contain credentials)
proxy_lists/*.txt

# Node.js dependencies
node_modules/

# Environment files
.env
.env.local
.env.development
.env.production

# Docker-related
postgres_data/
redis_data/
*.log

# OS/system files
.DS_Store
Thumbs.db

# Temporary files
*.tmp
*.bak
*.swp

# Build outputs (if we later add build step)
dist/
build/
</file>

<file path="docker-compose.yml">
version: "3.8"
services:
  app:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - .:/app
    command: sh -c "npm install && npm run start"
    ports:
      - "3000:3000"
    env_file: .env
    depends_on:
      - db
      - redis
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: myproxy
    volumes:
      - ./sql/init.sql:/docker-entrypoint-initdb.d/1-init.sql
      - ./sql/seed.sql:/docker-entrypoint-initdb.d/2-seed.sql
    ports:
      - "5432:5432"
  redis:
    image: redis:7
    ports:
      - "6379:6379"
</file>

<file path="NOTES.md">
# 🗒️ Project Notes — MyProxy

**Purpose:**  
A scalable Proxy Manager service designed for internal use and customer distribution.  
Built with **Node.js + Express**, **PostgreSQL**, and **Redis**, running under **Docker** inside **WSL2**.

---

## ⚙️ Current Stack Overview

| Component | Description |
|------------|-------------|
| **Node.js (App)** | REST API handling proxy allocation, release, and health endpoints |
| **PostgreSQL** | Stores proxy data, usage logs, and health stats |
| **Redis** | Used for caching, sessions, and job queues (future use) |
| **Docker Compose** | Manages all services and container networking |
| **WSL2 (Ubuntu)** | Linux environment for development on Windows |
| **GitHub Repo** | Version control and CI/CD integration |

---

## 🚀 How to Run

```bash
docker compose up --build
Check if the API is live:

bash
Copy code
curl http://localhost:3000/health
Expected output:

json
Copy code
{"status":"ok","uptime":12.34,"ts":"2025-11-03T10:36:04.216Z"}
🧩 Current Routes
Endpoint	Method	Description
/health	GET	Check server uptime and API availability
/v1/proxies/random	GET	Return one random healthy proxy from the database

🐘 Database (PostgreSQL)
Database Name: myproxy

Tables:

proxies → stores proxy IPs, credentials, type (http/socks5), provider, etc.

proxy_usage → records usage, success/fail, latency, timestamps

Initialized automatically via:

sql/init.sql (schema creation)

sql/seed.sql (initial data)

Access DB manually:

bash
Copy code
docker exec -it myproxy-db-1 psql -U postgres myproxy
⚡ Redis (Cache / Queue)
Used for:

Caching proxy data for fast access

Tracking usage or sticky sessions

Background task queues (planned for health checks)

🧠 Development Commands
Task	Command
Start all services	docker compose up --build
View live logs	docker compose logs -f app
Stop containers	docker compose down
Restart Node.js only	docker compose restart app
Check running containers	docker ps
Open Postgres shell	docker exec -it myproxy-db-1 psql -U postgres myproxy

🧰 Folder Structure
bash
Copy code
myproxy/
 ├─ src/
 │   ├─ api/              # Express routes (proxies, health)
 │   ├─ db/               # Database connection files
 │   ├─ utils/            # Configs, logger, helper functions
 │   └─ server.js         # App entry point
 ├─ sql/                  # init.sql & seed.sql (DB setup)
 ├─ docker-compose.yml    # Multi-service setup
 ├─ package.json          # Node.js metadata & dependencies
 ├─ .env.example          # Example environment config
 └─ NOTES.md              # This file
🧭 Docker Service Overview
Service	Image	Role
app	node:20-alpine	Runs the Proxy Manager API
db	postgres:16	Stores proxy and usage data
redis	redis:7	Caching and future job processing

📦 Version Control Notes
bash
Copy code
git add .
git commit -m "update notes and docs"
git push
🧩 Todo / Roadmap
 Add nodemon for hot-reload during development

 Add /v1/proxies/release endpoint (report success/failure)

 Implement proxy rotation strategy (round-robin / least-used / sticky)

 Build health-check worker (periodic proxy status validation)

 Add proxy scoring system based on success rate

 Create admin dashboard for internal management

 Add monitoring & metrics endpoint (/v1/metrics)

 Integrate API key system for customers

 Implement rate limiting & usage tracking via Redis

 Set up GitHub Actions for CI/CD

🧠 Knowledge Notes
WSL2 runs a full Linux kernel → Docker Desktop uses this for containers.

Docker Compose links all services internally via DNS (db, redis, app).

Postgres auto-initializes schema and seeds via mounted .sql files.

Node.js connects to Postgres & Redis using internal hostnames.

API is exposed on localhost:3000 on your Windows host.

🧩 Tip: Keep updating this file as the project evolves — treat it like your internal documentation.
Add commands, fixes, or architecture changes as you go.

Author: Ajay Malik
Project: MyProxy
Created: November 2025
</file>

<file path="package.json">
{
  "name": "myproxy",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js"
  },
  "dependencies": {
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "ioredis": "^5.3.2",
    "pg": "^8.11.1"
  }
}
</file>

<file path="sql/init.sql">
CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password TEXT,
  protocol TEXT DEFAULT 'http',
  provider TEXT,
  region TEXT DEFAULT 'global',
  type TEXT DEFAULT 'internal',
  owner_id TEXT,
  score INT DEFAULT 100,
  healthy BOOLEAN DEFAULT true,
  last_checked TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS proxy_usage (
  id SERIAL PRIMARY KEY,
  proxy_id INT REFERENCES proxies(id),
  project TEXT,
  status TEXT,
  latency_ms INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Added November 2025
ALTER TABLE proxies
ADD COLUMN IF NOT EXISTS provider_type TEXT DEFAULT 'generic',
ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'http';

ALTER TABLE proxies
ADD COLUMN IF NOT EXISTS country TEXT;
</file>

</files>
