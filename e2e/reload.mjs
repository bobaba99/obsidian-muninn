import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`await app.plugins.disablePlugin("muninn"); await app.plugins.enablePlugin("muninn"); return !!app.plugins.plugins.muninn;`));
c.close();
