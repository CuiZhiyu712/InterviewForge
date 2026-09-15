# Local Open-Source Library Implementation Plan

> **For agentic workers:** Execute inline with tests before implementation. This directory is local-only and excluded through `.git/info/exclude`.

**Goal:** Import eight open-source repositories into SQLite and provide a local server with separate home, knowledge-learning, practice, and source pages.

**Architecture:** Repository Markdown is stored unchanged under `sources/`. An importer extracts heading-based learning sections and question-answer pairs into SQLite without semantic deduplication or content review. A dependency-free Node.js server exposes paginated JSON APIs and static HTML pages.

**Tech Stack:** Node.js 24, built-in `node:sqlite`, HTML/CSS/JavaScript, Git.

---

### Task 1: Source acquisition and provenance

- [ ] Clone the eight approved repositories into `sources/`.
- [ ] Record repository URL, commit, license files, and import time in SQLite.
- [ ] Preserve source repository and file path for every imported record.

### Task 2: Importer and database

- [ ] Write failing tests for schema, Markdown section extraction, Q&A extraction, and duplicate preservation.
- [ ] Implement Markdown scanning and module classification.
- [ ] Build `data/open-source.sqlite` transactionally.

### Task 3: Local server

- [ ] Write failing API and static-file tests.
- [ ] Implement paginated `/api/stats`, `/api/learning`, `/api/questions`, `/api/modules`, and `/api/sources` routes.
- [ ] Bind to `0.0.0.0` so the same computer or LAN phone can access it.

### Task 4: Multi-page interface

- [ ] Create `index.html` for statistics and navigation.
- [ ] Create `learn.html` for module/source-filtered knowledge reading.
- [ ] Create `practice.html` for collapsible answers, module/source filtering, random questions, and local learning state.
- [ ] Create `sources.html` for repository revisions and licenses.
- [ ] Verify desktop and mobile responsive behavior.

### Task 5: Local launch and verification

- [ ] Create `start.ps1`, `update.ps1`, and local usage documentation.
- [ ] Run the importer, full test suite, database integrity checks, and browser smoke checks.
- [ ] Confirm `git status` remains clean and no local-library file is tracked.
