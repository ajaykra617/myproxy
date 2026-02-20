// src/api/routes/proxies.js
import crypto from "crypto";
import { Router } from "express";
import { pg } from "../../db/postgres.js";
import { redis } from "../../db/redis.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../utils/config.js";

const router = Router();

const VALID_TYPES = ["residential", "datacenter", "mobile", "isp"];
const VALID_PROTOCOLS = ["http", "https", "socks4", "socks5"];
const VALID_ANONYMITY = ["elite", "anonymous", "transparent"];
const VALID_STRATEGIES = ["random", "least_used"];
const VALID_STATUSES = ["success", "blocked", "timeout", "captcha", "slow", "error"];

// ----------------------------------------------------------------------
// GET /v1/proxy
// Fetch a single healthy proxy matching the given criteria.
//
// Query params:
//   proxy      – proxy type shorthand (residential|datacenter|mobile|isp)
//   type       – same as proxy (either param works)
//   country    – ISO country code (US, DE …)
//   protocol   – http|https|socks4|socks5
//   anonymity  – elite|anonymous|transparent
//   provider   – specific provider name
//   strategy   – random (default) | least_used
//   sticky     – true: return a sticky-session proxy row (must exist in DB)
//   ttl        – sticky session duration in minutes (1–1440); overrides
//                the proxy row's metadata.sessttl default
// ----------------------------------------------------------------------
router.get("/proxy", async (req, res) => {
  const {
    country,
    type,
    proxy,           // alias for "type"
    protocol,
    anonymity,
    provider,
    strategy = "random",
  } = req.query;

  // "proxy" param is an alias for "type" (either works)
  const proxyType = (type || proxy || "").toLowerCase() || undefined;

  // ── Input validation ──────────────────────────────────────────────────
  if (proxyType && !VALID_TYPES.includes(proxyType)) {
    return res.status(400).json({
      error: `Invalid type/proxy value. Allowed: ${VALID_TYPES.join(", ")}`,
    });
  }
  if (protocol && !VALID_PROTOCOLS.includes(protocol.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid protocol. Allowed: ${VALID_PROTOCOLS.join(", ")}`,
    });
  }
  if (anonymity && !VALID_ANONYMITY.includes(anonymity.toLowerCase())) {
    return res.status(400).json({
      error: `Invalid anonymity. Allowed: ${VALID_ANONYMITY.join(", ")}`,
    });
  }
  if (!VALID_STRATEGIES.includes(strategy)) {
    return res.status(400).json({
      error: `Invalid strategy. Allowed: ${VALID_STRATEGIES.join(", ")}`,
    });
  }

  const sticky = req.query.sticky === "true";

  // ?ttl= (minutes) — only relevant for sticky sessions, range 1–1440
  let ttlMinutes = null;
  if (req.query.ttl !== undefined) {
    ttlMinutes = parseInt(req.query.ttl, 10);
    if (isNaN(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) {
      return res.status(400).json({
        error: "Invalid ttl. Must be an integer between 1 and 1440 (minutes).",
      });
    }
  }

  try {
    // ── Build query ───────────────────────────────────────────────────
    let query = `SELECT * FROM proxies WHERE healthy = true`;
    const values = [];
    let idx = 1;

    // Always filter by session_type so rotating and sticky rows never mix
    query += ` AND session_type = $${idx++}`;
    values.push(sticky ? "sticky" : "rotating");

    if (country) { query += ` AND country = $${idx++}`; values.push(country.toUpperCase()); }
    if (proxyType) { query += ` AND proxy_type = $${idx++}`; values.push(proxyType); }
    if (protocol) { query += ` AND protocol = $${idx++}`; values.push(protocol.toLowerCase()); }
    if (anonymity) { query += ` AND anonymity = $${idx++}`; values.push(anonymity.toLowerCase()); }
    if (provider) { query += ` AND provider = $${idx++}`; values.push(provider.toLowerCase()); }

    if (strategy === "least_used") {
      query += ` ORDER BY last_used ASC NULLS FIRST`;
    } else {
      query += ` ORDER BY score DESC, RANDOM()`;
    }

    query += ` LIMIT 1`;

    // ── Execute ───────────────────────────────────────────────────────
    const { rows } = await pg.query(query, values);

    if (!rows.length) {
      return res.status(404).json({
        error: "No matching proxy found",
        criteria: { country, type: proxyType, protocol, anonymity, provider },
      });
    }

    const p = rows[0];

    // Update last_used asynchronously (supports least_used strategy)
    pg.query("UPDATE proxies SET last_used = NOW() WHERE id = $1", [p.id])
      .catch((e) => logger.error("last_used update failed", e));

    // ── Relay mode ────────────────────────────────────────────────────
    // When RELAY_HOST is configured the real provider URL is never sent
    // to the client — they get a short-lived token-based URL instead.
    //
    // For sticky DataImpulse rows the DB stores the BASE username without
    // any sessttl suffix.  We inject ";sessttl.{minutes}" at request time
    // so every API call can carry a different TTL without touching the DB.
    //
    // Priority for sessttl: ?ttl= param  >  metadata.sessttl  >  60 min

    // ── Sticky username injection ──────────────────────────────────────
    // Build the effective username/proxyUrl with sessttl for sticky rows.
    let effectiveUsername = p.username;
    let proxyUrl = p.proxy_string;
    const sessttlMinutes = sticky
      ? (ttlMinutes ?? (p.metadata?.sessttl ?? 60))
      : null;

    if (sticky && p.username && !p.username.includes(";sessttl.")) {
      effectiveUsername = `${p.username};sessttl.${sessttlMinutes}`;
      proxyUrl = p.proxy_string.replace(
        `://${p.username}:`,
        `://${effectiveUsername}:`
      );
    }

    // ── Common metadata ───────────────────────────────────────────────
    const metadata = {
      id: p.id,
      country: p.country,
      type: p.proxy_type,
      provider: p.provider,
      session_type: p.session_type,
      score: parseFloat(p.score),
      ...(sticky && { sessttl_minutes: sessttlMinutes }),
    };

    // ── Relay mode ────────────────────────────────────────────────────
    if (config.relayHost) {
      const sessionTtl = sticky
        ? sessttlMinutes * 60 + 60
        : 86400; // rotating: 24 h

      const token = crypto.randomBytes(24).toString("hex");
      await redis.setex(
        `relay:${token}`,
        sessionTtl,
        JSON.stringify({ proxy_url: proxyUrl, proxy_id: p.id, sticky })
      );

      return res.json({
        proxy_url: `http://${token}:x@${config.relayHost}:${config.relayPort}`,
        expires_at: new Date(Date.now() + sessionTtl * 1000).toISOString(),
        connection: {
          scheme: "http",
          host: config.relayHost,
          port: String(config.relayPort),
          username: token,
          password: "x",
        },
        metadata,
      });
    }

    // ── Direct mode (no relay) ────────────────────────────────────────
    return res.json({
      proxy_url: proxyUrl,
      connection: {
        scheme: p.protocol,
        host: p.ip,
        port: String(p.port),
        username: effectiveUsername || null,
        password: p.password || null,
      },
      metadata,
    });
  } catch (err) {
    logger.error("Proxy fetch error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ----------------------------------------------------------------------
// GET /v1/providers
// Catalog of available providers, proxy types, and their live stats.
// ----------------------------------------------------------------------
router.get("/providers", async (_req, res) => {
  try {
    const { rows } = await pg.query(`
      SELECT
        provider,
        proxy_type,
        protocol,
        COUNT(*)                                          AS total,
        COUNT(*) FILTER (WHERE healthy = true)            AS healthy,
        ROUND(AVG(score)::NUMERIC, 1)                     AS avg_score,
        ARRAY_AGG(DISTINCT country ORDER BY country)
          FILTER (WHERE country IS NOT NULL)              AS countries
      FROM proxies
      GROUP BY provider, proxy_type, protocol
      ORDER BY provider, proxy_type, protocol
    `);

    // Group into { provider → { types → [...] } }
    const map = {};
    for (const row of rows) {
      if (!map[row.provider]) {
        map[row.provider] = { provider: row.provider, types: [] };
      }
      map[row.provider].types.push({
        proxy_type: row.proxy_type,
        protocol: row.protocol,
        total: parseInt(row.total, 10),
        healthy: parseInt(row.healthy, 10),
        avg_score: parseFloat(row.avg_score),
        countries: row.countries || [],
      });
    }

    return res.json({ providers: Object.values(map) });
  } catch (err) {
    logger.error("Providers catalog error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ----------------------------------------------------------------------
// POST /v1/proxy/report
// Feedback loop – clients report success/failure so scores stay current.
//
// Body:
//   proxy_id      – preferred; resolved by IP if omitted
//   proxy_ip      – fallback identifier
//   status        – success|blocked|timeout|captcha|slow|error
//   latency_ms    – response time in milliseconds
//   target_domain – domain that was scraped
// ----------------------------------------------------------------------
router.post("/proxy/report", async (req, res) => {
  const { proxy_ip, status, latency_ms, target_domain } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Missing required field: status" });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}`,
    });
  }

  try {
    // ── Resolve proxy ─────────────────────────────────────────────────
    let proxyId = req.body.proxy_id;
    if (!proxyId && proxy_ip) {
      const { rows } = await pg.query(
        "SELECT id FROM proxies WHERE ip = $1 LIMIT 1",
        [proxy_ip]
      );
      if (rows.length) proxyId = rows[0].id;
    }
    if (!proxyId) {
      return res.status(404).json({ error: "Proxy not found" });
    }

    // ── Score delta ───────────────────────────────────────────────────
    const isSuccess = status === "success";
    let scoreDelta = 0;
    if (isSuccess) scoreDelta = 1;
    else if (status === "blocked" || status === "captcha") scoreDelta = -5;
    else scoreDelta = -2; // timeout, error, slow

    // ── Update proxy stats ────────────────────────────────────────────
    // NOTE: In PostgreSQL all SET expressions see the original row values,
    // so "consecutive_fails + 1" always refers to the pre-update count.
    // The healthy flag logic accounts for this correctly:
    //   - On failure: mark unhealthy when (old_fails + 1) >= 10
    //   - On success: restore to healthy and reset the streak counter
    await pg.query(
      `
      UPDATE proxies SET
        score            = GREATEST(0, LEAST(100, score + $1)),
        success_count    = success_count + $2,
        fail_count       = fail_count    + $3,
        consecutive_fails = CASE WHEN $4 THEN 0 ELSE consecutive_fails + 1 END,
        healthy          = CASE
                             WHEN $4                          THEN true
                             WHEN consecutive_fails + 1 >= 10 THEN false
                             ELSE healthy
                           END,
        last_success     = CASE WHEN $4     THEN NOW() ELSE last_success END,
        last_fail        = CASE WHEN NOT $4 THEN NOW() ELSE last_fail    END,
        avg_latency_ms   = CASE
                             WHEN $5 > 0
                             THEN (avg_latency_ms * 9 + $5) / 10
                             ELSE avg_latency_ms
                           END
      WHERE id = $6
      `,
      [scoreDelta, isSuccess ? 1 : 0, isSuccess ? 0 : 1, isSuccess, latency_ms || 0, proxyId]
    );

    // ── Insert usage log ──────────────────────────────────────────────
    await pg.query(
      `INSERT INTO proxy_usage_logs (proxy_id, target_domain, status, latency_ms)
       VALUES ($1, $2, $3, $4)`,
      [proxyId, target_domain || "unknown", status, latency_ms || null]
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error("Report error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
