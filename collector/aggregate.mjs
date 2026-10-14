// Gerado a partir de deckline/src/collector/aggregate.ts (npm run build:collector). Não edite à mão.

// src/collector/aggregate.ts
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// src/core/classes.ts
var PLAYABLE_CLASSES = /* @__PURE__ */ new Set([
  "DEATHKNIGHT",
  "DEMONHUNTER",
  "DRUID",
  "HUNTER",
  "MAGE",
  "PALADIN",
  "PRIEST",
  "ROGUE",
  "SHAMAN",
  "WARLOCK",
  "WARRIOR"
]);

// src/core/community.ts
var SAMPLE_VERSION = 1;
var CARD_ID = /^[A-Za-z0-9_]{2,40}$/;
var DAY = /^\d{4}-\d{2}-\d{2}$/;
var ID = /^[a-f0-9]{16,64}$/;
function validateSample(x) {
  if (!x || typeof x !== "object") return void 0;
  const s = x;
  const cards = (v, max) => Array.isArray(v) && v.length <= max && v.every((c) => typeof c === "string" && CARD_ID.test(c));
  if (s.v !== SAMPLE_VERSION) return void 0;
  if (typeof s.id !== "string" || !ID.test(s.id)) return void 0;
  if (typeof s.playerClass !== "string" || !PLAYABLE_CLASSES.has(s.playerClass)) return void 0;
  if (s.opponentClass !== void 0 && (typeof s.opponentClass !== "string" || !PLAYABLE_CLASSES.has(s.opponentClass))) {
    return void 0;
  }
  if (s.coin !== void 0 && typeof s.coin !== "boolean") return void 0;
  if (s.result !== "win" && s.result !== "loss") return void 0;
  if (!cards(s.offered, 5) || !cards(s.kept, 5) || s.offered.length < 3) return void 0;
  if (typeof s.day !== "string" || !DAY.test(s.day)) return void 0;
  const offered = [...s.offered];
  for (const k of s.kept) {
    const i = offered.indexOf(k);
    if (i < 0) return void 0;
    offered.splice(i, 1);
  }
  return {
    v: 1,
    id: s.id,
    playerClass: s.playerClass,
    opponentClass: s.opponentClass,
    coin: s.coin,
    result: s.result,
    offered: s.offered,
    kept: s.kept,
    day: s.day
  };
}
var emptyBucket = () => ({ games: 0, wins: 0, cards: {} });
function addTo(bucket, s) {
  const won = s.result === "win" ? 1 : 0;
  bucket.games++;
  bucket.wins += won;
  const keptLeft = /* @__PURE__ */ new Map();
  for (const c of s.kept) keptLeft.set(c, (keptLeft.get(c) ?? 0) + 1);
  for (const cardId of s.offered) {
    const t = bucket.cards[cardId] ??= [0, 0, 0, 0, 0];
    t[0]++;
    const left = keptLeft.get(cardId) ?? 0;
    if (left > 0) {
      keptLeft.set(cardId, left - 1);
      t[1]++;
      t[2] += won;
    } else {
      t[3]++;
      t[4] += won;
    }
  }
}
function aggregate(samples, now = /* @__PURE__ */ new Date()) {
  const guide = { v: 1, updatedAt: now.toISOString(), games: 0, classes: {} };
  const seen = /* @__PURE__ */ new Set();
  for (const s of samples) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const cls = guide.classes[s.playerClass] ??= { ...emptyBucket(), vs: {}, first: emptyBucket(), coin: emptyBucket() };
    addTo(cls, s);
    if (s.opponentClass) addTo(cls.vs[s.opponentClass] ??= emptyBucket(), s);
    if (s.coin !== void 0) addTo(s.coin ? cls.coin : cls.first, s);
    guide.games++;
  }
  return guide;
}

