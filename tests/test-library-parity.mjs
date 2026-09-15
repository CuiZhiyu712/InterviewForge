import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createAppServer } from "../local-library/server/server.mjs";
import { createStaticApi } from "../scripts/static-fetch.js";

const root = new URL("../", import.meta.url);
const snapshots = Object.fromEntries(await Promise.all(
  ["repositories", "documents", "questions", "stats", "modules", "sources"].map(async (name) => [
    name,
    JSON.parse(await readFile(new URL(`dist/library/data/${name}.json`, root), "utf8")),
  ]),
));

const server = createAppServer({
  databasePath: fileURLToPath(new URL("local-library/data/open-source.sqlite", root)),
  publicDir: fileURLToPath(new URL("local-library/public/", root)),
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const api = createStaticApi(async (name) => snapshots[name]);

const routes = [
  "/api/stats",
  "/api/modules",
  "/api/sources",
  "/api/learning",
  "/api/learning?page=2&limit=8",
  "/api/learning?module=Agent&page=2&limit=8",
  "/api/learning?source=JavaGuide&limit=5",
  "/api/learning?q=检索&limit=5",
  "/api/learning?q=&limit=3",
  "/api/learning?module=不存在的模块",
  "/api/learning?limit=999",
  "/api/learning?page=0&limit=0",
  "/api/learning?page=abc&limit=xyz",
  "/api/questions",
  "/api/questions?page=3&limit=15",
  "/api/questions?module=Agent&page=3&limit=15",
  "/api/questions?answered=1&page=2&limit=15",
  "/api/questions?answered=1&limit=100",
  "/api/questions?source=JavaGuide&answered=1&page=4&limit=15",
  "/api/questions?q=MySQL&limit=5",
  "/api/questions?q=mysql&limit=5",
  "/api/questions?q=J_va&limit=5",
  "/api/questions?q=100%25&limit=5",
  "/api/questions?q=并发&module=Java并发&limit=7",
  "/api/nope",
];

try {
  for (const route of routes) {
    const expected = await (await fetch(`${origin}${route}`)).json();
    const url = new URL(route, origin);
    const { status, body } = await api.handle(url.pathname, url.searchParams);
    assert.deepEqual(body, expected, `${route} diverged from the local server`);
    assert.equal(status, route === "/api/nope" ? 404 : 200, `${route} status`);
  }
} finally {
  await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

console.log(`library parity ok: ${routes.length} routes match the local server`);
