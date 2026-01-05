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
proxy_lists/
  dataimpulse.txt:Zone.Identifier
sql/
  init_v2.sql
  init.sql
  seed.sql
src/
  ai/
    groqBrain.js
    prompts.js
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
    trainingLogger.js
  server.js
.env.example
.gitignore
docker-compose.yml
NOTES.md
package.json
</directory_structure>

<files>
This section contains the contents of the repository's files.

<file path="sql/init_v2.sql">
-- sql/init_v2.sql
-- Clean, enterprise-ready schema for AI-powered proxy manager

DROP TABLE IF EXISTS proxy_usage_logs CASCADE;
DROP TABLE IF EXISTS provider_performance CASCADE;
DROP TABLE IF EXISTS routing_rules CASCADE;
DROP TABLE IF EXISTS proxies CASCADE;

CREATE TABLE proxies (
  id SERIAL PRIMARY KEY,
  proxy_string TEXT NOT NULL,           -- e.g., http://user:pass@ip:port
  ip TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password TEXT,
  protocol TEXT DEFAULT 'http',
  provider TEXT NOT NULL,               -- oxylabs, brightdata, webshare, etc.
  proxy_type TEXT NOT NULL,             -- datacenter, residential, mobile, isp, rotating, static
  country TEXT,
  city TEXT,
  asn TEXT,
  score DECIMAL DEFAULT 100.0,
  healthy BOOLEAN DEFAULT true,
  consecutive_fails INT DEFAULT 0,
  success_count INT DEFAULT 0,
  fail_count INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,
  last_used TIMESTAMP,
  last_success TIMESTAMP,
  last_fail TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(ip, port, provider)
);

CREATE TABLE proxy_usage_logs (
  id SERIAL PRIMARY KEY,
  proxy_id INT REFERENCES proxies(id) ON DELETE SET NULL,
  target_domain TEXT NOT NULL,
  target_url TEXT,
  script_id TEXT,
  geo_required TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'blocked', 'timeout', 'captcha', 'slow', 'error')),
  latency_ms INT,
  http_status INT,
  notes TEXT,
  training_json JSONB,                  -- Full training-ready example
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE provider_performance (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  proxy_type TEXT NOT NULL,
  target_domain TEXT,
  success_rate DECIMAL DEFAULT 1.0,
  avg_latency_ms INT,
  block_rate DECIMAL DEFAULT 0.0,
  total_requests INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, proxy_type, target_domain)
);

CREATE TABLE routing_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_pattern TEXT,                  -- e.g., "%.amazon.com"
  script_id TEXT,
  geo_required TEXT,
  preferred_provider TEXT,
  preferred_type TEXT,
  forbidden_provider TEXT,
  forbidden_type TEXT,
  priority INT DEFAULT 1,
  active BOOLEAN DEFAULT true,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for speed
CREATE INDEX idx_proxies_healthy_score ON proxies(healthy, score DESC);
CREATE INDEX idx_logs_target ON proxy_usage_logs(target_domain, created_at DESC);
CREATE INDEX idx_performance_provider ON provider_performance(provider, proxy_type);
CREATE INDEX idx_rules_target ON routing_rules(target_pattern);
</file>

<file path="src/ai/groqBrain.js">
import OpenAI from "openai";
import { config } from "../utils/config.js";
import { pg } from "../db/postgres.js";
import { redis } from "../db/redis.js";
import { PROXY_ROUTING_PROMPT } from "./prompts.js";

const groq = new OpenAI({
  apiKey: config.groqApiKey,
  baseURL: "https://api.groq.com/openai/v1"
});

async function getStatsSummary() {
  const { rows } = await pg.query(`
    SELECT provider, proxy_type, 
           success_rate, avg_latency_ms, block_rate
    FROM provider_performance 
    WHERE total_requests > 10
    ORDER BY success_rate DESC
    LIMIT 20
  `);
  if (rows.length === 0) return "No performance data yet — prefer residential providers.";
  return rows.map(r => 
    `- ${r.provider} ${r.proxy_type}: ${ (r.success_rate*100).toFixed(1) }% success, ${r.avg_latency_ms}ms avg, ${ (r.block_rate*100).toFixed(1) }% blocks`
  ).join("\n");
}

