// The Transcribe button must upload nothing unless a service and a key are set.
import { connect } from "./cdp.mjs";
const c = await connect(9333);
const r = await c.evaluate(`const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const p = app.plugins.plugins.earmark; const out = {};
  
  const click = async () => { document.querySelectorAll(".notice").forEach(n => n.remove());
    [...document.querySelectorAll(".earmark-player button")].find(b => b.textContent === "Transcribe from here").click(); await sleep(1500);
    return [...document.querySelectorAll(".notice")].map(n => n.textContent); };
  await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("Note.md"));
  await p.playAt("Recordings/chapter-128104.m4a", 10); await sleep(500); document.querySelector(".earmark-player audio").pause();
  out.defaults = p.settings.transcriptionProvider;
  out.none = await click();
  p.settings = { ...p.settings, transcriptionProvider: "fish-audio", apiKeys: {} };
  out.fishNoKey = await click();
  p.settings = { ...p.settings, transcriptionProvider: "none" };
  out.note = app.workspace.activeEditor?.editor?.getValue();
  return JSON.stringify(out, null, 1);`);
console.log(r); c.close();
