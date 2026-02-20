-- sql/seed_test.sql
-- Test proxy rows for development/smoke-testing.
-- Remove this file from docker-compose when moving to production.

-- Rotating proxy (new IP on every request)
-- DataImpulse rotating: port 823, username = login__cr.{country}
INSERT INTO proxies (
  proxy_string, ip, port, username, password,
  protocol, provider, proxy_type, session_type, country, score, healthy
) VALUES (
  'https://f02b9fb83fcfe2599938__cr.us:62b9ad13e79c2472@gw.dataimpulse.com:823',
  'gw.dataimpulse.com', 823,
  'f02b9fb83fcfe2599938__cr.us', '62b9ad13e79c2472',
  'https', 'dataimpulse', 'datacenter', 'rotating', 'US', 100, true
)
ON CONFLICT (proxy_string) DO NOTHING;

-- Sticky proxy (same IP pinned for the session)
-- DataImpulse sticky: port 10000.
-- The sessttl (session TTL in minutes) is NOT baked into the username here;
-- it is injected at request time from metadata.sessttl (or the ?ttl= API param).
INSERT INTO proxies (
  proxy_string, ip, port, username, password,
  protocol, provider, proxy_type, session_type, country, score, healthy, metadata
) VALUES (
  'http://f02b9fb83fcfe2599938__cr.us:62b9ad13e79c2472@gw.dataimpulse.com:10000',
  'gw.dataimpulse.com', 10000,
  'f02b9fb83fcfe2599938__cr.us', '62b9ad13e79c2472',
  'http', 'dataimpulse', 'datacenter', 'sticky', 'US', 100, true, '{"sessttl": 60}'
)
ON CONFLICT (proxy_string) DO NOTHING;
