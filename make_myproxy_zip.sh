mkdir -p src/api/routes src/api/middlewares src/core src/db src/utils sql docs
# --- create example files ---
cat > src/server.js <<'EON'
import express from "express";
import api from "./api/routes/index.js";
import { config } from "./utils/config.js";
import { logger } from "./utils/logger.js";
const app = express();
app.use(express.json());
app.use("/", api);
app.listen(config.port, () => logger.info(`Proxy Manager API running on port ${config.port}`));
EON

cat > src/utils/config.js <<'EON'
import dotenv from "dotenv";
dotenv.config();
export const config = {
  port: process.env.PORT || 3000,
  redisUrl: process.env.REDIS_URL || "redis://redis:6379",
  postgresUrl: process.env.POSTGRES_URL || "postgres://postgres:postgres@db:5432/myproxy"
};
EON

cat > src/utils/logger.js <<'EON'
export const logger = {
  info: (...a)=>console.log("[INFO]",...a),
  error: (...a)=>console.error("[ERROR]",...a),
  warn: (...a)=>console.warn("[WARN]",...a)
};
EON

cat > src/db/redis.js <<'EON'
import Redis from "ioredis";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
export const redis = new Redis(config.redisUrl);
redis.on("connect",()=>logger.info("Connected to Redis"));
redis.on("error",(e)=>logger.error("Redis error:",e));
EON

cat > src/db/postgres.js <<'EON'
import pkg from "pg";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";
const { Pool } = pkg;
export const pg = new Pool({ connectionString: config.postgresUrl });
pg.connect().then(()=>logger.info("Connected to Postgres")).catch(e=>logger.error("Postgres error:",e));
EON

cat > src/api/routes/health.js <<'EON'
import { Router } from "express";
const router = Router();
router.get("/health",(req,res)=>res.send({status:"ok",uptime:process.uptime(),ts:new Date()}));
export default router;
EON

cat > src/api/routes/proxies.js <<'EON'
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
EON

cat > src/api/routes/index.js <<'EON'
import { Router } from "express";
import healthRouter from "./health.js";
import proxyRouter from "./proxies.js";
const router = Router();
router.use("/v1", proxyRouter);
router.use("/", healthRouter);
export default router;
EON

cat > sql/init.sql <<'EON'
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
EON

cat > sql/seed.sql <<'EON'
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
EON

cat > docker-compose.yml <<'EON'
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
EON

cat > .env.example <<'EON'
PORT=3000
REDIS_URL=redis://redis:6379
POSTGRES_URL=postgres://postgres:postgres@db:5432/myproxy
EON

cat > package.json <<'EON'
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
EON

zip -r ../myproxy.zip .
echo "✅ Created ~/myproxy.zip"
