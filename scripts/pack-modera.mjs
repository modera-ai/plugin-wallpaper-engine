import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const buildRoot = dirname(require.resolve("@modera/plugin-build"));
const { readPackageTree, decodePackage } = require(
  join(buildRoot, "package-codec.cjs"),
);
const { requiredHostCapabilities } = require("@modera/contracts");
const manifest = JSON.parse(await readFile(join(root, "plugin.json"), "utf8"));
manifest.requiresHost = requiredHostCapabilities(manifest);
const tree = await readPackageTree(join(root, "dist"));
const files = Object.fromEntries(
  Object.entries(tree).map(([name, data]) => [
    "dist/" + name,
    data.toString("base64"),
  ]),
);
files["plugin.json"] = Buffer.from(JSON.stringify(manifest)).toString("base64");
for (const name of ["LICENSE", "NOTICE"])
  files[name] = (await readFile(join(root, name))).toString("base64");
const bytes = gzipSync(
  JSON.stringify({
    format: 1,
    compatibility: {
      minHostVersion: "0.1.0",
      maxHostVersion: "999999.0.0",
      platforms: ["any"],
    },
    files,
  }),
  { level: 9 },
);
// Validate the exact deliverable with the same decoder used by the desktop installer.
decodePackage(bytes);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const output = join(
  root,
  "release",
  `${manifest.id}-${manifest.version}-${sha256.slice(0, 12)}.moderax`,
);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(output);
console.log(`SHA-256: ${sha256}`);
