import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const libraryRoot = resolve(root, "local-library");
const publicDir = resolve(libraryRoot, "public");
const databasePath = resolve(libraryRoot, "data", "open-source.sqlite");
const serverPath = resolve(libraryRoot, "server", "server.mjs");
const outputDir = resolve(root, "dist", "library");

// Hand-written browser assets, copied verbatim next to the generated snapshot.
const assets = [
  ["scripts/static-fetch.js", "js/static-fetch.js"],
  ["scripts/reading-controls.js", "js/reading-controls.js"],
  ["scripts/reading.css", "css/reading.css"],
];

const tables = ["repositories", "documents", "questions"];
// Served verbatim from the local server so the snapshot cannot drift from its SQL.
const aggregateRoutes = { stats: "/api/stats", modules: "/api/modules", sources: "/api/sources" };
const heroOriginal = "八个开源仓库的本地聚合版本，所有内容从 SQLite 分页读取，不上传、不部署、不参与公开版构建。";
const heroPublic = "八个开源仓库的公开聚合镜像，内容来自数据库快照，筛选与分页全部在你的浏览器里完成。";
const staticFetchTag = '<script type="module" src="js/static-fetch.js"></script>';
const readingTags = '<link rel="stylesheet" href="css/reading.css"><script type="module" src="js/reading-controls.js"></script>';
// Only the pages that render Markdown bodies get a reading-size control.
const readingPages = new Set(["learn.html", "practice.html"]);

if (!existsSync(publicDir) || !existsSync(databasePath) || !existsSync(serverPath)) {
  throw new Error(`missing local-library sources under ${libraryRoot}; this build only runs on a machine that has the imported database`);
}
for (const [source] of assets) {
  if (!existsSync(resolve(root, source))) throw new Error(`missing build asset: ${source}`);
}

const readTable = (database, table) => {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  if (!columns.length) throw new Error(`missing table: ${table}`);
  const order = columns.includes("id") ? " ORDER BY id" : "";
  const rows = database.prepare(`SELECT ${columns.join(", ")} FROM ${table}${order}`).all()
    .map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
  if (!rows.length) throw new Error(`refusing to export an empty table: ${table}`);
  return { table, columns, rows };
};

const withAppServer = async (run) => {
  const { createAppServer } = await import(pathToFileURL(serverPath).href);
  const server = createAppServer({ databasePath, publicDir });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())));
  }
};

const database = new DatabaseSync(databasePath, { readOnly: true });
let snapshots;
try {
  snapshots = tables.map((table) => readTable(database, table));
} finally {
  database.close();
}

const aggregates = await withAppServer(async (origin) => {
  const entries = await Promise.all(Object.entries(aggregateRoutes).map(async ([name, route]) => {
    const response = await fetch(`${origin}${route}`);
    if (!response.ok) throw new Error(`${route} responded with ${response.status}`);
    return [name, await response.json()];
  }));
  return Object.fromEntries(entries);
});

// One record per line keeps the diffs line-scoped when the snapshot is regenerated.
const serializeRows = (rows) => (rows.length ? `[\n${rows.map((row) => JSON.stringify(row)).join(",\n")}\n]\n` : "[]\n");

const copyDirectory = async (sourceDir, targetDir) => {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) await copyDirectory(source, target);
    else if (entry.isFile()) await copyFile(source, target);
  }
};

const rewritePage = (html, name) => {
  const rewritten = html.replaceAll('href="/"', 'href="index.html"');
  if (rewritten.includes('href="/"')) throw new Error(`${name}: root-absolute links survive the rewrite`);
  if (!rewritten.includes("</head>")) throw new Error(`${name}: no </head> to inject the snapshot loader into`);
  const withLoader = rewritten.replace("</head>", `${staticFetchTag}${readingPages.has(name) ? readingTags : ""}</head>`);
  if (!withLoader.includes(staticFetchTag)) throw new Error(`${name}: snapshot loader was not injected`);
  if (readingPages.has(name) && !withLoader.includes("js/reading-controls.js")) throw new Error(`${name}: reading control was not injected`);
  return name === "index.html" ? withLoader.replace(heroOriginal, heroPublic) : withLoader;
};

await rm(outputDir, { recursive: true, force: true });
await copyDirectory(publicDir, outputDir);

const pages = (await readdir(publicDir)).filter((name) => name.endsWith(".html"));
for (const name of pages) {
  const source = await readFile(join(publicDir, name), "utf8");
  await writeFile(join(outputDir, name), rewritePage(source, name), "utf8");
}

await mkdir(join(outputDir, "data"), { recursive: true });
let bytes = 0;
const writeSnapshot = async (name, payload) => {
  bytes += Buffer.byteLength(payload);
  await writeFile(join(outputDir, "data", `${name}.json`), payload, "utf8");
};
for (const { table, rows } of snapshots) await writeSnapshot(table, serializeRows(rows));
for (const [name, value] of Object.entries(aggregates)) {
  await writeSnapshot(name, Array.isArray(value) ? serializeRows(value) : `${JSON.stringify(value)}\n`);
}

for (const [source, target] of assets) await copyFile(resolve(root, source), join(outputDir, target));

const summary = snapshots.map(({ table, columns, rows }) => `${table}=${rows.length}(${columns.length} columns)`).join(" ");
console.log(`built dist/library with ${pages.length} pages, ${summary}, ${Object.keys(aggregates).length} aggregate routes, ${(bytes / 1048576).toFixed(1)} MB of snapshot data`);
