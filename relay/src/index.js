// Ponte entre o Deckline e o GitHub para o guia de mulligan da comunidade.
//
// O app não pode levar uma chave do GitHub (qualquer um a tiraria do instalador). Ele manda as
// partidas para cá, sem chave; este Worker confere cada uma e abre a issue "mulligan-batch" com a
// chave guardada como segredo no Cloudflare. O robô (collector/aggregate.mjs) faz o resto.
//
// Rotas:
//   POST /mulligans  corpo { v: 1, samples: [...] }  → 202 { accepted }
//   GET  /health     → 200 "ok"

const SAMPLE_VERSION = 1;
const BATCH_TITLE = "mulligan-batch";
const MAX_SAMPLES = 150;
const MAX_BODY_BYTES = 128 * 1024;
const KEEP_DAYS = 120;

// Mesmas regras de deckline/src/core/community.ts (validateSample). O robô valida de novo antes
// de somar, então aqui é só um filtro para não abrir issue com lixo.
const PLAYABLE_CLASSES = new Set([
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
const CARD_ID = /^[A-Za-z0-9_]{2,40}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-f0-9]{16,64}$/;

export function validateSample(x) {
  if (!x || typeof x !== "object") return undefined;
  const s = x;
  const cards = (v, max) => Array.isArray(v) && v.length <= max && v.every((c) => typeof c === "string" && CARD_ID.test(c));
  if (s.v !== SAMPLE_VERSION) return undefined;
  if (typeof s.id !== "string" || !ID.test(s.id)) return undefined;
  if (typeof s.playerClass !== "string" || !PLAYABLE_CLASSES.has(s.playerClass)) return undefined;
  if (s.opponentClass !== undefined && (typeof s.opponentClass !== "string" || !PLAYABLE_CLASSES.has(s.opponentClass))) {
    return undefined;
  }
  if (s.coin !== undefined && typeof s.coin !== "boolean") return undefined;
  if (s.result !== "win" && s.result !== "loss") return undefined;
  if (!cards(s.offered, 5) || !cards(s.kept, 5) || s.offered.length < 3) return undefined;
  if (typeof s.day !== "string" || !DAY.test(s.day)) return undefined;
  const offered = [...s.offered];
  for (const k of s.kept) {
    const i = offered.indexOf(k);
    if (i < 0) return undefined;
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

// O guia só usa os últimos 120 dias; partida fora disso (ou no futuro) não vale a issue.
function recentDay(day, now) {
  // "Amanhã" dá folga para o fuso de quem jogou (o app grava o dia em UTC, mas o relógio pode variar).
  const tomorrow = new Date(now.getTime() + 864e5).toISOString().slice(0, 10);
  const oldest = new Date(now.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  return day >= oldest && day <= tomorrow;
}

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function receive(request, env, now) {
  // Só o app manda este cabeçalho. Em navegador ele força uma checagem CORS que este Worker
  // nunca aprova, então uma página qualquer não consegue enviar em nome de quem a visita.
  if (!request.headers.get("X-Deckline-Version")) return json(400, { error: "cabeçalho X-Deckline-Version ausente" });

  const ip = request.headers.get("CF-Connecting-IP") ?? "desconhecido";
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: ip });
    if (!success) return json(429, { error: "muitos envios, tente mais tarde" });
  }

  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "envio grande demais" });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json(413, { error: "envio grande demais" });

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return json(400, { error: "JSON inválido" });
  }
  if (!payload || payload.v !== SAMPLE_VERSION || !Array.isArray(payload.samples)) {
    return json(400, { error: "formato inválido" });
  }
  if (payload.samples.length > MAX_SAMPLES) return json(413, { error: `no máximo ${MAX_SAMPLES} partidas por envio` });

  const seen = new Set();
  const samples = [];
  for (const raw of payload.samples) {
    const s = validateSample(raw);
    if (!s || !recentDay(s.day, now) || seen.has(s.id)) continue;
    seen.add(s.id);
    samples.push(s);
  }
  if (samples.length === 0) return json(400, { error: "nenhuma partida válida" });

  if (!env.GITHUB_TOKEN || !env.REPO) return json(500, { error: "relay sem configuração" });
  const body = "```json\n" + JSON.stringify({ v: SAMPLE_VERSION, samples }) + "\n```";
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "deckline-relay"
    },
    body: JSON.stringify({ title: `${BATCH_TITLE} (${samples.length})`, body })
  });
  if (!res.ok) {
    console.log(`GitHub respondeu ${res.status}: ${await res.text()}`);
    return json(502, { error: "não foi possível registrar agora" });
  }
  return json(202, { accepted: samples.length });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/health" && request.method === "GET") return new Response("ok");
    if (pathname !== "/mulligans") return json(404, { error: "não encontrado" });
    if (request.method !== "POST") return json(405, { error: "use POST" });
    return receive(request, env, new Date());
  }
};
