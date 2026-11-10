import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`
  const hosts = {}; for (const e of performance.getEntriesByType("resource")) { try { const u = new URL(e.name); if (u.protocol.startsWith("http")) (hosts[u.host] ??= new Set()).add(u.pathname.split("/").pop()); } catch {} }
  const cacheNames = await caches.keys(); let cached = [];
  for (const n of cacheNames) for (const r of await (await caches.open(n)).keys()) cached.push(r.url.replace(/^https:\\/\\//, ""));
  return JSON.stringify({ hosts: Object.fromEntries(Object.entries(hosts).map(([k, v]) => [k, [...v]])), cacheNames, cached }, null, 1);`));
c.close();
