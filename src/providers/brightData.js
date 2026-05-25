const DEFAULT_HOST = "brd.superproxy.io";
const DEFAULT_PORT = 33335;
const DEFAULT_PROTOCOL = "http";
const DEFAULT_CUSTOMER_ID = "hl_8a6ef076";
const DEFAULT_ZONE = "residential_proxy1";
const PROVIDER = "brightdata";

function readEnv(names, fallback = "") {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function normalizeProviderName(provider) {
  return String(provider || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function isBrightDataProviderName(provider) {
  return normalizeProviderName(provider) === PROVIDER;
}

function splitHostPort(rawHost, rawPort) {
  const cleanHost = String(rawHost || DEFAULT_HOST)
    .trim()
    .replace(/^(https?|socks[45]):\/\//i, "")
    .replace(/\/$/, "");

  const colonIdx = cleanHost.lastIndexOf(":");
  const hostHasPort = colonIdx > -1 && /^\d+$/.test(cleanHost.slice(colonIdx + 1));

  return {
    host: hostHasPort ? cleanHost.slice(0, colonIdx) : cleanHost,
    port: parseInt(hostHasPort ? cleanHost.slice(colonIdx + 1) : rawPort, 10),
  };
}

function buildBaseUsername() {
  const explicit = readEnv(["BRIGHTDATA_USERNAME", "BRIGHT_DATA_USERNAME"]);
  if (explicit) return explicit;

  const customerId = readEnv(["BRIGHTDATA_CUSTOMER_ID", "BRIGHT_DATA_CUSTOMER_ID"], DEFAULT_CUSTOMER_ID);
  const zone = readEnv(["BRIGHTDATA_ZONE", "BRIGHT_DATA_ZONE"], DEFAULT_ZONE);
  if (!customerId || !zone) return "";

  return `brd-customer-${customerId}-zone-${zone}`;
}

export function getBrightDataConfig() {
  const { host, port } = splitHostPort(
    readEnv(["BRIGHTDATA_HOST", "BRIGHT_DATA_HOST"], DEFAULT_HOST),
    readEnv(["BRIGHTDATA_PORT", "BRIGHT_DATA_PORT"], String(DEFAULT_PORT))
  );
  const protocol = readEnv(["BRIGHTDATA_PROTOCOL", "BRIGHT_DATA_PROTOCOL"], DEFAULT_PROTOCOL)
    .toLowerCase()
    .replace(/:$/, "");
  const username = buildBaseUsername();
  const password = readEnv(["BRIGHTDATA_PASSWORD", "BRIGHT_DATA_PASSWORD"]);
  const defaultCountry = readEnv(["BRIGHTDATA_COUNTRY", "BRIGHT_DATA_COUNTRY"]);

  const configured = Boolean(host && port && username && password);
  const enabled = readEnv(["BRIGHTDATA_ENABLED", "BRIGHT_DATA_ENABLED"], "true") !== "false";

  return {
    enabled,
    configured,
    host,
    port,
    protocol,
    username,
    password,
    defaultCountry: defaultCountry ? defaultCountry.toUpperCase() : null,
  };
}

function appendUsernameOption(username, key, value) {
  if (!value || username.includes(`-${key}-`)) return username;
  return `${username}-${key}-${String(value).trim().toLowerCase()}`;
}

function buildUsername(baseUsername, { country, state, asn, ip } = {}) {
  let username = baseUsername;
  username = appendUsernameOption(username, "country", country);
  username = appendUsernameOption(username, "state", state);
  username = appendUsernameOption(username, "asn", asn ? String(asn).replace(/^as/i, "") : null);
  username = appendUsernameOption(username, "ip", ip);
  return username;
}

function buildProxyUrl({ protocol, username, password, host, port }) {
  const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;
  return `${protocol}://${auth}@${host}:${port}`;
}

export function buildBrightDataProxy({ type, protocol, country, state, asn, ip } = {}) {
  const cfg = getBrightDataConfig();
  if (!cfg.enabled || !cfg.configured) return null;

  const requestedType = String(type || "residential").toLowerCase();
  if (requestedType !== "residential") return null;

  const requestedProtocol = protocol ? String(protocol).toLowerCase() : null;
  if (requestedProtocol && requestedProtocol !== cfg.protocol) return null;

  const resolvedCountry = country || cfg.defaultCountry || null;
  const username = buildUsername(cfg.username, {
    country: resolvedCountry,
    state,
    asn,
    ip,
  });
  const proxyString = buildProxyUrl({
    protocol: cfg.protocol,
    username,
    password: cfg.password,
    host: cfg.host,
    port: cfg.port,
  });

  return {
    id: null,
    proxy_string: proxyString,
    ip: cfg.host,
    port: cfg.port,
    username,
    password: cfg.password,
    protocol: cfg.protocol,
    provider: PROVIDER,
    proxy_type: "residential",
    session_type: "rotating",
    country: resolvedCountry ? String(resolvedCountry).toUpperCase() : "GLOBAL",
    city: null,
    score: 100,
    metadata: {
      gateway: true,
      country: resolvedCountry ? String(resolvedCountry).toUpperCase() : null,
      ssl: "Use Bright Data CA or configure clients to ignore TLS verification errors.",
    },
  };
}
