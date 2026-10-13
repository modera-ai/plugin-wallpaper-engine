import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const host = resolve(
  process.env.MODERA_HOST_WORKSPACE || join(root, "../../modera"),
);
const hostRequire = createRequire(join(host, "modera-app/package.json"));
const { _electron: electron, expect } = hostRequire("@playwright/test");
const data = await mkdtemp(join(tmpdir(), "modera-wallpaper-desktop-"));
const pluginRoot = join(data, "plugins/plugin-wallpaper-engine");
await mkdir(pluginRoot, { recursive: true });
const packageArg = process.argv.indexOf("--package");
if (packageArg >= 0) {
  const buildRequire = createRequire(join(root, "package.json"));
  const codecPath = join(
    dirname(buildRequire.resolve("@modera/plugin-build")),
    "package-codec.cjs",
  );
  const { decodePackage } = buildRequire(codecPath);
  const decoded = decodePackage(
    await readFile(resolve(process.argv[packageArg + 1])),
  );
  for (const [name, bytes] of Object.entries(decoded.files)) {
    const target = join(pluginRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  console.log("Testing decoded .moderax deliverable");
} else {
  for (const name of ["dist", "plugin.json", "LICENSE", "NOTICE"])
    await cp(join(root, name), join(pluginRoot, name), { recursive: true });
}
const config = join(data, "default.yml");
await writeFile(
  config,
  "version: 1\nprofile: default\nprofiles:\n  default:\n    plugins:\n      modera.wallpaper-engine: { enabled: true }\n",
);
const steam = join(data, "steam");
const web = join(steam, "steamapps/workshop/content/431960/990101");
await mkdir(web, { recursive: true });
await mkdir(join(steam, "steamapps/common/wallpaper_engine"), {
  recursive: true,
});
await writeFile(
  join(steam, "steamapps/common/wallpaper_engine/wallpaper64.exe"),
  "fixture",
);
await writeFile(
  join(web, "project.json"),
  JSON.stringify({
    title: "Modera live web test",
    type: "web",
    file: "index.html",
    preview: "preview.png",
    contentrating: "Everyone",
  }),
);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
await writeFile(join(web, "preview.png"), png);
await writeFile(
  join(web, "index.html"),
  `<!doctype html><html><body style="margin:0;background:#18484f;color:white"><canvas id="art"></canvas><script>
  window.wallpaperPropertyListener={applyUserProperties(){},applyGeneralProperties(){}};
  const canvas=document.getElementById('art');canvas.width=innerWidth;canvas.height=innerHeight;const ctx=canvas.getContext('2d');let n=0;
  function paint(){ctx.fillStyle='#18484f';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#69b6ba';ctx.beginPath();ctx.arc(canvas.width/2+Math.sin(n++/30)*90,canvas.height/2,110,0,Math.PI*2);ctx.fill();requestAnimationFrame(paint)}paint();
</script></body></html>`,
);
const scene = join(steam, "steamapps/workshop/content/431960/990102");
await mkdir(scene, { recursive: true });
await writeFile(join(scene, "preview.png"), png);
await writeFile(
  join(scene, "project.json"),
  JSON.stringify({
    title: "Modera scene test",
    type: "scene",
    file: "scene.json",
    preview: "preview.png",
    contentrating: "Everyone",
  }),
);
await writeFile(
  join(scene, "scene.json"),
  JSON.stringify({
    camera: { center: "0 0 0", eye: "0 0 1", up: "0 1 0" },
    general: {
      ambientcolor: "1 1 1",
      clearcolor: "0.12 0.18 0.27",
      orthogonalprojection: { width: 1280, height: 720 },
    },
    objects: [],
  }),
);
const screenshots = join(root, ".test-cache/modera-desktop");
await mkdir(screenshots, { recursive: true });
const env = {
  ...process.env,
  MODERA_TEST_DATA: data,
  MODERA_DATA_DIR: data,
  MODERA_DEFAULT_CONFIG: config,
  MODERA_PLUGINS_DIR: join(data, "plugins"),
  MODERA_TRUSTED_CORE_PLUGINS_DIR: join(data, "plugins"),
  ELECTRON_RENDERER_URL: "",
  DSH_WE_STEAM_ROOT: steam,
  DSH_WE_MEDIA_PROVIDER: "mock",
  DSH_WE_MEDIA_NO_AUDIO: "1",
};
env.MODERA_WALLPAPER_STEAM_ROOT = steam;
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [join(host, "modera-app/core/tests/desktop/bootstrap.mjs")],
  env,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  const cspErrors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Content Security Policy")
    )
      cspErrors.push(message.text().slice(0, 200));
    if (message.type() === "error")
      console.log("renderer:", message.text().slice(0, 400));
  });
  page.on("requestfailed", (request) =>
    console.log(
      "request failed:",
      request
        .url()
        .replace(/\/session\/[a-f0-9]+/g, "/session/<redacted>")
        .slice(0, 250),
      request.failure()?.errorText,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      console.log(
        "HTTP",
        response.status(),
        response
          .url()
          .replace(/\/session\/[a-f0-9]+/g, "/session/<redacted>")
          .slice(0, 240),
      );
  });
  await expect(page.locator(".we-rope")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator(".we-rope")).toBeVisible();
  await expect(page.locator(".modera-we-launcher, .modera-we-settings")).toHaveCount(0);
  const notice = page.getByRole("button", { name: "知道了", exact: true });
  if (await notice.count()) await notice.click();
  const nudge = page.getByRole("button", { name: "保持我的设置", exact: true });
  if (await nudge.count()) await nudge.click();
  await page.locator(".we-rope").press("Enter");
  await expect(page.locator('.panel-region-right .host-injection-panel[data-host-injection-panel="modera.wallpaper-engine"]')).toBeVisible();
  await expect(page.locator(".we-repo-panel--open")).toHaveCount(0);
  await page.locator(".host-injection-panel .we-qp__settings").click();
  await expect(page.locator(".host-injection-panel .modera-we-settings-content")).toBeVisible();
  for (const name of ["壁纸库", "外观", "播放", "系统", "扩展", "关于"])
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: join(screenshots, "settings.png") });
  await page.getByRole("button", { name: "选择壁纸", exact: true }).click();
  await expect(
    page.getByText("Modera live web test", { exact: true }).first(),
  ).toBeVisible({ timeout: 30000 });
  // Use the real upstream picker to select the wallpaper.
  await page.getByText("Modera live web test", { exact: true }).first().click();
  await page.locator(".modera-we-back").click();
  await expect(page.locator(".modera-we-settings-content")).toHaveCount(0);
  await page.locator(".we-rope").press("Enter");
  await expect(page.locator("body")).toHaveAttribute(
    "data-we-wallpaper",
    /.+/,
    { timeout: 20000 },
  );
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frame = document.querySelector(".we-live-iframe");
          try {
            return (
              frame?.contentWindow?.__wp?.getState()?.kind ||
              frame?.contentWindow?.__wpStats?.frame()?.running ||
              null
            );
          } catch {
            return null;
          }
        }),
      { timeout: 30000 },
    )
    .toBeTruthy();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const nested = document
            .querySelector(".we-live-iframe")
            ?.contentDocument?.querySelector("iframe");
          return nested?.getAttribute("sandbox") || "";
        }),
      { timeout: 30000 },
    )
    .toBe("allow-scripts");
  const webFrame = page
    .frames()
    .find((frame) => frame.url().includes("/scene-files/"));
  assert.ok(
    webFrame,
    "Wallpaper runs as a separate HTTP document, not a CSP-inheriting blob",
  );
  await expect
    .poll(() =>
      webFrame.evaluate(
        () =>
          document
            .getElementById("art")
            ?.getContext("2d")
            ?.getImageData(0, 0, 1, 1).data[1],
      ),
    )
    .toBe(72);
  await assert.rejects(webFrame.evaluate(() => parent.document.body.innerText));
  await expect
    .poll(
      () =>
        page
          .locator(".we-layer .we-live-iframe")
          .evaluate((frame) => Number(getComputedStyle(frame).opacity)),
      { timeout: 30000 },
    )
    .toBe(1);
  const verifyGlassAndSidebar = async (name) => {
    const surfaces = await page.evaluate(() =>
      [
        ".app-sidebar",
        ".app-sidebar .project-picker",
        ".empty-state",
        ".composer",
      ].map((selector) => {
        const node = document.querySelector(selector);
        return [selector, node && getComputedStyle(node).backgroundColor];
      }),
    );
    for (const [selector, color] of surfaces) {
      assert.ok(color, `${selector} must exist`);
      assert.match(
        color,
        /(?:rgba|color\()/,
        `${selector} must use transparency: ${color}`,
      );
    }
    await page.locator(".we-rope").focus();
    await page.locator(".we-rope").press("Enter");
    await expect(page.locator('.panel-region-right .host-injection-panel[data-host-injection-panel="modera.wallpaper-engine"]')).toBeVisible();
    await expect(page.locator(".we-repo-panel--open")).toHaveCount(0);
    await page.screenshot({
      path: join(screenshots, `glass-sidebar-${name}.png`),
    });
    await page.locator(".window-titlebar").evaluate((node) => {
      node.style.height = "56px";
      node.style.minHeight = "56px";
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          parseFloat(
            document.body.style.getPropertyValue("--modera-we-titlebar-bottom"),
          ),
        ),
      )
      .toBe(56);
    await page.locator(".we-rope").press("Enter");
    await expect(page.locator('.panel-region-right .host-injection-panel[data-host-injection-panel="modera.wallpaper-engine"]')).toHaveCount(0);
  };
  await verifyGlassAndSidebar("light");
  await page.screenshot({ path: join(screenshots, "live-web.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "主题设置", exact: true }).click();
  await page.getByRole("tab", { name: "深色", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-ds-dark-theme", "");
  await page.getByRole("button", { name: "主页", exact: true }).click();
  await verifyGlassAndSidebar("dark");
  await page.screenshot({ path: join(screenshots, "live-web-dark.png") });
  await page.locator(".we-rope").press("Enter");
  await page.locator(".host-injection-panel .we-qp__settings").click();
  await page.getByRole("button", { name: "选择壁纸", exact: true }).click();
  await page.getByText("Modera scene test", { exact: true }).first().click();
  await page.locator(".modera-we-back").click();
  await page.locator(".we-rope").press("Enter");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document
              .querySelector(".we-layer .we-live-iframe")
              ?.contentWindow?.__wp?.getState()?.type,
        ),
      { timeout: 30000 },
    )
    .toBe("scene");
  await expect
    .poll(
      () =>
        page
          .locator(".we-layer .we-live-iframe")
          .evaluate((frame) => Number(getComputedStyle(frame).opacity)),
      { timeout: 30000 },
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector(".we-layer .we-live-iframe")
            ?.contentWindow?.__wp?.capture(64)?.length || 0,
      ),
    )
    .toBeGreaterThan(100);
  await page.screenshot({ path: join(screenshots, "scene.png") });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "主题设置", exact: true }).click();
  await page.getByRole("tab", { name: "浅色", exact: true }).click();
  await page.getByRole("button", { name: "主页", exact: true }).click();
  const before = await page.evaluate(() => {
    const desktop = document.querySelector(".desktop-appearance");
    return {
      background: getComputedStyle(desktop).backgroundColor,
      body: document.body.getAttribute("data-we-wallpaper"),
    };
  });
  assert.equal(before.background, "rgba(0, 0, 0, 0)");
  // Import an image through the retained host route, then choose it in the original UI.
  const projectId = await page.evaluate(
    async () => (await window.modera.projects.list()).activeId,
  );
  const connection = await page.evaluate(
    async (projectId) =>
      (
        await window.modera.plugins.uiRequest({
          id: "modera.wallpaper-engine.connection",
          projectId,
          sessionId: "",
          locale: "zh-CN",
        })
      ).data,
    projectId,
  );
  await page.locator(".we-rope").press("Enter");
  await page.locator(".host-injection-panel .we-qp__settings").click();
  await expect(page.locator(".modera-we-settings-content")).toBeVisible();
  await page
    .locator(".modera-we-settings-content input[type=file]")
    .first()
    .setInputFiles({
      name: "Modera image test.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(
    page.getByText("Modera image test", { exact: true }).first(),
  ).toBeVisible({ timeout: 15000 });
  await page.locator(".modera-we-back").click();
  await page.locator(".we-rope").press("Enter");
  await expect(page.locator(".we-layer img.we-media")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".we-layer img.we-media")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".we-layer img.we-media")).toBeVisible({
    timeout: 30000,
  });
  const persisted = JSON.parse(
    await readFile(
      join(data, "plugin-storage/modera.wallpaper-engine/config.json"),
      "utf8",
    ),
  );
  assert.ok(persisted.settings.id.startsWith("up-"));
  await page.screenshot({ path: join(screenshots, "image.png") });
  const movie = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(10);
    if (!MediaRecorder.isTypeSupported("video/mp4"))
      throw new Error("Desktop cannot record the MP4 test fixture");
    const recorder = new MediaRecorder(stream, { mimeType: "video/mp4" });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const result = new Promise(
      (resolve) =>
        (recorder.onstop = async () =>
          resolve(
            Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())),
          )),
    );
    let n = 0;
    const timer = setInterval(() => {
      context.fillStyle = n++ % 2 ? "#69b6ba" : "#18484f";
      context.fillRect(0, 0, 64, 64);
    }, 100);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    recorder.stop();
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    return result;
  });
  await page.locator(".we-rope").press("Enter");
  await page.locator(".host-injection-panel .we-qp__settings").click();
  await page
    .locator(".modera-we-settings-content input[type=file]")
    .first()
    .setInputFiles({
      name: "Modera video test.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.from(movie),
    });
  await expect
    .poll(
      () =>
        page
          .locator(".we-layer video.we-media")
          .evaluate((video) => video.currentTime),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".we-layer video.we-media")
        .evaluate((video) => video.paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".we-layer video.we-media")
        .evaluate((video) => video.paused),
    )
    .toBe(false);
  await page.locator(".modera-we-back").click();
  await page.locator(".we-rope").press("Enter");
  await page.screenshot({ path: join(screenshots, "video.png") });
  // Disable through the actual host preferences API: scripts, CSS and server must disappear.
  await page.evaluate(async (projectId) => {
    const result = await window.modera.plugins.prepareEnable(
      "modera.wallpaper-engine",
      null,
      false,
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    const changed = await window.modera.plugins.setEnabled(
      "modera.wallpaper-engine",
      null,
      false,
      result.value.token,
    );
    if (!changed.ok) throw new Error(JSON.stringify(changed));
  }, projectId);
  await expect(page.locator(".host-injection-panel")).toHaveCount(0);
  await expect(
    page.locator(".we-layer, #dsh-wallpaper-engine-rope-dock"),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute(
    "data-modera-wallpaper",
    "on",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(cspErrors, []);
  console.log(
    "PASS: original six-tab UI, rope dock, live sandboxed web wallpaper, scene rendering/capture, theme changes, image/MP4 upload, video playback/pause, restart persistence and disable cleanup",
  );
  console.log("Screenshots:", screenshots);
} catch (error) {
  const page = await app.firstWindow();
  console.log((await page.locator("body").innerText()).slice(-5000));
  await page.screenshot({ path: join(screenshots, "failure.png") });
  throw error;
} finally {
  await app.close();
}
