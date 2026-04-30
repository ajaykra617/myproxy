-- sql/seed_master_proxies.sql
-- Master proxy strings for production.
-- This file seeds the proxy manager with your DataImpulse master rotating strings.
-- Rotating datacenter (new IP per request)
-- DataImpulse rotating: port 823. Username uses __cr.{country} for country pin.
INSERT INTO proxies (
  proxy_string, ip, port, username, password,
  protocol, provider, proxy_type, session_type, country, score, healthy
) VALUES (
  'http://f02b9fb83fcfe2599938__cr.us:5248a1fdf3ac04ae@gw.dataimpulse.com:823',
  'gw.dataimpulse.com', 823,
  'f02b9fb83fcfe2599938__cr.us', '5248a1fdf3ac04ae',
  'http', 'dataimpulse', 'datacenter', 'rotating', 'US', 100, true
)
ON CONFLICT (proxy_string) DO NOTHING;

-- Sticky datacenter (same IP pinned for the session)
-- DataImpulse sticky gateway: port 10000.
-- sessttl is injected at request time from metadata.sessttl (or ?ttl= API param) — not stored in username.
INSERT INTO proxies (
  proxy_string, ip, port, username, password,
  protocol, provider, proxy_type, session_type, country, score, healthy, metadata
) VALUES (
  'http://f02b9fb83fcfe2599938__cr.us:5248a1fdf3ac04ae@gw.dataimpulse.com:10000',
  'gw.dataimpulse.com', 10000,
  'f02b9fb83fcfe2599938__cr.us', '5248a1fdf3ac04ae',
  'http', 'dataimpulse', 'datacenter', 'sticky', 'US', 100, true, '{"sessttl": 60}'
)
ON CONFLICT (proxy_string) DO NOTHING;

-- Rotating residential (new IP per request)
INSERT INTO proxies (
  proxy_string, ip, port, username, password,
  protocol, provider, proxy_type, session_type, score, healthy
) VALUES (
  'http://c43a64b62d856fc19378:42894c62fbb80a49@gw.dataimpulse.com:823',
  'gw.dataimpulse.com', 823,
  'c43a64b62d856fc19378', '42894c62fbb80a49',
  'http', 'dataimpulse', 'residential', 'rotating', 100, true
)
ON CONFLICT (proxy_string) DO NOTHING;
