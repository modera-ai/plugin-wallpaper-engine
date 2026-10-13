import React from "react";
import { createRoot } from "react-dom/client";
import { createPortal, flushSync } from "react-dom";
import { createUpstream } from "../dist/generated/upstream-client.js";

export default async function mount({ pluginId, projectId, setTheme, signal }) {
  const connection = await window.modera.plugins.uiRequest({
    id: "modera.wallpaper-engine.connection",
    projectId,
    sessionId: "",
    locale: document.documentElement.lang || "zh-CN",
  });
  if (signal.aborted) return;
  const { endpoint, capability } = connection.data;
  if (!/^http:\/\/127\.0\.0\.1:\d+\/session\/[a-f0-9]{64}$/.test(endpoint))
    throw new Error("Invalid wallpaper endpoint");
  const nativeFetch = window.fetch.bind(window);
  const fetchHost = (url, options = {}) => {
    const headers = new Headers(options.headers);
    if (String(url).startsWith(endpoint + "/"))
      headers.set("X-Modera-Wallpaper", capability);
    return nativeFetch(url, {
      ...options,
      headers,
      signal: options.signal
        ? AbortSignal.any([signal, options.signal])
        : signal,
    });
  };
  const cleanups = [];
  const blobUrls = new Set();
  let rendererTask;
  const blob = (content, type) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    blobUrls.add(url);
    return url;
  };
  const moderaHost = {
    endpoint,
    fetch: fetchHost,
    signal,
    openSettings() {
      panelMode = "settings";
      openPanel();
      renderPanel();
    },
    fontComponents: {
      markdown: "body[data-modera-wallpaper] .mu-markdown",
      codeBlock:
        "body[data-modera-wallpaper] .mu-markdown pre, body[data-modera-wallpaper] .mu-markdown pre code",
      table:
        "body[data-modera-wallpaper] .mu-markdown table, body[data-modera-wallpaper] .mu-markdown td, body[data-modera-wallpaper] .mu-markdown th",
      terminal: "body[data-modera-wallpaper] .mu-agent-terminal pre",
    },
    async loadLiveFrame(frame, path) {
      // A trusted, bundled renderer shares the parent origin, preserving upstream __wp calls.
      // Only the third-party wallpaper runs in a nested opaque-origin sandbox.
      const search = new URL(path, endpoint).search;
      const request = String(
        Number(frame.dataset.moderaRendererRequest || 0) + 1,
      );
      frame.dataset.moderaRendererRequest = request;
      rendererTask ??= fetchHost(
        endpoint + "/wallpaper-engine/scene-live/assets/modera-renderer.js",
        { signal },
      )
        .then((response) => {
          if (!response.ok) throw new Error("Wallpaper renderer unavailable");
          return response.text();
        })
        .catch((error) => {
          rendererTask = undefined;
          throw error;
        });
      let rendererSource;
      try {
        rendererSource = await rendererTask;
      } catch (error) {
        if (!signal.aborted) console.error(error);
        return;
      }
      if (signal.aborted || frame.dataset.moderaRendererRequest !== request)
        return;
      const prelude = `globalThis.__moderaWallpaperSearch=${JSON.stringify(search)};globalThis.__moderaWallpaperOrigin=${JSON.stringify(endpoint)};
        const hostBase=${JSON.stringify(endpoint)},hostKey=${JSON.stringify(capability)},realFetch=globalThis.fetch.bind(globalThis);
        globalThis.fetch=(input,init={})=>{let url=typeof input==='string'?input:input.url;
          if(url.startsWith('/'))url=hostBase+url;
          const headers=new Headers(init.headers||(typeof input==='object'?input.headers:undefined));
          if(url.startsWith(hostBase+'/'))headers.set('X-Modera-Wallpaper',hostKey);
          return realFetch(url,{...init,headers});};\n`;
      const source = blob(prelude + rendererSource, "text/javascript");
      const previous = frame.dataset.moderaRendererBlob;
      if (previous) {
        URL.revokeObjectURL(previous);
        blobUrls.delete(previous);
      }
      frame.dataset.moderaRendererBlob = source;
      frame.srcdoc = `<!doctype html><html><head><meta charset="UTF-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#101418}</style><script type="module" src="${source}"></script></head><body></body></html>`;
    },
    suspendLiveFrame(frame) {
      frame.dataset.moderaRendererRequest = String(
        Number(frame.dataset.moderaRendererRequest || 0) + 1,
      );
      frame.removeAttribute("srcdoc");
      const url = frame.dataset.moderaRendererBlob;
      if (url) {
        URL.revokeObjectURL(url);
        blobUrls.delete(url);
        delete frame.dataset.moderaRendererBlob;
      }
    },
  };
  const tokens = new Map();
  const tokenBaselines = new Map();
  const applyTokens = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    for (const token of tokenBaselines.keys()) {
      let value;
      for (const layer of tokens.values())
        if (layer[token]) value = layer[token][dark ? "dark" : "light"];
      const original = tokenBaselines.get(token);
      if (value) document.body.style.setProperty(token, value);
      else if (original.value)
        document.body.style.setProperty(
          token,
          original.value,
          original.priority,
        );
      else document.body.style.removeProperty(token);
    }
  };
  const theme = {
    getTheme: () => {
      let preference;
      try {
        preference = JSON.parse(localStorage.getItem("modera.theme"))?.mode;
      } catch {
        /* first run */
      }
      return {
        preference: ["system", "light", "dark"].includes(preference)
          ? preference
          : document.documentElement.dataset.theme || "light",
      };
    },
    setTheme: (mode) => setTheme(mode),
    overrideTokens(source, payload) {
      for (const token of Object.keys(payload))
        if (!tokenBaselines.has(token))
          tokenBaselines.set(token, {
            value: document.body.style.getPropertyValue(token),
            priority: document.body.style.getPropertyPriority(token),
          });
      tokens.set(source, payload);
      applyTokens();
      return () => {
        if (tokens.get(source) === payload) {
          tokens.delete(source);
          applyTokens();
        }
      };
    },
  };
  const locale = {
    getSnapshot: () => ({
      active: (
        document.documentElement.lang ||
        localStorage.getItem("modera.locale") ||
        "zh-CN"
      ).startsWith("zh")
        ? "zh"
        : "en",
    }),
    register: () => () => {},
    subscribe(callback) {
      const observer = new MutationObserver(callback);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"],
      });
      return () => observer.disconnect();
    },
  };
  const themeListeners = new Set();
  const syncTheme = () => {
    document.body.toggleAttribute(
      "data-ds-dark-theme",
      document.documentElement.dataset.theme === "dark",
    );
    applyTokens();
    for (const listener of themeListeners) listener();
  };
  const oldDark = document.body.hasAttribute("data-ds-dark-theme");
  const themeObserver = new MutationObserver(syncTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  cleanups.push(() => {
    themeObserver.disconnect();
    document.body.toggleAttribute("data-ds-dark-theme", oldDark);
    tokens.clear();
    applyTokens();
  });
  syncTheme();

  // The upstream drawer covers the viewport; Modera reserves a native titlebar.
  const titlebarOffset = "--modera-we-titlebar-bottom";
  const previousOffset = document.body.style.getPropertyValue(titlebarOffset);
  const previousPriority =
    document.body.style.getPropertyPriority(titlebarOffset);
  let titlebar;
  const syncTitlebar = () => {
    const next = document.querySelector(".window-titlebar");
    if (next !== titlebar) {
      if (titlebar) titlebarObserver.unobserve(titlebar);
      titlebar = next;
      if (titlebar) titlebarObserver.observe(titlebar);
    }
    document.body.style.setProperty(
      titlebarOffset,
      `${Math.max(0, titlebar?.getBoundingClientRect().bottom ?? 0)}px`,
    );
  };
  const titlebarObserver = new ResizeObserver(syncTitlebar);
  const titlebarTreeObserver = new MutationObserver(syncTitlebar);
  titlebarTreeObserver.observe(document.getElementById("root"), {
    childList: true,
    subtree: true,
  });
  window.addEventListener("resize", syncTitlebar);
  syncTitlebar();
  cleanups.push(() => {
    titlebarObserver.disconnect();
    titlebarTreeObserver.disconnect();
    window.removeEventListener("resize", syncTitlebar);
    if (previousOffset)
      document.body.style.setProperty(
        titlebarOffset,
        previousOffset,
        previousPriority,
      );
    else document.body.style.removeProperty(titlebarOffset);
  });

  // Supply the semantic anchors the retained avatar/parallax modules expect.
  const annotated = new Map();
  const anchors = [
    [".messages", "data-slot", "conversation.view"],
    [".sidebar", "data-slot", "sidebar"],
    [".composer", "data-composer-card", ""],
  ];
  const annotate = (scope) => {
    for (const [selector, attribute, value] of anchors) {
      const nodes = [
        ...(scope.matches?.(selector) ? [scope] : []),
        ...scope.querySelectorAll(selector),
      ];
      for (const node of nodes)
        if (!node.hasAttribute(attribute)) {
          node.setAttribute(attribute, value);
          if (!annotated.has(node)) annotated.set(node, []);
          annotated.get(node).push(attribute);
        }
    }
    for (const node of annotated.keys())
      if (!node.isConnected) annotated.delete(node);
  };
  annotate(document);
  const anchorObserver = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === 1) annotate(node);
  });
  anchorObserver.observe(document.getElementById("root"), {
    subtree: true,
    childList: true,
  });
  cleanups.push(() => {
    anchorObserver.disconnect();
    for (const [node, attrs] of annotated)
      for (const attr of attrs) node.removeAttribute(attr);
  });

  let section;
  let panelRender;
  let panelMode = "library";
  let panelTarget;
  let panelRoot;
  let upstream;
  const panelId = "modera.wallpaper-engine";
  const panelIsActive = () => Boolean(panelTarget?.closest(".panel-region-right:not([data-hidden])")
    && !panelTarget.closest("[role=tabpanel]")?.hidden);
  const openPanel = () => window.dispatchEvent(new CustomEvent("modera:host-panel-open", {
    detail: { id: panelId, title: "壁纸" },
  }));
  const closePanel = () => window.dispatchEvent(new CustomEvent("modera:host-panel-close", {
    detail: { id: panelId },
  }));
  const renderPanel = () => {
    if (!panelRoot) return;
    if (panelMode === "settings" && section) {
      panelRoot.render(React.createElement("div", { className: "modera-we-settings-content" },
        React.createElement("button", {
          type: "button", className: "modera-we-back",
          onClick: () => { upstream?.moderaCloseSettings(); panelMode = "library"; renderPanel(); },
        }, "← 壁纸库"), section()));
    } else if (panelRender) panelRoot.render(panelRender());
  };
  const syncPanelTarget = () => {
    const next = document.querySelector('[data-host-injection-panel="modera.wallpaper-engine"]');
    if (next === panelTarget) return;
    if (panelRoot) panelRoot.unmount();
    panelTarget = next;
    panelRoot = next ? createRoot(next) : null;
    renderPanel();
  };
  const panelObserver = new MutationObserver(syncPanelTarget);
  panelObserver.observe(document.getElementById("root"), { childList: true, subtree: true });
  syncPanelTarget();
  cleanups.push(() => {
    panelObserver.disconnect();
    upstream?.moderaCloseSettings();
    panelRoot?.unmount();
    panelRoot = null;
    closePanel();
  });
  const ctx = {
    effect(callback) {
      const cleanup = callback();
      if (typeof cleanup === "function") cleanups.push(cleanup);
    },
    get(name) {
      if (name === "sidebarRightTabs") return { register: () => () => {} };
      if (name === "sidebarRight") return {
        openTab: () => { panelMode = "library"; openPanel(); renderPanel(); },
        isExpanded: panelIsActive,
        active: () => panelIsActive() ? { kind: "wallpaper-library" } : null,
        toggleExpanded: closePanel,
      };
      return name === "theme" ? theme : name === "locale" ? locale : undefined;
    },
    on(name, callback) {
      if (name === "theme/change") themeListeners.add(callback);
      const off = () => themeListeners.delete(callback);
      cleanups.push(off);
      return off;
    },
    slots: {
      inject(name, callback) {
        if (name === "settings.section" || name === "sidebar.right.pane.tab") return callback();
      },
      register(descriptor, render) {
        if (descriptor.name === "settings.section") section = render;
        if (descriptor.name === "sidebar.right.pane.tab") panelRender = render;
        renderPanel();
        return () => {
          if (descriptor.name === "settings.section") section = undefined;
          if (descriptor.name === "sidebar.right.pane.tab") panelRender = undefined;
        };
      },
    },
  };
  document.body.setAttribute("data-modera-wallpaper", "on");
  cleanups.push(() => document.body.removeAttribute("data-modera-wallpaper"));
  const dispose = () => {
    signal.removeEventListener("abort", dispose);
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error("Wallpaper cleanup", error);
      }
    }
    for (const url of blobUrls) URL.revokeObjectURL(url);
    blobUrls.clear();
  };
  try {
    upstream = createUpstream(moderaHost, React, {
      createRoot,
      flushSync,
      createPortal,
    });
    const syncFontGate = () =>
      document.body.toggleAttribute(
        "data-modera-we-fonts",
        upstream.moderaFontCustom(),
      );
    cleanups.push(upstream.moderaSubscribe(syncFontGate));
    cleanups.push(() => document.body.removeAttribute("data-modera-we-fonts"));
    syncFontGate();
    upstream.apply(ctx);
  } catch (error) {
    dispose();
    throw error;
  }
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
