// End-to-end: Enter plays from the moment (incl. a webm with no seek table), Shift+Enter inserts a link, the link reopens the moment.
import { connect } from "./cdp.mjs";
const c = await connect(Number(process.env.PORT ?? 9333));
const pre = `const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const key = (el, init) => el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  const ask = async (q) => { app.commands.executeCommandById("muninn:search"); await sleep(100);
    const input = document.querySelector(".prompt-input"); input.value = q; input.dispatchEvent(new Event("input", { bubbles: true }));
    for (let i = 0; i < 100 && !document.querySelector(".prompt .suggestion-item"); i++) await sleep(100);
    return { input, first: document.querySelector(".prompt .suggestion-item .muninn-hit-title").textContent }; };
  const audioState = async () => { await sleep(1500); const a = document.querySelector(".muninn-player audio");
    return a ? { t: +a.currentTime.toFixed(1), paused: a.paused, duration: a.duration, title: document.querySelector(".muninn-player-title").textContent } : null; };`;
const out = {};
out.enterPlaysWebm = JSON.parse(await c.evaluate(`${pre}
  const { input, first } = await ask("a huge guy with ginger hair");
  key(input, { key: "Enter", code: "Enter" });
  return JSON.stringify({ first, audio: await audioState() });`));
out.enterPlaysM4a = JSON.parse(await c.evaluate(`${pre}
  const { input, first } = await ask("comparing art with maths");
  key(input, { key: "Enter", code: "Enter" });
  return JSON.stringify({ first, audio: await audioState() });`));
out.shiftEnterInserts = JSON.parse(await c.evaluate(`${pre}
  const file = app.vault.getAbstractFileByPath("Note.md");
  await app.vault.modify(file, "# Scratch note\\n\\n");
  await app.workspace.getLeaf(false).openFile(file); await sleep(300);
  const ed = app.workspace.activeEditor.editor; ed.setCursor(ed.lastLine(), 0);
  const { input, first } = await ask("the ruler ran away in shame");
  key(input, { key: "Enter", code: "Enter", shiftKey: true }); await sleep(500);
  return JSON.stringify({ first, note: ed.getValue() });`));
const link = out.shiftEnterInserts.note.match(/\((obsidian:\/\/[^)]+)\)/)?.[1];
out.linkReopens = link ? JSON.parse(await c.evaluate(`${pre}
  const u = new URL(${JSON.stringify(link)});
  const a0 = document.querySelector(".muninn-player audio"); if (a0) { a0.pause(); a0.currentTime = 0; }
  const params = { action: u.hostname, ...Object.fromEntries(u.searchParams) };
  if (typeof window.OBS_ACT !== "function") return JSON.stringify({ skipped: "no OBS_ACT hook" });
  window.OBS_ACT(params);
  return JSON.stringify({ link: ${JSON.stringify(link)}, audio: await audioState() });`)) : { error: "no link found in note" };
console.log(JSON.stringify(out, null, 1));
console.log(c.logs.filter((l) => /^\[(error|exception)/.test(l) && !/reading 'create'|search model \(webgpu\)/.test(l)).join("\n").slice(0, 1500));
c.close();
