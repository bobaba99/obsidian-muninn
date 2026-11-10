import { connect } from "./cdp.mjs";
const c = await connect(9333);
const dev = process.argv[2] ?? "webgpu", dt = process.argv[3] ?? "fp16";
const r = await c.evaluate(`
  const p = app.plugins.plugins.muninn; p.settings = { device: "${dev}", audioDtype: "${dt}" }; p.resetEmbedder();
  const t0 = performance.now();
  try { await p.getEmbedder(); return "ok " + ((performance.now()-t0)/1000).toFixed(1) + "s"; } catch (e) { return "fail " + e.message; }`);
console.log(r);
console.log(c.logs.map((l) => l.slice(0, 700)).join("\n"));
c.close();
