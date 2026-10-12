import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("Modera ignores avatar-enabled presets and stops an existing avatar layer", async () => {
  const source = await readFile(new URL("../src/avatar-layer.js", import.meta.url), "utf8");
  const start = source.indexOf("function syncAvatarLayer() {");
  const end = source.indexOf("/** 卸载清理", start);
  let stopped = 0;
  const context = vm.createContext({
    moderaHost: {},
    selection: { avatarEnabled: true },
    weBody: () => ({}),
    avatarActive: true,
    avatarObserver: {},
    avatarStop: () => { stopped++; },
    MutationObserver: class {},
  });
  vm.runInContext(`${source.slice(start, end)}\nsyncAvatarLayer();`, context);
  assert.equal(stopped, 1);
});
