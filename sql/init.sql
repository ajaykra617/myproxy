CREATE TABLE IF NOT EXISTS proxies (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  port INT NOT NULL,
  username TEXT,
  password TEXT,
  protocol TEXT DEFAULT 'http',
  provider TEXT,
  region TEXT DEFAULT 'global',
  type TEXT DEFAULT 'internal',
  owner_id TEXT,
  score INT DEFAULT 100,
  healthy BOOLEAN DEFAULT true,
  last_checked TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS proxy_usage (
  id SERIAL PRIMARY KEY,
  proxy_id INT REFERENCES proxies(id),
  project TEXT,
  status TEXT,
  latency_ms INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
