// Print Muninn warnings and errors from the Obsidian console, and whether a named environment variable is visible there.
import { connect } from "./cdp.mjs";
const c = await connect(9333);
console.log(await c.evaluate(`return JSON.stringify(${JSON.stringify(process.argv.slice(2))}.map(n => [n, typeof process.env[n] === "string" && process.env[n].length > 0]))`));
console.log(c.logs.filter((l) => /^\[(warn|error|exception)/.test(l)).map((l) => l.slice(0, 400)).join("\n"));
c.close();