// src/collector/aggregate.ts
var REPO = process.env.GITHUB_REPOSITORY ?? "";
var TOKEN = process.env.GITHUB_TOKEN ?? "";
var OWNER = REPO.split("/")[0];
var DATA = "data";
var SAMPLES = join(DATA, "samples");
var PROCESSED = ".processed-issues.json";
var KEEP_DAYS = 120;
var BATCH_PREFIX = "mulligan-batch";
async function gh(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "deckline-collector"
    }
  });
  if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return res;
}
async function openBatches() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const list = await (await gh(`/repos/${REPO}/issues?state=open&creator=${OWNER}&per_page=100&page=${page}`)).json();
    out.push(...list.filter((i) => !i.pull_request && i.user.login === OWNER && i.title.startsWith(BATCH_PREFIX)));
    if (list.length < 100) break;
  }
  return out;
}
function samplesOf(issue) {
  const m = /```json\s*([\s\S]*?)```/.exec(issue.body ?? "");
  if (!m) return [];
  try {
    const payload = JSON.parse(m[1]);
    return (payload.samples ?? []).map(validateSample).filter((s) => s !== void 0);
  } catch {
    return [];
  }
}
async function loadAll() {
  if (!existsSync(SAMPLES)) return [];
  const out = [];
  for (const f of (await readdir(SAMPLES)).filter((f2) => f2.endsWith(".jsonl"))) {
    for (const line of (await readFile(join(SAMPLES, f), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const s = validateSample(JSON.parse(line));
      if (s) out.push(s);
    }
  }
  return out;
}
async function store(samples, existing) {
  const known = new Set(existing.map((s) => s.id));
  const fresh = samples.filter((s) => !known.has(s.id) && known.add(s.id));
  await mkdir(SAMPLES, { recursive: true });
  const byMonth = /* @__PURE__ */ new Map();
  for (const s of fresh) {
    const month = s.day.slice(0, 7);
    byMonth.set(month, [...byMonth.get(month) ?? [], s]);
  }
  for (const [month, list] of byMonth) {
    const file = join(SAMPLES, `${month}.jsonl`);
    const before = existsSync(file) ? await readFile(file, "utf8") : "";
    await writeFile(file, before + list.map((s) => JSON.stringify(s)).join("\n") + "\n");
  }
  return fresh;
}
async function rebuild(all, now = /* @__PURE__ */ new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const guide = aggregate(
    all.filter((s) => s.day >= cutoff),
    now
  );
  await mkdir(DATA, { recursive: true });
  await writeFile(join(DATA, "mulligan-community.json"), JSON.stringify(guide));
  console.log(`Guia: ${guide.games} partidas (\xFAltimos ${KEEP_DAYS} dias), ${Object.keys(guide.classes).length} classes`);
}
async function collect() {
  const issues = await openBatches();
  const incoming = issues.flatMap(samplesOf);
  const existing = await loadAll();
  const fresh = await store(incoming, existing);
  console.log(`Issues: ${issues.length} \xB7 partidas recebidas: ${incoming.length} \xB7 novas: ${fresh.length}`);
  await rebuild([...existing, ...fresh]);
  await writeFile(PROCESSED, JSON.stringify(issues.map((i) => i.number)));
}
async function close() {
  if (!existsSync(PROCESSED)) return;
  const numbers = JSON.parse(await readFile(PROCESSED, "utf8"));
  for (const n of numbers) {
    await gh(`/repos/${REPO}/issues/${n}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "completed" }) });
  }
  console.log(`Issues fechadas: ${numbers.length}`);
}
if (/aggregate\.(mjs|ts)$/.test(process.argv[1] ?? "")) {
  const mode = process.argv[2];
  if (mode === "collect") await collect();
  else if (mode === "close") await close();
  else if (mode === "rebuild") await rebuild(await loadAll());
  else throw new Error(`modo desconhecido: ${mode} (use collect, close ou rebuild)`);
}
export {
  loadAll,
  rebuild,
  store
};
