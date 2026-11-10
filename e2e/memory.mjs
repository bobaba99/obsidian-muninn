// Memory of the Obsidian window right now, and any Muninn warnings logged.
import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`return JSON.stringify({ memoryNowMB: Math.round(process.memoryUsage().rss / 2**20), modelLoaded: !!app.plugins.plugins.muninn.embedder })`));
console.log(c.logs.filter((l) => /^\[(warn|error)/.test(l)).map((l) => l.slice(0, 300)).join("\n"));
c.close();
