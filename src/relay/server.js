// src/relay/server.js
// TCP proxy relay — tunnels client traffic to the real upstream provider.
// Clients connect using a short-lived token as the proxy username.
// The real provider URL is never exposed to the client.
//
// Supports:
//   - HTTP CONNECT  (HTTPS, SOCKS-over-HTTP tunneling)
//   - Plain HTTP    (standard HTTP proxy forwarding)

import http from "http";
import net  from "net";
import { redis }  from "../db/redis.js";
import { logger } from "../utils/logger.js";
import { config } from "../utils/config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract the relay token from the Proxy-Authorization header.
// Clients set the proxy as:  http://TOKEN:x@relay-host:8080
// so the token is always the username part of Basic auth.
function extractToken(req) {
  const auth = req.headers["proxy-authorization"];
  if (!auth?.startsWith("Basic ")) return null;
  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  return decoded.split(":")[0] || null;
}

// Look up the session stored by the API when it issued the token.
async function resolveSession(token) {
  try {
    const raw = await redis.get(`relay:${token}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    logger.error("Redis relay lookup failed:", e.message);
    return null;
  }
}

// Parse the real upstream proxy URL into host / port / auth-header.
function parseUpstream(proxyUrl) {
  const u = new URL(proxyUrl);
  const username = u.username ? decodeURIComponent(u.username) : null;
  const password = u.password ? decodeURIComponent(u.password) : null;
  return {
    host: u.hostname,
    port: parseInt(u.port, 10),
    authHeader: username
      ? `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
      : null,
  };
}

function deny(socket, statusLine) {
  try {
    socket.write(`${statusLine}\r\nContent-Length: 0\r\n\r\n`);
  } catch {}
  socket.destroy();
}

// ── Relay server ──────────────────────────────────────────────────────────────

const server = http.createServer();

// ── HTTPS: HTTP CONNECT tunnel ────────────────────────────────────────────────
//
// Flow:
//   1. Client sends:  CONNECT target:443 HTTP/1.1  (with our token in Proxy-Authorization)
//   2. We look up the real proxy from Redis by token
//   3. We open a TCP connection to the real proxy
//   4. We send CONNECT target:443 to the real proxy (with real credentials)
//   5. Real proxy replies 200 → we reply 200 to client
//   6. Raw bytes flow:  client ↔ our socket ↔ real proxy socket
//      No HTTP parsing after this — pure byte forwarding (~zero overhead)

server.on("connect", async (req, clientSocket, head) => {
  const token = extractToken(req);
  if (!token) {
    return deny(clientSocket, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"relay\"");
  }

  const session = await resolveSession(token);
  if (!session) {
    return deny(clientSocket, "HTTP/1.1 403 Forbidden");
  }

  const up = parseUpstream(session.proxy_url);
  const upSock = net.connect(up.port, up.host);

  upSock.once("connect", () => {
    // Forward the CONNECT request to the real upstream proxy
    let msg = `CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n`;
    if (up.authHeader) msg += `Proxy-Authorization: ${up.authHeader}\r\n`;
    msg += "\r\n";
    upSock.write(msg);

    // Buffer the upstream response until we have the full header block
    let buf = Buffer.alloc(0);

    upSock.on("data", function onHeader(chunk) {
      buf = Buffer.concat([buf, chunk]);
      const str = buf.toString();
      const sep  = str.indexOf("\r\n\r\n");
      if (sep === -1) return; // keep buffering

      upSock.removeListener("data", onHeader);
      const statusLine = str.split("\r\n")[0];

      if (statusLine.includes("200")) {
        // Tell the client the tunnel is open
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

        // Any bytes after the header in the first chunk go to the client
        const afterHeader = buf.slice(sep + 4);
        if (afterHeader.length) clientSocket.write(afterHeader);
        if (head.length)        upSock.write(head);

        // Pure byte forwarding from here on
        clientSocket.pipe(upSock);
        upSock.pipe(clientSocket);
      } else {
        logger.warn(`Upstream rejected CONNECT for token ${token.slice(0, 8)}…: ${statusLine}`);
        deny(clientSocket, "HTTP/1.1 502 Bad Gateway");
        upSock.destroy();
      }
    });
  });

  // Error / cleanup handling
  upSock.on("error", (e) => {
    logger.error(`Relay upstream connect error: ${e.message}`);
    deny(clientSocket, "HTTP/1.1 502 Bad Gateway");
  });

  clientSocket.on("error", () => upSock.destroy());
  upSock.on("close",       () => { try { clientSocket.destroy(); } catch {} });
  clientSocket.on("close", () => { try { upSock.destroy();       } catch {} });
});

// ── Plain HTTP proxy ──────────────────────────────────────────────────────────
//
// Flow:
//   1. Client sends full-URI request:  GET http://example.com/path HTTP/1.1
//   2. We look up the real proxy and forward the request there
//   3. We stream the response back to the client

server.on("request", async (req, res) => {
  // Only accept absolute-URI (proxy) requests
  if (!req.url.startsWith("http")) {
    res.writeHead(400); return res.end("Bad Request");
  }

  const token = extractToken(req);
  if (!token) {
    res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="relay"' });
    return res.end();
  }

  const session = await resolveSession(token);
  if (!session) {
    res.writeHead(403); return res.end("Forbidden");
  }

  const up = parseUpstream(session.proxy_url);
  const targetUrl = new URL(req.url);

  // Build headers for the upstream request — swap our auth for theirs
  const headers = { ...req.headers, host: targetUrl.host };
  delete headers["proxy-authorization"];
  if (up.authHeader) headers["proxy-authorization"] = up.authHeader;

  const upReq = http.request(
    { host: up.host, port: up.port, method: req.method, path: req.url, headers },
    (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    }
  );

  upReq.on("error", (e) => {
    logger.error(`HTTP relay error: ${e.message}`);
    if (!res.headersSent) { res.writeHead(502); }
    res.end("Bad Gateway");
  });

  req.pipe(upReq);
});

// ── Start ─────────────────────────────────────────────────────────────────────

export function startRelay() {
  const port = config.relayPort;
  server.listen(port, () => logger.info(`Proxy relay listening on port ${port}`));
  return server;
}
