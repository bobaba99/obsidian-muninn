import esbuild from "esbuild";
import { builtinModules } from "node:module";

import fs from "node:fs";

const prod = process.argv[2] === "production";

// Obsidian's renderer exposes Node's `process`, so transformers.js believes it runs in Node and
// picks the (absent) native ONNX runtime. Force its web code path; fail the build if the line moves.
const NODE_CHECK = /var IS_NODE_ENV = [^;]+;/;
const forceWebRuntime = {
  name: "force-web-runtime",
  setup(build) {
    build.onLoad({ filter: /transformers\.web\.js$/ }, async (args) => {
      const source = await fs.promises.readFile(args.path, "utf8");
      if (!NODE_CHECK.test(source)) throw new Error("transformers.js changed: IS_NODE_ENV check not found");
      return { contents: source.replace(NODE_CHECK, "var IS_NODE_ENV = false;"), loader: "js" };
    });
  },
};
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  plugins: [forceWebRuntime],
  define: { "import.meta.url": "undefined" },
  minify: prod,
  sourcemap: prod ? false : "inline",
  logLevel: "info",
  outfile: "main.js",
});
