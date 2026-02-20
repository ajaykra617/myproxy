// src/tools/sync_webshare.js
import { pg } from "../db/postgres.js";
import { config } from "../utils/config.js";
import { logger } from "../utils/logger.js";

async function syncWebshare() {
    if (!config.webshareApiKey) {
        logger.error("Missing WEBSHARE_API_KEY in environment/config");
        process.exit(1);
    }

    logger.info("Fetching proxy list from Webshare...");

    try {
        // 1. Fetch from Webshare API
        // Documentation: https://proxy.webshare.io/api/v2/proxy/list/
        const response = await fetch("https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page_size=250", {
            headers: {
                "Authorization": `Token ${config.webshareApiKey}`
            }
        });

        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${res.statusText}`);
        }

        const data = await response.json();
        const proxies = data.results || [];

        if (proxies.length === 0) {
            logger.warn("Webshare returned 0 proxies.");
            return;
        }

        logger.info(`Fetched ${proxies.length} proxies. Syncing to DB...`);

        let added = 0;

        // 2. Ingest into DB
        for (const p of proxies) {
            // Webshare object: { ip, port, username, password, country_code, ... }
            const proxyString = `http://${p.username}:${p.password}@${p.proxy_address}:${p.port}`;

            await pg.query(`
        INSERT INTO proxies (
          proxy_string, ip, port, username, password, protocol,
          provider, proxy_type, country, score, healthy, external_id
        ) VALUES (
          $1, $2, $3, $4, $5, 'http',
          'webshare', 'datacenter', $6, 100, true, $7
        )
        ON CONFLICT (proxy_string)
        DO UPDATE SET
          updated_at = NOW(),
          healthy    = true,
          country    = EXCLUDED.country
      `, [
                proxyString,
                p.proxy_address,
                p.port,
                p.username,
                p.password,
                p.country_code,
                p.id // external_id if available or just skip
            ]);
            added++;
        }

        logger.info(`Sync Complete. Processed ${added} proxies.`);

    } catch (err) {
        logger.error("Webshare Sync Failed:", err);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    syncWebshare()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
