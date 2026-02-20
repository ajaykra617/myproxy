// src/tools/ingest.js
import fs from "fs";
import path from "path";
import { pg } from "../db/postgres.js";
import { logger } from "../utils/logger.js";

/**
 * Parses a proxy line into a standardized object.
 * Supported formats:
 * - http://user:pass@ip:port
 * - ip:port:user:pass
 * - ip:port
 */
function parseProxyLine(line, protocolOverride = null) {
    line = line.trim();
    if (!line || line.startsWith("#")) return null;

    // Remove protocol prefixes for parsing
    const cleanLine = line.replace(/^(http|https|socks5|socks4):\/\//i, "");

    let username, password, ip, port;

    if (cleanLine.includes("@")) {
        const [auth, host] = cleanLine.split("@");
        [username, password] = auth.split(":");
        [ip, port] = host.split(":");
    } else if (cleanLine.split(":").length >= 4) {
        [ip, port, username, password] = cleanLine.split(":");
    } else if (cleanLine.split(":").length === 2) {
        [ip, port] = cleanLine.split(":");
    }

    if (!ip || !port) return null;

    ip = ip.trim();
    port = parseInt(port.trim(), 10);
    username = username?.trim() || null;
    password = password?.trim() || null;

    let protocol = protocolOverride;
    if (!protocol) {
        protocol = line.toLowerCase().startsWith("socks") ? "socks5" : "http";
    }

    const authPart = username ? `${username}:${password}@` : "";
    const proxy_string = `${protocol}://${authPart}${ip}:${port}`;

    return {
        ip, port, username, password,
        proxy_string,
        protocol
    };
}


// Helper to fetch content from URL or File
async function getContent(source) {
    if (source.startsWith("http://") || source.startsWith("https://")) {
        logger.info(`Fetching proxies from URL: ${source}`);
        const res = await fetch(source);
        if (!res.ok) throw new Error(`Failed to fetch URL: ${res.statusText}`);
        return await res.text();
    } else {
        if (!fs.existsSync(source)) throw new Error(`File not found: ${source}`);
        return fs.readFileSync(source, "utf-8");
    }
}

export async function ingestProxies({ source, provider, type, country, protocol }) {
    logger.info(`Starting ingestion from ${source} for provider ${provider}...`);

    try {
        const content = await getContent(source);
        const lines = content.split("\n");
        let successes = 0;
        let failures = 0;

        for (const line of lines) {
            const parsed = parseProxyLine(line, protocol);
            if (!parsed) continue;

            try {
                await pg.query(`
          INSERT INTO proxies (
            proxy_string, ip, port, username, password, protocol,
            provider, proxy_type, country, score, healthy
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, 100, true
          )
          ON CONFLICT (proxy_string)
          DO UPDATE SET updated_at = NOW(), healthy = true
        `, [
                    parsed.proxy_string,
                    parsed.ip,
                    parsed.port,
                    parsed.username,
                    parsed.password,
                    parsed.protocol,
                    provider,
                    type || "datacenter",
                    country || "unknown"
                ]);
                successes++;
            } catch (err) {
                // Silently fail on duplicates if needed, or log error
                failures++;
            }
        }

        logger.info(`Ingestion Complete. Added/Updated: ${successes}, Failed/Skipped: ${failures}`);
    } catch (err) {
        logger.error("Ingestion Fatal Error:", err.message);
    }
}

// Allow running directly: node src/tools/ingest.js <url_or_file> <provider> <type> <country>
if (import.meta.url === `file://${process.argv[1]}`) {
    const [, , source, provider, type, country] = process.argv;
    if (!source || !provider) {
        console.log("Usage: node src/tools/ingest.js <url_or_file> <provider_name> [type] [country]");
    } else {
        ingestProxies({ source, provider, type, country })
            .then(() => process.exit(0))
            .catch(e => { console.error(e); process.exit(1); });
    }
}
