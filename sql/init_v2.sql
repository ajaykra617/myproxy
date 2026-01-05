-- sql/init_v2.sql
-- Clean, enterprise-ready schema for AI-powered proxy manager

DROP TABLE IF EXISTS proxy_usage_logs CASCADE;
DROP TABLE IF EXISTS provider_performance CASCADE;
DROP TABLE IF EXISTS routing_rules CASCADE;
DROP TABLE IF EXISTS proxies CASCADE;

CREATE TABLE proxies (
  id SERIAL PRIMARY KEY,
  proxy_string TEXT NOT NULL,           -- e.g., http://user:pass@ip:port
  ip TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password TEXT,
  protocol TEXT DEFAULT 'http',
  provider TEXT NOT NULL,               -- oxylabs, brightdata, webshare, etc.
  proxy_type TEXT NOT NULL,             -- datacenter, residential, mobile, isp, rotating, static
  country TEXT,
  city TEXT,
  asn TEXT,
  score DECIMAL DEFAULT 100.0,
  healthy BOOLEAN DEFAULT true,
  consecutive_fails INT DEFAULT 0,
  success_count INT DEFAULT 0,
  fail_count INT DEFAULT 0,
  avg_latency_ms INT DEFAULT 0,
  last_used TIMESTAMP,
  last_success TIMESTAMP,
  last_fail TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(ip, port, provider)
);

CREATE TABLE proxy_usage_logs (
  id SERIAL PRIMARY KEY,
  proxy_id INT REFERENCES proxies(id) ON DELETE SET NULL,
  target_domain TEXT NOT NULL,
  target_url TEXT,
  script_id TEXT,
  geo_required TEXT,
  status TEXT NOT NULL CHECK (status IN ('success', 'blocked', 'timeout', 'captcha', 'slow', 'error')),
  latency_ms INT,
  http_status INT,
  notes TEXT,
  training_json JSONB,                  -- Full training-ready example
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE routing_rules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  target_pattern TEXT,                  -- e.g., "%.amazon.com"
  script_id TEXT,
  geo_required TEXT,
  preferred_provider TEXT,
  preferred_type TEXT,
  forbidden_provider TEXT,
  forbidden_type TEXT,
  priority INT DEFAULT 1,
  active BOOLEAN DEFAULT true,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for speed
CREATE INDEX idx_proxies_healthy_score ON proxies(healthy, score DESC);
CREATE INDEX idx_logs_target ON proxy_usage_logs(target_domain, created_at DESC);
CREATE INDEX idx_performance_provider ON provider_performance(provider, proxy_type);
CREATE INDEX idx_rules_target ON routing_rules(target_pattern);