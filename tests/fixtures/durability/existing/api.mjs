import http from "node:http";
import { total } from "./pricing.mjs";
export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "GET" && req.url === "/health")
      return res.end('{"ok":true}');
    if (req.method !== "POST" || req.url !== "/quote") {
      res.statusCode = 404;
      return res.end('{"error":"Not found"}');
    }
    try {
      let body = "";
      for await (const bytes of req) body += bytes;
      res.end(JSON.stringify(total(JSON.parse(body).items)));
    } catch {
      res.statusCode = 400;
      res.end('{"error":"Invalid item"}');
    }
  });
}
