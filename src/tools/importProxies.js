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