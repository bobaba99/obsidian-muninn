import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`
  const out = { vault: app.vault.getName(), files: app.vault.getFiles().map(f => f.path), gpu: !!navigator.gpu, coi: crossOriginIsolated, ver: navigator.userAgent.match(/obsidian\\/[\\d.]+|Electron\\/[\\d.]+|Chrome\\/[\\d.]+/gi) };
  if (!app.plugins.isEnabled()) await app.plugins.setEnable(true);
  await app.plugins.loadManifests();
  if (!app.plugins.plugins.earmark) await app.plugins.enablePluginAndSave("earmark");
  out.plugin = !!app.plugins.plugins.earmark;
  out.commands = Object.keys(app.commands.commands).filter(k => k.startsWith("earmark"));
  return JSON.stringify(out);
`));
console.log(c.logs.join("\n"));
c.close();
