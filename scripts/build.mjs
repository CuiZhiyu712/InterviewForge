import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { questions } from "../data/questions.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = JSON.parse(await readFile(resolve(root, "data", "source-index.json"), "utf8"));
const resumePlan = JSON.parse(await readFile(resolve(root, "data", "resume-focus.json"), "utf8"));
const template = await readFile(resolve(root, "src", "template.html"), "utf8");
const safe = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");
const html = template
  .replace("__QUESTION_DATA__", safe(questions))
  .replace("__SOURCE_DATA__", safe(sources))
  .replace("__RESUME_DATA__", safe(resumePlan));

await mkdir(resolve(root, "dist"), { recursive: true });
await writeFile(resolve(root, "dist", "index.html"), html, "utf8");
console.log(`built dist/index.html with ${questions.length} authored questions and ${sources.length} source entries`);
