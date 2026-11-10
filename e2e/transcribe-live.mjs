// One live call to a transcription provider through the plugin's own Transcribe button.
// SPENDS API CREDIT: 30 s of audio per run. Usage: node e2e/transcribe-live.mjs fish-audio FISH_API_KEY
// The key is read from the Obsidian process environment and held in memory only; it is never written or printed.
import fs from "node:fs";
import { connect } from "./cdp.mjs";
const provider = process.argv[2] ?? "fish-audio", envVar = process.argv[3] ?? "FISH_API_KEY";
const t = JSON.parse(fs.readFileSync(process.env.TRUTH ?? "e2e/truth-long.json"))["1272-141231-0018"]; // "a red haired mountain of a man ..."
const c = await connect(9333);
console.log(await c.evaluate(`const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const p = app.plugins.plugins.muninn; const key = process.env.${envVar};
  if (!key) return "no ${envVar} in the Obsidian process environment";
  const file = app.vault.getAbstractFileByPath("Note.md"); await app.vault.modify(file, "");
  await app.workspace.getLeaf(false).openFile(file); await sleep(300);
  await p.playAt(${JSON.stringify(t.path)}, ${Math.max(0, t.start - 2)}); await sleep(300); document.querySelector(".muninn-player audio").pause();
  const saved = p.settings; p.settings = { ...saved, transcriptionProvider: "${provider}", apiKeys: { "${provider}": key } };
  document.querySelectorAll(".notice").forEach(n => n.remove());
  const t0 = performance.now();
  [...document.querySelectorAll(".muninn-player button")].find(b => b.textContent === "Transcribe from here").click();
  let note = ""; for (let i = 0; i < 300 && !(note = app.workspace.activeEditor.editor.getValue()).includes(">"); i++) await sleep(200);
  p.settings = saved;
  return JSON.stringify({ sec: ((performance.now() - t0) / 1000).toFixed(1), note, notices: [...document.querySelectorAll(".notice")].map(n => n.textContent) }, null, 1);`));
c.close();
