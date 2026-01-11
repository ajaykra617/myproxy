// src/api/routes/proxies.js
import { Router } from "express";
import { pg } from "../../db/postgres.js";
import { redis } from "../../db/redis.js";
import { getBestProxyRecommendation } from "../../ai/groqBrain.js";
import { logTrainingExample } from "../../utils/trainingLogger.js";
import { logger } from "../../utils/logger.js";

const router = Router();

// Add this line near the top with other routes
// NEW - supports ?provider=xxx (optional)
router.get("/proxies/random", async (req, res) => {
  const requestedProvider = req.query.provider;

  let query = `
    SELECT * FROM proxies 
    WHERE healthy = true
  `;
  const values = [];

  // If user wants specific provider
  if (requestedProvider) {
    query += ` AND provider = $${values.length + 1}`;
    values.push(requestedProvider);
  }

  query += ` ORDER BY RANDOM() LIMIT 1`;

  try {
    const { rows } = await pg.query(query, values);

    if (!rows.length) {
      const errorMsg = requestedProvider 
        ? `No healthy proxies found for provider: ${requestedProvider}`
        : "No healthy proxies available at all";
      return res.status(404).json({ error: errorMsg });
    }

    const p = rows[0];
    res.json({
      proxy: p.proxy_string,
      id: p.id,
      provider: p.provider,
      type: p.proxy_type,
      country: p.country || "global"  // nice bonus
    });
  } catch (err) {
    logger.error("Random proxy error:", err);
    res.status(500).json({ error: "Internal error" });
  }
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