import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const research = resolve(root, "..", "question-bank-research");
const files = ["backend-sources.json", "ai-sources.json"];
const merged = [];

for (const file of files) {
  const rows = JSON.parse(await readFile(resolve(research, file), "utf8"));
  for (const row of rows) merged.push({ id: `src-${String(merged.length + 1).padStart(4, "0")}`, ...row });
}

await mkdir(resolve(root, "data"), { recursive: true });
await writeFile(resolve(root, "data", "source-index.json"), JSON.stringify(merged, null, 2), "utf8");
console.log(`merged ${merged.length} public source entries`);
