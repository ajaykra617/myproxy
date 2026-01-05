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