// Browser-side stand-in for local-library's /api/* endpoints, backed by the JSON
// snapshot that scripts/build-library.mjs writes next to it. Deliberately free of
// DOM access so tests can import it under Node and diff it against the real server.

const snapshotNames = ["repositories", "documents", "questions", "stats", "modules", "sources"];

const foldAscii = (value) => String(value ?? "").replace(/[A-Z]/g, (character) => character.toLowerCase());

// SQLite's LIKE wildcards. `%` and `_` are metacharacters, backslash is not an escape.
const likeToRegExp = (pattern) => {
  let source = "^";
  for (const character of foldAscii(pattern)) {
    if (character === "%") source += "[\\s\\S]*";
    else if (character === "_") source += "[\\s\\S]";
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
};

const likeMatches = (value, pattern) => likeToRegExp(pattern).test(foldAscii(value));

// Single-argument SQLite trim() strips spaces only, unlike JavaScript's String#trim.
const hasAnswer = (answer) => String(answer ?? "").replace(/^ +| +$/g, "").length > 0;

const pageOptions = (searchParams) => {
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "20", 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
};

// Mirrors the paging, filtering and ordering of queryList() in server/server.mjs.
export function queryList(rows, repositories, kind, searchParams) {
  const { page, limit, offset } = pageOptions(searchParams);
  const module = (searchParams.get("module") || "").trim();
  const source = (searchParams.get("source") || "").trim();
  const query = (searchParams.get("q") || "").trim();
  const answeredOnly = kind === "questions" && searchParams.get("answered") === "1";
  const pattern = query ? `%${query}%` : "";
  const repositoryNames = new Map(repositories.map((row) => [row.id, row.name]));
  const repositoryUrls = new Map(repositories.map((row) => [row.id, row.url]));
  const matched = rows
    .filter((row) => {
      if (module && row.module !== module) return false;
      if (source && repositoryNames.get(row.repository_id) !== source) return false;
      if (answeredOnly && !hasAnswer(row.answer)) return false;
      if (pattern) {
        const haystacks = kind === "questions" ? [row.question, row.answer] : [row.title, row.markdown];
        if (!haystacks.some((haystack) => likeMatches(haystack ?? "", pattern))) return false;
      }
      return true;
    })
    .sort((left, right) => left.id - right.id);
  const items = matched.slice(offset, offset + limit).map((row) => (kind === "questions"
    ? {
      id: row.id, module: row.module, question: row.question, answer: row.answer,
      relative_path: row.relative_path, repository: repositoryNames.get(row.repository_id),
      repository_url: repositoryUrls.get(row.repository_id),
    }
    : {
      id: row.id, module: row.module, title: row.title, markdown: row.markdown,
      relative_path: row.relative_path, repository: repositoryNames.get(row.repository_id),
      repository_url: repositoryUrls.get(row.repository_id),
    }));
  return { page, limit, total: matched.length, pages: Math.ceil(matched.length / limit), items };
}

export function createStaticApi(loadSnapshot) {
  return {
    async handle(pathname, searchParams) {
      if (pathname === "/api/stats") return { status: 200, body: await loadSnapshot("stats") };
      if (pathname === "/api/modules") return { status: 200, body: await loadSnapshot("modules") };
      if (pathname === "/api/sources") return { status: 200, body: await loadSnapshot("sources") };
      if (pathname === "/api/learning" || pathname === "/api/questions") {
        const kind = pathname === "/api/learning" ? "documents" : "questions";
        const [rows, repositories] = await Promise.all([loadSnapshot(kind), loadSnapshot("repositories")]);
        return { status: 200, body: queryList(rows, repositories, kind, searchParams) };
      }
      return { status: 404, body: { error: "not found" } };
    },
  };
}

export function installStaticFetch({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const originalFetch = fetchImpl;
  const pending = new Map();
  // Each snapshot loads on its own, so the practice page never pulls the 17 MB
  // document corpus and the home page never pulls anything but the aggregates.
  const loadSnapshot = (name) => {
    if (!snapshotNames.includes(name)) throw new Error(`unknown snapshot: ${name}`);
    if (!pending.has(name)) {
      const request = originalFetch(new URL(`${name}.json`, baseUrl))
        .then((response) => {
          if (!response.ok) throw new Error(`数据库快照 ${name}.json 加载失败（HTTP ${response.status}）`);
          return response.json();
        })
        .catch((error) => {
          pending.delete(name);
          throw error;
        });
      pending.set(name, request);
    }
    return pending.get(name);
  };
  const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  const api = createStaticApi(loadSnapshot);

  globalThis.fetch = async (input, init) => {
    const target = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const url = new URL(target, globalThis.location?.href ?? "http://localhost/");
    if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
    try {
      const { status, body } = await api.handle(url.pathname, url.searchParams);
      return jsonResponse(status, body);
    } catch (error) {
      return jsonResponse(502, { error: error.message });
    }
  };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installStaticFetch({ baseUrl: new URL("../data/", import.meta.url) });
}
