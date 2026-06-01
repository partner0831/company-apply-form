import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8080;
const APPLY_URL =
  "https://kibjbsigxbqpfhqqarbo.supabase.co/functions/v1/apply";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, "web");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  const buf = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
  });
  res.end(buf);
}

function proxyApply(req, res) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  const upstream = https.request(APPLY_URL, {
    method: "POST",
    headers,
  });

  upstream.on("response", (upRes) => {
    const chunks = [];
    upRes.on("data", (c) => chunks.push(c));
    upRes.on("end", () => {
      const body = Buffer.concat(chunks);
      res.writeHead(upRes.statusCode, {
        "Content-Type": upRes.headers["content-type"] || "text/plain; charset=utf-8",
        "Content-Length": body.length,
      });
      res.end(body);
    });
  });

  upstream.on("error", (err) => {
    send(res, 502, `Proxy error: ${err.message}`);
  });

  req.pipe(upstream);
}

function serveStatic(req, res) {
  let rel = req.url === "/" ? "index.html" : req.url.split("?")[0];
  rel = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = path.join(WEB_ROOT, rel);

  if (!filePath.startsWith(WEB_ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": data.length,
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/apply") {
    proxyApply(req, res);
    return;
  }
  if (req.method !== "GET") {
    send(res, 405, "Method not allowed");
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Application form: http://localhost:${PORT}/`);
  console.log("Press Ctrl+C to stop.");
});