async function getActiveRules(targetDomain) {
  const { rows } = await pg.query(`
    SELECT preferred_provider, preferred_type, reason
    FROM routing_rules 
    WHERE active = true 
      AND $1 ILIKE target_pattern
    ORDER BY priority DESC
  `, [targetDomain]);
  return rows.length > 0 ? rows.map(r => `${r.preferred_provider || 'any'} ${r.preferred_type || ''} (${r.reason || 'manual'})`).join(", ") : "None";
}

export async function getBestProxyRecommendation({ targetUrl, geo, script }) {
  const domain = new URL(targetUrl).hostname;

  // Cache key
  const cacheKey = `proxy:decision:${domain}:${geo || 'any'}:${script || 'default'}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const stats = await getStatsSummary();
  const rules = await getActiveRules(`%${domain}%`);

  const prompt = PROXY_ROUTING_PROMPT
    .replace("{{STATS_SUMMARY}}", stats)
    .replace("{{TARGET_DOMAIN}}", domain)
    .replace("{{TARGET_URL}}", targetUrl)
    .replace("{{GEO}}", geo || "any")
    .replace("{{SCRIPT}}", script || "unknown")
    .replace("{{RULES}}", rules);

  try {
    const response = await groq.chat.completions.create({
      model: "llama3-8b-8192", // Fast & cheap
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const decision = JSON.parse(response.choices[0].message.content);

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(decision), "EX", 300);

    return decision;
  } catch (err) {
    // Fallback: simple score-based
    return { recommended_provider: null, recommended_type: "residential", reason: "Groq error — fallback to residential" };
  }
}
</file>

<file path="src/ai/prompts.js">
export const PROXY_ROUTING_PROMPT = `
You are an elite proxy routing AI for large-scale web scraping.

Guidelines:
- Prioritize success rate > latency > cost
- Use residential/mobile/ISP for anti-bot sites (e-commerce, social, search engines)
- Use datacenter only for easy targets
- Respect manual rules if any
- Avoid providers with high block_rate or recent fails

Current performance summary:
{{STATS_SUMMARY}}

Target domain: {{TARGET_DOMAIN}}
Full URL: {{TARGET_URL}}
Required geo: {{GEO}}
Script: {{SCRIPT}}

Manual rules active: {{RULES}}

Return ONLY valid JSON:
{
  "recommended_provider": "string",
  "recommended_type": "residential|datacenter|mobile|isp|rotating|static",
  "reason": "short explanation"
}
`.trim();
</file>

<file path="src/utils/trainingLogger.js">
// src/utils/trainingLogger.js
import { pg } from "../db/postgres.js";
import { logger } from "./logger.js";

export async function logTrainingExample(example) {
  try {
    // Insert into usage logs with training_json
    await pg.query(`
      INSERT INTO proxy_usage_logs (
        proxy_id, target_domain, target_url, script_id, geo_required,
        status, latency_ms, http_status, notes, training_json, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()
      )
    `, [
      example.proxy_id || null,
      example.target_domain,
      example.target_url || null,
      example.script_id || null,
      example.geo_required || null,
      example.status,
      example.latency_ms || null,
      example.http_status || null,
      example.notes || null,
      example.training_json
    ]);

    logger.info(`[TRAINING] Logged example: ${example.status} on ${example.target_domain}`);
  } catch (err) {
    logger.error("Failed to log training example:", err);
  }
}
</file>

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
router.use("/", healthRouter);     // → /health
router.use("/v1", proxyRouter);    // → /v1/proxy, /v1/proxies/random, /v1/proxy/report
export default router;
</file>

<file path="src/api/routes/proxies.js">
// src/api/routes/proxies.js
import { Router } from "express";
import { pg } from "../../db/postgres.js";
import { redis } from "../../db/redis.js";
import { getBestProxyRecommendation } from "../../ai/groqBrain.js";
import { logTrainingExample } from "../../utils/trainingLogger.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// Add this line near the top with other routes
router.get("/proxies/random", async (req, res) => {  // ← Fixed path
  const { rows } = await pg.query(`
    SELECT * FROM proxies 
    WHERE healthy = true 
    ORDER BY RANDOM() 
    LIMIT 1
  `);
  if (!rows.length) return res.status(404).json({ error: "No healthy proxies" });

  const p = rows[0];
  res.json({
    proxy: p.proxy_string,
    id: p.id,
    provider: p.provider,
    type: p.proxy_type
  });
});
// NEW MAIN ENDPOINT — AI-POWERED
router.get("/proxy", async (req, res) => {
  const { target, geo, script } = req.query;

  if (!target) {
    return res.status(400).json({ error: "Missing required param: target (URL)" });
  }

  try {
    // Get AI recommendation
    const recommendation = await getBestProxyRecommendation({
      targetUrl: target,
      geo: geo || null,
      script: script || null
    });

    // Build DB query
    let query = "SELECT * FROM proxies WHERE healthy = true";
    const values = [];

    if (recommendation.recommended_provider) {
      query += ` AND provider = $${values.length + 1}`;
      values.push(recommendation.recommended_provider);
    }

    if (recommendation.recommended_type) {
      query += ` AND proxy_type = $${values.length + 1}`;
      values.push(recommendation.recommended_type);
    }

    if (geo) {
      query += ` AND (country = $${values.length + 1} OR country IS NULL)`;
      values.push(geo.toUpperCase());
    }

    query += " ORDER BY score DESC, RANDOM() LIMIT 1";

    const { rows } = await pg.query(query, values);
    if (!rows.length) {
      return res.status(404).json({ error: "No matching proxy found", fallback: true });
    }

    const proxy = rows[0];

    // Update last_used
    await pg.query("UPDATE proxies SET last_used = NOW() WHERE id = $1", [proxy.id]);

    res.json({
      proxy: proxy.proxy_string,
      id: proxy.id,
      provider: proxy.provider,
      type: proxy.proxy_type,
      country: proxy.country,
      recommendation: recommendation
    });
  } catch (err) {
    logger.error("Proxy selection error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// REPORT ENDPOINT — This feeds the learning!
router.post("/proxy/report", async (req, res) => {
  const {
    proxy_id,
    status,           // success, blocked, timeout, captcha, slow
    latency_ms,
    http_status,
    notes
  } = req.body;

  if (!proxy_id || !status) {
    return res.status(400).json({ error: "Missing proxy_id or status" });
  }

  try {
    const { rows } = await pg.query("SELECT * FROM proxies WHERE id = $1", [proxy_id]);
    if (!rows.length) return res.status(404).json({ error: "Proxy not found" });

    const proxy = rows[0];

    // Build training example
    const trainingExample = {
      timestamp: new Date().toISOString(),
      event_type: "proxy_outcome",
      input: {
        target_domain: req.body.target_domain || "unknown",
        geo_required: proxy.country || "any",
        provider: proxy.provider,
        proxy_type: proxy.proxy_type,
        recommendation_reason: req.body.recommendation_reason || "unknown"
      },
      decision: {
        provider: proxy.provider,
        type: proxy.proxy_type
      },
      outcome: {
        status,
        latency_ms,
        http_status,
        blocked: status === "blocked" || status === "captcha"
      },
      proxy_id: proxy.id
    };

    // Log to DB
    await logTrainingExample({
      proxy_id,
      target_domain: req.body.target_domain || "unknown",
      status,
      latency_ms,
      http_status,
      notes,
      training_json: trainingExample
    });

    // Update proxy stats
    const isSuccess = status === "success";
    const newScore = isSuccess ? Math.min(100, proxy.score + 2) : Math.max(0, proxy.score - 10);
    const newFails = isSuccess ? 0 : proxy.consecutive_fails + 1;
    const healthy = newFails < 5;

    await pg.query(`
      UPDATE proxies SET
        score = $1,
        healthy = $2,
        consecutive_fails = $3,
        success_count = success_count + $4,
        fail_count = fail_count + $5,
        avg_latency_ms = LEAST(COALESCE((avg_latency_ms * (success_count + fail_count) + $6) / (success_count + fail_count + 1), $6), 10000),
        last_success = CASE WHEN $4 = 1 THEN NOW() ELSE last_success END,
        last_fail = CASE WHEN $5 = 1 THEN NOW() ELSE last_fail END
      WHERE id = $7
    `, [
      newScore, healthy, newFails,
      isSuccess ? 1 : 0,
      isSuccess ? 0 : 1,
      latency_ms || 0,
      proxy_id
    ]);

    // Invalidate cache
    await redis.del(`proxy:decision:*`);

    res.json({ success: true, message: "Report recorded — AI brain learning..." });
  } catch (err) {
    logger.error("Report error:", err);
    res.status(500).json({ error: "Failed to record report" });
  }
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
// src/db/redis.js
import Redis from "ioredis";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

export const redis = new Redis(config.redisUrl);

redis.on("connect", () => logger.info("Connected to Redis"));
redis.on("error", (e) => logger.error("Redis error:", e));
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
    "@redis/client": "^5.10.0",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "ioredis": "^5.3.2",
    "openai": "^6.10.0",
    "pg": "^8.11.1"
  }
}
</file>

<file path="src/tools/importProxies.js">
// src/tools/importProxies.js
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

  line = line.replace(/^(http|https|socks5|socks):\/\//i, "");

  let username, password, ip, port;

  if (line.includes("@")) {
    const [auth, host] = line.split("@");
    [username, password] = auth.split(":");
    [ip, port] = host.split(":");
  } else if (line.split(":").length >= 4) {
    [ip, port, username, password] = line.split(":");
  } else if (line.split(":").length === 2) {
    [ip, port] = line.split(":");
  }

  if (!ip || !port) return null;

  return { ip: ip.trim(), port: parseInt(port.trim(), 10), username: username?.trim(), password: password?.trim() };
}

async function importProxies() {
  const files = fs.readdirSync(proxyDir).filter(f => f.endsWith(".txt"));
  if (!files.length) {
    logger.warn("No proxy lists found in proxy_lists/");
    return;
  }

  for (const file of files) {
    let provider = "unknown";
    let proxy_type = "datacenter";  // default
    let country = null;
    let protocol = "http";

    const name = file.replace(".txt", "");
    const parts = name.split("_");

    provider = parts[0];

    if (parts.length >= 2) {
      if (parts[1].length === 2) country = parts[1].toUpperCase();
      else proxy_type = parts[1];
    }
    if (parts.length >= 3) {
      if (parts[2].length === 2 && country === null) country = parts[2].toUpperCase();
      else if (parts[2] !== country) protocol = parts[2];
    }
    if (parts.length >= 4) {
      proxy_type = parts[2];
      protocol = parts[3];
    }

    logger.info(`Importing ${file} → provider=${provider}, type=${proxy_type}, country=${country || 'global'}, protocol=${protocol}`);

    const content = fs.readFileSync(path.join(proxyDir, file), "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);

    let inserted = 0;
    for (const line of lines) {
      const p = parseProxyLine(line);
      if (!p) continue;

      const proxy_string = p.username 
        ? `${protocol}://${p.username}:${p.password}@${p.ip}:${p.port}`
        : `${protocol}://${p.ip}:${p.port}`;

      try {
        await pg.query(`
          INSERT INTO proxies (
            proxy_string, ip, port, username, password, protocol,
            provider, proxy_type, country, score, healthy
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, true)
          ON CONFLICT (ip, port, provider) DO NOTHING
        `, [
          proxy_string, p.ip, p.port, p.username, p.password, protocol,
          provider, proxy_type, country
        ]);
        inserted++;
      } catch (err) {
        logger.warn(`Failed to insert ${line}: ${err.message}`);
      }
    }
    logger.info(`Inserted ${inserted}/${lines.length} from ${file}`);
  }

  logger.info("All proxy imports complete!");
  await pg.end();
}

importProxies().catch(err => logger.error("Import failed:", err));
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
      - "3100:3000"   # Expose API on VM port 3100
    env_file: .env
    depends_on:
      - db
      - redis

  db:
    ports:
      - 5433:5432
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: myproxy
    # docker-compose.yml (only change this part)
    volumes:
      - ./sql/init_v2.sql:/docker-entrypoint-initdb.d/1-schema.sql
      # Remove old seed for now — we'll import manually later
      # No host port exposure to avoid conflicts

  redis:
    image: redis:7
    # No host port exposure to avoid conflicts
</file>

</files>
