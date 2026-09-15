import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultDatabase = resolve(root, "data", "open-source.sqlite");
const defaultPublic = resolve(root, "public");
const mimeTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

function pageOptions(url) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "20", 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

function queryList(database, table, url) {
  const { page, limit, offset } = pageOptions(url);
  const module = url.searchParams.get("module")?.trim() || "";
  const source = url.searchParams.get("source")?.trim() || "";
  const query = url.searchParams.get("q")?.trim() || "";
  const conditions = [];
  const parameters = [];
  if (module) { conditions.push("x.module = ?"); parameters.push(module); }
  if (source) { conditions.push("r.name = ?"); parameters.push(source); }
  if (query) {
    conditions.push(table === "questions" ? "(x.question LIKE ? OR x.answer LIKE ?)" : "(x.title LIKE ? OR x.markdown LIKE ?)");
    parameters.push(`%${query}%`, `%${query}%`);
  }
  if (table === "questions" && url.searchParams.get("answered") === "1") conditions.push("length(trim(x.answer)) > 0");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const fields = table === "questions"
    ? "x.id,x.module,x.question,x.answer,x.relative_path,r.name repository,r.url repository_url"
    : "x.id,x.module,x.title,x.markdown,x.relative_path,r.name repository,r.url repository_url";
  const total = Number(database.prepare(`SELECT COUNT(*) count FROM ${table} x JOIN repositories r ON r.id=x.repository_id ${where}`).get(...parameters).count);
  const items = database.prepare(`SELECT ${fields} FROM ${table} x JOIN repositories r ON r.id=x.repository_id ${where} ORDER BY x.id LIMIT ? OFFSET ?`).all(...parameters, limit, offset);
  return { page, limit, total, pages: Math.ceil(total / limit), items };
}

export function createAppServer({ databasePath = defaultDatabase, publicDir = defaultPublic } = {}) {
  return createServer((request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const database = new DatabaseSync(databasePath, { readOnly: true });
        try {
          if (url.pathname === "/api/stats") return sendJson(response, database.prepare(`SELECT (SELECT COUNT(*) FROM repositories) repositories,(SELECT COUNT(*) FROM documents) documents,(SELECT COUNT(*) FROM questions) questions,(SELECT COUNT(*) FROM questions WHERE length(trim(answer))>0) answeredQuestions`).get());
          if (url.pathname === "/api/learning") return sendJson(response, queryList(database, "documents", url));
          if (url.pathname === "/api/questions") return sendJson(response, queryList(database, "questions", url));
          if (url.pathname === "/api/modules") return sendJson(response, database.prepare("SELECT module,COUNT(*) documents,(SELECT COUNT(*) FROM questions q WHERE q.module=d.module) questions FROM documents d GROUP BY module ORDER BY documents DESC,module").all());
          if (url.pathname === "/api/sources") return sendJson(response, database.prepare("SELECT r.*, (SELECT COUNT(*) FROM documents d WHERE d.repository_id=r.id) documents,(SELECT COUNT(*) FROM questions q WHERE q.repository_id=r.id) questions FROM repositories r ORDER BY r.name").all());
          return sendJson(response, { error: "not found" }, 404);
        } finally { database.close(); }
      }
      const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
      const filePath = resolve(publicDir, requested);
      const rootPrefix = resolve(publicDir) + sep;
      if ((!filePath.startsWith(rootPrefix) && filePath !== resolve(publicDir, "index.html")) || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        return response.end("Not found");
      }
      response.writeHead(200, { "content-type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" });
      createReadStream(filePath).pipe(response);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.INTERVIEW_HOST || "0.0.0.0";
  const port = Number.parseInt(process.env.INTERVIEW_PORT || "4173", 10);
  createAppServer().listen(port, host, () => console.log(`InterviewForge Local: http://localhost:${port}`));
}
