import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const page of ["index.html", "learn.html", "practice.html", "sources.html"]) {
  const html = readFileSync(new URL(`../public/${page}`, import.meta.url), "utf8");
  assert.match(html, /viewport/);
  assert.match(html, /app\.css/);
}
assert.match(readFileSync(new URL("../public/learn.html", import.meta.url), "utf8"), /知识学习区/);
assert.match(readFileSync(new URL("../public/practice.html", import.meta.url), "utf8"), /刷题区/);
assert.match(readFileSync(new URL("../public/practice.html", import.meta.url), "utf8"), /<details/);
assert.match(readFileSync(new URL("../public/sources.html", import.meta.url), "utf8"), /许可证/);
console.log("page tests passed");
