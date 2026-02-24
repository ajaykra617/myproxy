import dotenv from "dotenv";
dotenv.config();

export const config = {
  port:           parseInt(process.env.PORT       || "3000", 10),
  relayPort:      parseInt(process.env.RELAY_PORT  || "8080", 10),
  // Set RELAY_HOST to your server's public IP or domain to enable relay mode.
  // When set, GET /v1/proxy returns a token-based URL pointing to the relay
  // instead of the real provider URL. Leave unset for direct/dev mode.
  relayHost:      process.env.RELAY_HOST || null,
  redisUrl:       process.env.REDIS_URL     || "redis://redis:6379",
  postgresUrl:    process.env.POSTGRES_URL  || "postgres://postgres:postgres@db:5432/myproxy",
  groqApiKey:     process.env.GROQ_API_KEY,
  webshareApiKey: process.env.WEBSHARE_API_KEY,
  managerApiKey: process.env.PROXY_MANAGER_API_KEY || process.env.MYPROXY_API_KEY || "",
  managerApiKeyHeader: process.env.PROXY_MANAGER_API_KEY_HEADER || "x-api-key",
};

