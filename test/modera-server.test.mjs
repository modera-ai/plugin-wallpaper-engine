import test from "node:test";
import assert from "node:assert/strict";
import { createModeraServer } from "../src/modera-server.js";

test("capability routes reject unrelated origins, opaque controls and unauthenticated writes", async () => {
  const controller = new AbortController();
  const server = await createModeraServer(controller.signal);
  let calls = 0;
  server.register({
    kind: "exact",
    path: "/wallpaper-engine/settings",
    handler(_req, res) {
      calls++;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ preview: "/wallpaper-engine/preview/x" }));
    },
  });
  server.register({
    kind: "prefix",
    path: "/wallpaper-engine/scene-files",
    handler(_req, res) {
      res.end("wallpaper bytes");
    },
  });
  const url = server.endpoint + "/wallpaper-engine/settings";
  try {
    assert.equal(
      (await fetch(new URL("/wallpaper-engine/settings", url))).status,
      403,
    );
    assert.equal(
      (await fetch(url, { headers: { Origin: "https://evil.example" } }))
        .status,
      403,
    );
    assert.equal(
      (await fetch(url, { headers: { Origin: "null" } })).status,
      403,
    );
    const leakedPathKey = server.endpoint.split("/").at(-1);
    assert.notEqual(leakedPathKey, server.capability);
    assert.equal(
      (
        await fetch(url, {
          method: "PUT",
          headers: { Origin: "null", "X-Modera-Wallpaper": leakedPathKey },
          body: "{}",
        })
      ).status,
      403,
    );
    const allowed = await fetch(url, {
      headers: { Origin: "null", "X-Modera-Wallpaper": server.capability },
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), {
      preview: server.endpoint + "/wallpaper-engine/preview/x",
    });
    assert.equal((await fetch(url, { method: "PUT", body: "{}" })).status, 403);
    assert.equal(calls, 1);
    assert.equal(
      await (
        await fetch(
          server.endpoint + "/wallpaper-engine/scene-files/project/index.html",
          { headers: { Origin: "null" } },
        )
      ).text(),
      "wallpaper bytes",
    );
    assert.equal(
      (
        await fetch(server.endpoint + "/wallpaper-engine/scene-files-escape", {
          headers: { Origin: "null" },
        })
      ).status,
      403,
    );
    const preflight = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "null",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type,x-modera-wallpaper",
      },
    });
    assert.equal(preflight.status, 204);
    controller.abort();
    await assert.rejects(fetch(url));
  } finally {
    server.close();
  }
});
