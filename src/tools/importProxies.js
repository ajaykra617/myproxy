// src/tools/importProxies.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pg } from "../db/postgres.js";
import { logger } from "../utils/logger.js";
import { ingestProxies } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const proxyDir = path.join(__dirname, "../../proxy_lists");


async function importProxies() {
  const files = fs.readdirSync(proxyDir).filter(f => f.endsWith(".txt"));
  if (!files.length) {
    logger.warn("No proxy lists found in proxy_lists/");
    return;
  }

  for (const file of files) {
    let provider = "unknown";
    let proxy_type = null;
    let country = null;
    let protocol = null;

    const name = file.replace(".txt", "");
    const parts = name.split(/[-_]/);

    provider = parts[0] || "unknown";

    const possible_types = ["residential", "datacenter", "isp", "mobile"];
    const possible_protocols = ["http", "https", "socks4", "socks5"];

    for (const part of parts.slice(1)) {
      const lowerPart = part.toLowerCase();
      if (part.length === 2 && !country) {
        country = part.toUpperCase();
      } else if (possible_types.includes(lowerPart) && !proxy_type) {
        proxy_type = lowerPart;
      } else if (possible_protocols.includes(lowerPart) && !protocol) {
        protocol = lowerPart;
      }
    }

    await ingestProxies({
      source: path.join(proxyDir, file),
      provider,
      type: proxy_type,
      country: country || "global",
      protocol
    });
  }

  logger.info("All proxy imports complete!");
  await pg.end();
}

importProxies().catch(err => logger.error("Import failed:", err));