import OpenAI from "openai";
import { config } from "../utils/config.js";
import { pg } from "../db/postgres.js";
import { redis } from "../db/redis.js";
import { PROXY_ROUTING_PROMPT } from "./prompts.js";

const groq = new OpenAI({
  apiKey: config.groqApiKey,
  baseURL: "https://api.groq.com/openai/v1"
});

async function getStatsSummary() {
  const { rows } = await pg.query(`
    SELECT provider, proxy_type, 
           success_rate, avg_latency_ms, block_rate
    FROM provider_performance 
    WHERE total_requests > 10
    ORDER BY success_rate DESC
    LIMIT 20
  `);
  if (rows.length === 0) return "No performance data yet — prefer residential providers.";
  return rows.map(r => 
    `- ${r.provider} ${r.proxy_type}: ${ (r.success_rate*100).toFixed(1) }% success, ${r.avg_latency_ms}ms avg, ${ (r.block_rate*100).toFixed(1) }% blocks`
  ).join("\n");
}

async function getActiveRules(targetDomain) {
  const { rows } = await pg.query(`
    SELECT preferred_provider, preferred_type, reason
    FROM routing_rules 
    WHERE active = true 
      AND $1 ILIKE target_pattern
    ORDER BY priority DESC
  `, [targetDomain]);
  return rows.length > 0 ? rows.map(r => `${r.preferred_provider || 'any'} ${r.preferred_type || ''} (${r.reason || 'manual'})`).join(", ") : "None";
}

export async function getBestProxyRecommendation({ targetUrl, geo, script }) {
  const domain = new URL(targetUrl).hostname;

  // Cache key
  const cacheKey = `proxy:decision:${domain}:${geo || 'any'}:${script || 'default'}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const stats = await getStatsSummary();
  const rules = await getActiveRules(`%${domain}%`);

  const prompt = PROXY_ROUTING_PROMPT
    .replace("{{STATS_SUMMARY}}", stats)
    .replace("{{TARGET_DOMAIN}}", domain)
    .replace("{{TARGET_URL}}", targetUrl)
    .replace("{{GEO}}", geo || "any")
    .replace("{{SCRIPT}}", script || "unknown")
    .replace("{{RULES}}", rules);

  try {
    const response = await groq.chat.completions.create({
      model: "llama3-8b-8192", // Fast & cheap
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const decision = JSON.parse(response.choices[0].message.content);

    // Cache for 5 minutes
    await redis.set(cacheKey, JSON.stringify(decision), "EX", 300);

    return decision;
  } catch (err) {
    // Fallback: simple score-based
    return { recommended_provider: null, recommended_type: "residential", reason: "Groq error — fallback to residential" };
  }
}