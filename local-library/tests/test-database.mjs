import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const database = new DatabaseSync(fileURLToPath(new URL("../data/open-source.sqlite", import.meta.url)), { readOnly: true });
try {
  const scalar = (sql) => Number(Object.values(database.prepare(sql).get())[0]);
  assert.equal(scalar("SELECT COUNT(*) FROM repositories"), 8);
  assert.ok(scalar("SELECT COUNT(*) FROM documents") >= 900);
  assert.ok(scalar("SELECT COUNT(*) FROM questions") >= 1000);
  assert.ok(scalar("SELECT COUNT(DISTINCT module) FROM documents") >= 10);
  assert.ok(scalar("SELECT COUNT(*) FROM questions WHERE length(trim(answer))>0") > 0);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  for (const row of database.prepare("SELECT name,commit_hash FROM repositories").all()) {
    assert.match(row.commit_hash, /^[0-9a-f]{40}$/);
  }
} finally { database.close(); }
console.log("local database tests passed");
