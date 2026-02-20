// src/tools/sync_dataimpulse.js
import { ingestProxies } from "./ingest.js";
import { logger } from "../utils/logger.js";

async function syncDataImpulse() {
    const login = process.env.DATAIMPULSE_LOGIN;
    const password = process.env.DATAIMPULSE_PASSWORD;

    if (!login || !password) {
        logger.error("Missing DATAIMPULSE_LOGIN / DATAIMPULSE_PASSWORD in .env");
        process.exit(1);
    }

    logger.info("Syncing DataImpulse Proxies via API...");

    // Endpoint logic provided by user
    const baseUrl = "https://gw.dataimpulse.com:777/api/list";
    const params = new URLSearchParams({
        quantity: process.env.DATAIMPULSE_QUANTITY || "1000",
        type: "sticky",
        format: "login:password@hostname:port",
        protocol: "http",
        session_ttl: "60"
    });

    const apiUrl = `${baseUrl}?${params.toString()}`;
    const auth = Buffer.from(`${login}:${password}`).toString("base64");

    try {
        logger.info(`Fetching: ${apiUrl}`);
        const response = await fetch(apiUrl, {
            headers: { "Authorization": `Basic ${auth}` }
        });

        if (!response.ok) throw new Error(`API Error: ${response.status}`);

        const text = await response.text();
        const tempFile = `/tmp/dataimpulse_sync_${Date.now()}.txt`;
        const fs = (await import("fs")).default;
        fs.writeFileSync(tempFile, text);

        await ingestProxies({
            source: tempFile,
            provider: "dataimpulse",
            type: "datacenter",
            country: "global"
        });

        fs.unlinkSync(tempFile);
        logger.info("Sync Completed");

    } catch (err) {
        logger.error("Sync Failed:", err);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    syncDataImpulse();
}
