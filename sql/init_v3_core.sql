-- sql/init_v3_core.sql
-- Future-ready schema for Smart Proxy Manager (Aggregator + AI-Ready)

DROP TABLE IF EXISTS proxy_usage_logs CASCADE;
DROP TABLE IF EXISTS provider_performance CASCADE;
DROP TABLE IF EXISTS routing_rules CASCADE;
DROP TABLE IF EXISTS proxies CASCADE;

-- 1. Main Proxy Inventory
CREATE TABLE proxies (
  id SERIAL PRIMARY KEY,
  -- Connection Details
  proxy_string TEXT NOT NULL,           -- e.g., http://user:pass@ip:port
  ip TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password TEXT,
  protocol TEXT DEFAULT 'http',         -- http, socks4, socks5
  
  -- Provider Metadata
  provider TEXT NOT NULL,               -- oxylabs, brightdata, webshare, etc.
  external_id TEXT,                     -- ID from the provider's system
  
  -- Classification (Critical for Routing)
  proxy_type TEXT NOT NULL,             -- datacenter, residential, mobile, isp
  session_type TEXT DEFAULT 'rotating'  -- rotating | sticky
    CHECK (session_type IN ('rotating', 'sticky')),
  anonymity TEXT DEFAULT 'elite',       -- elite, anonymous, transparent
  country TEXT,
  city TEXT,
  asn TEXT,
  
  -- AI & Hygiene Metrics
  score DECIMAL DEFAULT 100.0,
  healthy BOOLEAN DEFAULT true,
  consecutive_fails INT DEFAULT 0,
  success_count INT DEFAULT 0,
  fail_count INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,
  
  -- Future: Economy
  cost_per_gb DECIMAL(10, 4) DEFAULT 0,
  cost_per_req DECIMAL(10, 4) DEFAULT 0,
  
  -- Flexible Metadata (Future Proofing)
  metadata JSONB DEFAULT '{}',          -- Store any extra provider info here
  
  -- Timestamps
  last_used TIMESTAMP,
  last_success TIMESTAMP,
  last_fail TIMESTAMP,
  last_check TIMESTAMP,                 -- Last active health check
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- proxy_string is the natural unique key:
  --   static IPs:   http://user:pass@1.2.3.4:8080   (unique per IP)
  --   gateway rows: https://login__cr.us:pass@gw.host:823  (unique per country/account)
  -- This allows multiple countries on the same gateway host without conflict.
  UNIQUE(proxy_string)
);

-- 2. Usage Logs (The Brain's Memory)
CREATE TABLE proxy_usage_logs (
  id SERIAL PRIMARY KEY,
  proxy_id INT REFERENCES proxies(id) ON DELETE SET NULL,
  target_domain TEXT NOT NULL,
  target_url TEXT,
  
  -- Request Context
  geo_required TEXT,
  user_id TEXT,                         -- For future multi-tenancy
  
  -- Outcome
  status TEXT NOT NULL CHECK (status IN ('success', 'blocked', 'timeout', 'captcha', 'slow', 'error')),
  latency_ms INT,
  http_status INT,
  error_message TEXT,
  
  -- AI Training Data
  notes TEXT,
  training_json JSONB,                  -- Full training-ready example capture
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. High-Level Stats (For fast routing decisions)
CREATE TABLE provider_performance (
  id SERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  proxy_type TEXT NOT NULL,
  target_domain TEXT,
  
  success_rate DECIMAL DEFAULT 1.0,
  avg_latency_ms INT,
  block_rate DECIMAL DEFAULT 0.0,
  total_requests INT DEFAULT 0,
  
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, proxy_type, target_domain)
);

-- 4. Indexes for high-performance Querying
CREATE INDEX idx_proxies_query ON proxies(healthy, country, proxy_type, score DESC);
CREATE INDEX idx_proxies_provider ON proxies(provider);
CREATE INDEX idx_logs_analysis ON proxy_usage_logs(target_domain, status, created_at DESC);
