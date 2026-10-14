import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

const today = new Date().toISOString().slice(0, 10);
const sample = (over = {}) => ({
  v: 1,
  id: "d34c6ae32acac97b76143480f6c8d151",
  playerClass: "DEMONHUNTER",
  opponentClass: "WARLOCK",
  coin: true,
  result: "loss",
  offered: ["CORE_BT_187", "CATA_528", "CATA_528", "JAIL_891"],
  kept: ["CATA_528"],
  day: today,
  ...over
});

const env = { REPO: "dono/repo", GITHUB_TOKEN: "segredo" };
const send = (body, headers = {}, e = env) =>
  worker.fetch(
    new Request("https://relay.test/mulligans", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Deckline-Version": "0.6.0", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body)
    }),
    e
  );

let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response("{}", { status: 201 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("abre a issue no formato que o robô lê", async () => {
  const res = await send({ v: 1, samples: [sample(), sample({ id: "a".repeat(32), result: "win" })] });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: 2 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.github.com/repos/dono/repo/issues");
  assert.equal(calls[0].init.headers.Authorization, "Bearer segredo");
  const issue = JSON.parse(calls[0].init.body);
  assert.equal(issue.title, "mulligan-batch (2)");
  const m = /```json\s*([\s\S]*?)```/.exec(issue.body);
  const payload = JSON.parse(m[1]);
  assert.equal(payload.v, 1);
  assert.equal(payload.samples.length, 2);
});

test("descarta partidas inválidas, repetidas ou fora dos 120 dias", async () => {
  const res = await send({
    v: 1,
    samples: [
      sample(),
      sample(), // repetida
      sample({ id: "b".repeat(32), kept: ["NAO_OFERECIDA"] }),
      sample({ id: "c".repeat(32), playerClass: "INVENTADA" }),
      sample({ id: "d".repeat(32), day: "2020-01-01" }),
      sample({ id: "e".repeat(32), day: "2999-01-01" }),
      { qualquer: "coisa" }
    ]
  });
  assert.equal(res.status, 202);
  assert.deepEqual(await res.json(), { accepted: 1 });
});

test("não abre issue quando nada é válido", async () => {
  const res = await send({ v: 1, samples: [sample({ result: "draw" })] });
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("exige o cabeçalho do app", async () => {
  const res = await worker.fetch(
    new Request("https://relay.test/mulligans", { method: "POST", body: JSON.stringify({ v: 1, samples: [sample()] }) }),
    env
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("recusa JSON quebrado, versão errada e lote grande demais", async () => {
  assert.equal((await send("{nao")).status, 400);
  assert.equal((await send({ v: 2, samples: [sample()] })).status, 400);
  const many = Array.from({ length: 151 }, (_, i) => sample({ id: i.toString(16).padStart(32, "0") }));
  assert.equal((await send({ v: 1, samples: many })).status, 413);
  assert.equal(calls.length, 0);
});

test("respeita o limite por IP", async () => {
  const limited = { ...env, LIMITER: { limit: async ({ key }) => ({ success: key !== "1.2.3.4" }) } };
  assert.equal((await send({ v: 1, samples: [sample()] }, { "CF-Connecting-IP": "1.2.3.4" }, limited)).status, 429);
  assert.equal((await send({ v: 1, samples: [sample()] }, { "CF-Connecting-IP": "5.6.7.8" }, limited)).status, 202);
});

test("avisa o app quando o GitHub falha, para ele tentar de novo depois", async () => {
  globalThis.fetch = async () => new Response("ruim", { status: 401 });
  const res = await send({ v: 1, samples: [sample()] });
  assert.equal(res.status, 502);
});

test("rotas", async () => {
  assert.equal((await worker.fetch(new Request("https://relay.test/health"), env)).status, 200);
  assert.equal((await worker.fetch(new Request("https://relay.test/mulligans"), env)).status, 405);
  assert.equal((await worker.fetch(new Request("https://relay.test/outra"), env)).status, 404);
});
