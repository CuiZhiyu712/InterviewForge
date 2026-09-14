import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const file = new URL("../data/source-index.json", import.meta.url);
const sources = JSON.parse(await readFile(file, "utf8"));

assert.ok(Array.isArray(sources) && sources.length > 0, "source list must be non-empty");
const ids = new Set();
for (const source of sources) {
  assert.ok(source.id && source.site && source.title && source.url && source.module, "source fields must be complete");
  assert.ok(!ids.has(source.id), `duplicate source id: ${source.id}`);
  ids.add(source.id);
  const host = new URL(source.url).hostname.replace(/^www\./, "");
  assert.ok(["xiaolincoding.com", "xiaolinnote.com"].includes(host), `unexpected source host: ${host}`);
}

console.log(`source-index ok: ${sources.length} sources`);
