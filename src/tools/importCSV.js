// src/tools/importCSV.js
// CSV-based importer for gateway-style proxy configurations.
//
// CSV format (proxy_lists/*.csv):
//
//   proxy_url,provider,type,country,protocol,session_type,ttl
//   ...@gw.dataimpulse.com:823,dataimpulse,datacenter,US,https,rotating
//   ...@gw.dataimpulse.com:10000,dataimpulse,datacenter,US,http,sticky,60
//
//   session_type is optional — defaults to "rotating" when omitted.
//   ttl (column 7, optional) — default sticky session minutes stored as metadata.sessttl.
//     Only meaningful for sticky rows. Ignored for rotating rows.
//
// proxy_url formats accepted:
//   user:pass@host:port              ← DataImpulse / most gateway providers
//   http://user:pass@host:port       ← standard URL form
//   host:port:user:pass              ← legacy colon-separated
//
// Run:
//   node src/tools/importCSV.js [file.csv]
//   (no argument = imports all *.csv files from proxy_lists/)

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pg }     from "../db/postgres.js";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proxyDir  = path.join(__dirname, "../../proxy_lists");

// ── CSV line parser (handles quoted fields) ───────────────────────────────────
function parseCSVLine(line) {
  const fields = [];
  let current  = "";
  let inQuotes = false;

  for (const ch of line) {
    if (ch === '"')      { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { fields.push(current.trim()); current = ""; }
    else                { current += ch; }
  }
  fields.push(current.trim());
  return fields;
}

// ── Proxy URL parser ──────────────────────────────────────────────────────────
// Handles all three formats without requiring a protocol prefix.
function parseProxyUrl(raw) {
  raw = raw.trim();
  if (!raw || raw.startsWith("#")) return null;

  // Strip protocol prefix for uniform parsing
  const clean = raw.replace(/^(https?|socks[45]):\/\//i, "");

  let username, password, ip, port;

  if (clean.includes("@")) {
    // user:pass@host:port
    const atIdx = clean.lastIndexOf("@");
    const auth  = clean.slice(0, atIdx);
    const host  = clean.slice(atIdx + 1);
    const colonInAuth = auth.indexOf(":");
    username = colonInAuth !== -1 ? auth.slice(0, colonInAuth) : auth;
    password = colonInAuth !== -1 ? auth.slice(colonInAuth + 1) : null;
    const colonInHost = host.lastIndexOf(":");
    ip   = host.slice(0, colonInHost);
    port = host.slice(colonInHost + 1);
  } else {
    const parts = clean.split(":");
    if (parts.length >= 4) {
      // host:port:user:pass
      [ip, port, username, password] = parts;
    } else if (parts.length === 2) {
      // host:port (no auth)
      [ip, port] = parts;
    } else {
      return null;
    }
  }

  if (!ip || !port) return null;

  ip       = ip.trim();
  port     = parseInt(port.trim(), 10);
  username = username?.trim() || null;
  password = password?.trim() || null;

  if (isNaN(port)) return null;

  return { ip, port, username, password };
}

// ── Import a single CSV file ──────────────────────────────────────────────────
async function importCSVFile(filePath) {
  logger.info(`Importing ${path.basename(filePath)}...`);

  const content = fs.readFileSync(filePath, "utf-8");
  const lines   = content.split("\n");

  let successes = 0;
  let skipped   = 0;
  let failures  = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Skip blank lines and comment lines
    if (!line || line.startsWith("#")) continue;

    const fields = parseCSVLine(line);

    // Skip the header row
    if (fields[0].toLowerCase() === "proxy_url") continue;

    if (fields.length < 5) {
      logger.warn(`Skipping malformed line: ${line}`);
      skipped++;
      continue;
    }

    // session_type is optional (column 6) — defaults to "rotating"
    // ttl is optional (column 7) — default sessttl minutes for sticky rows
    const [proxy_url, provider, type, country, protocol, session_type_raw, ttl_raw] = fields;
    const sessionType = ["rotating", "sticky"].includes(session_type_raw?.toLowerCase())
      ? session_type_raw.toLowerCase()
      : "rotating";

    // Parse optional ttl column → stored as metadata.sessttl for sticky rows
    let metadata = null;
    if (sessionType === "sticky" && ttl_raw) {
      const ttlVal = parseInt(ttl_raw.trim(), 10);
      if (!isNaN(ttlVal) && ttlVal > 0 && ttlVal <= 1440) {
        metadata = JSON.stringify({ sessttl: ttlVal });
      }
    }

    const parsed = parseProxyUrl(proxy_url);
    if (!parsed) {
      logger.warn(`Could not parse proxy_url: ${proxy_url}`);
      skipped++;
      continue;
    }

    const { ip, port, username, password } = parsed;

    // Build canonical proxy_string — always includes the protocol prefix
    const proto       = protocol?.toLowerCase() || "http";
    const authPart    = username ? `${username}:${password}@` : "";
    const proxyString = `${proto}://${authPart}${ip}:${port}`;

    try {
      await pg.query(
        `INSERT INTO proxies (
           proxy_string, ip, port, username, password, protocol,
           provider, proxy_type, session_type, country, score, healthy, metadata
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, 100, true, $11
         )
         ON CONFLICT (proxy_string)
         DO UPDATE SET
           updated_at   = NOW(),
           healthy      = true,
           provider     = EXCLUDED.provider,
           proxy_type   = EXCLUDED.proxy_type,
           session_type = EXCLUDED.session_type,
           country      = EXCLUDED.country,
           protocol     = EXCLUDED.protocol,
           metadata     = COALESCE(EXCLUDED.metadata, proxies.metadata)`,
        [
          proxyString, ip, port, username, password, proto,
          provider?.toLowerCase()  || "unknown",
          type?.toLowerCase()      || "datacenter",
          sessionType,
          country?.toUpperCase()   || "GLOBAL",
          metadata,
        ]
      );
      successes++;
    } catch (err) {
      logger.error(`DB insert failed for ${proxy_url}: ${err.message}`);
      failures++;
    }
  }

  logger.info(
    `${path.basename(filePath)}: inserted/updated=${successes}, skipped=${skipped}, failed=${failures}`
  );
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function run() {
  const arg = process.argv[2];

  let files;
  if (arg) {
    // Specific file provided on command line
    const resolved = path.isAbsolute(arg) ? arg : path.join(process.cwd(), arg);
    if (!fs.existsSync(resolved)) {
      logger.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    files = [resolved];
  } else {
    // Default: all *.csv in proxy_lists/
    if (!fs.existsSync(proxyDir)) {
      logger.warn(`proxy_lists/ directory not found at ${proxyDir}`);
      process.exit(0);
    }
    files = fs.readdirSync(proxyDir)
      .filter(f => f.endsWith(".csv"))
      .map(f => path.join(proxyDir, f));

    if (!files.length) {
      logger.warn("No .csv files found in proxy_lists/");
      process.exit(0);
    }
  }

  for (const file of files) {
    await importCSVFile(file);
  }

  logger.info("CSV import complete.");
  await pg.end();
}

run().catch(err => {
  logger.error("CSV import failed:", err);
  process.exit(1);
});
