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
