# Relay do guia de mulligan

O Deckline não pode levar uma chave do GitHub dentro do instalador (qualquer pessoa conseguiria
tirá-la de lá). Por isso o app manda as partidas para este pequeno servidor no Cloudflare Workers,
**sem chave nenhuma**. O servidor confere cada partida e abre a issue `mulligan-batch` usando a
chave que fica guardada como segredo no Cloudflare. Daí em diante, o robô
(`collector/aggregate.mjs`) segue igual.

```
Deckline ──POST /mulligans──▶ deckline-relay (Cloudflare) ──issue──▶ GitHub ──Action──▶ data/mulligan-community.json
```

O que ele barra antes de chegar ao GitHub:

- envio sem o cabeçalho `X-Deckline-Version` (impede que uma página da web envie em nome de quem a visita);
- mais de 5 envios por minuto do mesmo IP;
- corpo acima de 128 KB ou mais de 150 partidas;
- partidas inválidas (mesmas regras do robô), repetidas ou fora dos últimos 120 dias.

## Publicar (uma vez só)

Precisa do Node.js instalado (o mesmo que você já usa para o app).

1. **Chave do GitHub com o mínimo de acesso.** Em
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new):
   - *Repository access*: **Only select repositories** → `deckline-releases`
   - *Permissions* → *Repository permissions* → **Issues: Read and write** (o resto fica em *No access*)
   - *Expiration*: 1 ano (anote a data)
   - Gere e copie a chave. Não salve em arquivo nem cole em chat.

   A chave tem que ser da conta `devBrunoEmanuel`: o robô só aceita issues abertas pelo dono do repositório.

2. **Conta grátis** em [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).

3. **Publicar o Worker.** No PowerShell, dentro desta pasta:
   ```powershell
   cd "C:\Users\Bruno Emanuel\Desktop\clone deck tracker\deckline-releases\relay"
   npx wrangler@4 login
   npx wrangler@4 deploy
   ```
   O `login` abre o navegador para autorizar. O `deploy` mostra o endereço, algo como
   `https://deckline-relay.SEU-SUBDOMINIO.workers.dev`. Anote.

4. **Guardar a chave como segredo:**
   ```powershell
   npx wrangler@4 secret put GITHUB_TOKEN
   ```
   Cole a chave quando ele pedir. Ela fica só no Cloudflare.

5. **Conferir:** abra `https://deckline-relay.SEU-SUBDOMINIO.workers.dev/health` no navegador.
   Tem que aparecer `ok`.

## O que muda no app

Em `deckline/src/node/community.ts` (no repositório do app, não aqui):

- Troque `collectorToken()` por uma constante com o endereço do Worker:
  ```ts
  const COMMUNITY_RELAY = "https://deckline-relay.SEU-SUBDOMINIO.workers.dev";
  ```
- `uploadSamples` passa a mandar cada lote para o relay, sem `Authorization`:
  ```ts
  const res = await fetchImpl(`${COMMUNITY_RELAY}/mulligans`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Deckline",
      "X-Deckline-Version": app.getVersion()
    },
    body: JSON.stringify({ v: SAMPLE_VERSION, samples: batch })
  });
  if (!res.ok) throw new Error(`Relay respondeu ${res.status}`);
  ```
- Em `shareNow`, tire a checagem do token (`!token`). O envio continua só para quem ligou
  `shareMulligans`.
- Marque como enviadas as partidas **de cada lote** logo depois que ele der certo (hoje só marca no
  fim). Senão, quem tiver muitas partidas acumuladas esbarra no limite de 5 envios por minuto,
  tudo falha e ele reenvia os mesmos lotes para sempre. Vale também mandar no máximo 3 lotes por vez.

Depois disso, lance uma versão nova; quem atualizar começa a contribuir.

## Manutenção

- **A chave vence** na data que você escolheu. Gere outra igual e rode de novo
  `npx wrangler@4 secret put GITHUB_TOKEN`. Enquanto estiver vencida, o relay responde 502 e o app
  tenta de novo depois, sem perder nada.
- **Logs:** `npx wrangler@4 tail` mostra os envios em tempo real (inclusive quando o GitHub recusa).
- **Testes:** `npm test` (só Node, não precisa de conta).
- As regras de `validateSample` em `src/index.js` são uma cópia de `deckline/src/core/community.ts`.
  Se mudar o formato das partidas lá, mude aqui também. O robô valida de novo de qualquer forma.
