import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

/** Keep upstream route handlers (including streaming/Range) behind a revocable capability. */
export async function createModeraServer(signal) {
  const routes = [];
  const capability = randomBytes(32).toString("hex");
  const mount = `/session/${randomBytes(32).toString("hex")}`;
  let endpoint;
  let inventoryChanged = () => {};
  const server = createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address()?.port}`;
    if (req.headers.host !== host || !req.url?.startsWith(mount + "/")) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    req.url = req.url.slice(mount.length);
    // JSON URLs must be rebound before compression; local streams retain upstream Range handling.
    req.headers["accept-encoding"] = "identity";
    const pathname = new URL(req.url, "http://local").pathname;
    // Third-party HTML has an opaque origin: it may read its own assets, never controls.
    const opaque = req.headers.origin === "null";
    const assets = pathname.startsWith("/wallpaper-engine/scene-files/");
    const origin = req.headers.origin;
    if (
      origin &&
      origin !== "null" &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
    ) {
      res.writeHead(403).end("Forbidden origin");
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin || "null");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Range, X-Modera-Wallpaper",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, HEAD, PUT, POST, DELETE, OPTIONS",
    );
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (opaque && !assets && req.headers["x-modera-wallpaper"] !== capability) {
      // Preflights do not contain the secret; authenticate the actual request instead.
      res.writeHead(403).end("Opaque wallpaper cannot access host controls");
      return;
    }
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-modera-wallpaper"] !== capability
    ) {
      res.writeHead(403).end("Host capability required");
      return;
    }
    // Make original inventory resource paths usable from a file/Vite renderer.
    const end = res.end.bind(res);
    res.end = (chunk, ...args) => {
      if (
        ["POST", "DELETE"].includes(req.method) &&
        res.statusCode < 300 &&
        /^\/wallpaper-engine\/(upload|remove|upload-dir|cache-dir|we-assets-dir)(\/|$)/.test(
          pathname,
        )
      )
        inventoryChanged();
      if (
        chunk &&
        String(res.getHeader("Content-Type")).includes("application/json")
      ) {
        const rewrite = (value) => {
          if (
            typeof value === "string" &&
            value.startsWith("/wallpaper-engine/")
          )
            return endpoint + value;
          if (Array.isArray(value)) return value.map(rewrite);
          if (value && typeof value === "object")
            return Object.fromEntries(
              Object.entries(value).map(([key, item]) => [key, rewrite(item)]),
            );
          return value;
        };
        try {
          chunk = JSON.stringify(rewrite(JSON.parse(String(chunk))));
          res.removeHeader("Content-Length");
        } catch {
          /* non-JSON diagnostic */
        }
      }
      return end(chunk, ...args);
    };
    const route = routes.find((entry) =>
      entry.kind === "exact"
        ? pathname === entry.path
        : pathname === entry.path ||
          pathname.startsWith(
            entry.path.endsWith("/") ? entry.path : entry.path + "/",
          ),
    );
    if (!route) {
      res.writeHead(404).end("Not found");
      return;
    }
    try {
      await route.handler(req, res);
    } catch (error) {
      console.error("Wallpaper route failed", error);
      if (!res.headersSent) res.writeHead(500);
      res.end("Wallpaper request failed");
    }
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  endpoint = `http://127.0.0.1:${server.address().port}${mount}`;
  const close = () => {
    routes.length = 0;
    server.close();
    server.closeAllConnections();
  };
  signal?.addEventListener("abort", close, { once: true });
  return {
    endpoint,
    capability,
    onInventoryMutation(callback) {
      inventoryChanged = callback;
    },
    register(route) {
      routes.push(route);
      return () => {
        const index = routes.indexOf(route);
        if (index >= 0) routes.splice(index, 1);
      };
    },
    close() {
      signal?.removeEventListener("abort", close);
      close();
    },
  };
}
