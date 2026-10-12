import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createModeraServer } from "./modera-server.js";
import type { PluginContext, PluginContributions } from "@modera/plugin-sdk";

let dispose: (() => void) | undefined;

export async function activate(
  context: PluginContext,
): Promise<PluginContributions> {
  if (!context.resourcePath)
    throw new Error("Wallpaper Engine requires bundled backend resources");
  context.signal.throwIfAborted();
  const server = await createModeraServer(context.signal);
  try {
    const upstream = await import(
      pathToFileURL(join(context.resourcePath, "dist/upstream/index.js")).href
    );
    context.signal.throwIfAborted();
    const cleanup = upstream.apply({
      webServer: server,
      modera: {
        dataDir: context.storagePath,
        mediaBase: server.endpoint,
        steamRoot: process.env.MODERA_WALLPAPER_STEAM_ROOT,
      },
      logger: () => console,
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      context.signal.removeEventListener("abort", stop);
      cleanup?.();
      server.close();
    };
    dispose = stop;
    context.signal.addEventListener("abort", dispose, { once: true });
    return {
      ui: [
        {
          id: "modera.wallpaper-engine.connection",
          slot: "window.overlay",
          requiredPermissions: ["host.inject"],
          async render() {
            return {
              title: "Wallpaper Engine",
              children: [],
              data: {
                endpoint: server.endpoint,
                capability: server.capability,
              },
            };
          },
        },
      ],
    };
  } catch (error) {
    server.close();
    throw error;
  }
}

export async function deactivate() {
  dispose?.();
  dispose = undefined;
}
