import { config } from "../../utils/config.js";

export function requireManagerKey(req, res, next) {
  const requiredKey = config.managerApiKey;
  const headerName = String(config.managerApiKeyHeader || "x-api-key").toLowerCase();

  if (!requiredKey) {
    return res.status(500).json({ error: "Proxy manager API key not configured" });
  }

  const provided = req.header(headerName);
  if (!provided || provided !== requiredKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next();
}
