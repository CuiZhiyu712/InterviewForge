import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAppServer } from "../server/server.mjs";

const root = mkdtempSync(join(tmpdir(), "interview-local-"));
const publicDir = join(root, "public");
mkdirSync(publicDir);
writeFileSync(join(publicDir, "index.html"), "<h1>Local Library</h1>");
const databasePath = join(root, "test.sqlite");
const db = new DatabaseSync(databasePath);
db.exec(`
  CREATE TABLE repositories(id INTEGER PRIMARY KEY, name TEXT, url TEXT, commit_hash TEXT, license_text TEXT, imported_at TEXT);
  CREATE TABLE documents(id INTEGER PRIMARY KEY, repository_id INTEGER, module TEXT, title TEXT, relative_path TEXT, markdown TEXT);
  CREATE TABLE questions(id INTEGER PRIMARY KEY, document_id INTEGER, repository_id INTEGER, module TEXT, question TEXT, answer TEXT, relative_path TEXT);
  INSERT INTO repositories VALUES(1,'demo','https://example.com','abc','MIT','now');
  INSERT INTO documents VALUES(1,1,'RAG','RAG 入门','docs/rag.md','# RAG 入门');
  INSERT INTO questions VALUES(1,1,1,'RAG','什么是 RAG？','检索增强生成。','docs/rag.md');
`);
db.close();

const server = createAppServer({ databasePath, publicDir });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  assert.match(await (await fetch(`${origin}/`)).text(), /Local Library/);
  const stats = await (await fetch(`${origin}/api/stats`)).json();
  assert.deepEqual(stats, { repositories: 1, documents: 1, questions: 1, answeredQuestions: 1 });
  const questions = await (await fetch(`${origin}/api/questions?module=RAG&page=1&limit=10`)).json();
  assert.equal(questions.total, 1);
  assert.equal(questions.items[0].repository, "demo");
  const traversal = await fetch(`${origin}/../test.sqlite`);
  assert.equal(traversal.status, 404);
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("server tests passed");
