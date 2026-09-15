import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

assert.equal(scripts.length, 2, "data and application scripts must both be inline");
for (const script of scripts) assert.doesNotThrow(() => new Function(script), "inline script must parse");
for (const behavior of ["filtered", "pickRandom", "setStatus", "renderProgress", "updateSubmodules"]) {
  assert.ok(scripts[1].includes(`function ${behavior}`), `missing browser behavior: ${behavior}`);
}
assert.ok(scripts[1].includes("saved.__favorites"), "favorite persistence missing");
assert.ok(scripts[1].includes("localStorage.setItem"), "progress persistence missing");
assert.ok(
  scripts[1].includes("if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={}"),
  "stored-state recovery must reject null, arrays, and other non-object values",
);
assert.ok(scripts[1].includes("confirm('确定清空全部学习状态吗？')"), "reset confirmation missing");
assert.ok(scripts[1].includes("['vague','unknown'].includes"), "weak-question filtering missing");

console.log("browser behavior script checks ok");
