import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`await app.plugins.disablePlugin("earmark"); await app.plugins.enablePlugin("earmark"); return !!app.plugins.plugins.earmark;`));
c.close();
