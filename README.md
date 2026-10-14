# Deckline

Deck tracker para Hearthstone: mostra sobre o jogo as cartas que ainda estão no seu deck, a mão e
as jogadas do oponente, o dano no campo e um guia de mulligan grátis. Também lê a sua coleção e
busca os decks do meta que você consegue montar.

## Instalar

1. Baixe o **`Deckline-Setup-<versão>.exe`** da [versão mais recente](../../releases/latest).
2. Abra o arquivo. Se o Windows avisar "O Windows protegeu o computador", clique em
   **Mais informações → Executar assim mesmo** (o instalador não tem assinatura digital paga).
3. Com o Deckline aberto, **feche e abra o Hearthstone** uma vez: ele liga os logs que o tracker usa.

Depois disso, as versões novas chegam sozinhas: aparece o botão **Atualizar** no topo do Deckline.

## Guia de mulligan da comunidade

Quem permitir, envia os mulligans das suas partidas **sem nome nem conta**: a classe, as cartas
oferecidas e mantidas, quem começou, contra qual classe e se ganhou. Um robô junta tudo em
[`data/mulligan-community.json`](data/mulligan-community.json), que todos os Deckline baixam.

- `data/samples/` — as partidas recebidas, uma por linha, separadas por mês.
- `collector/aggregate.mjs` — o robô (roda no GitHub Actions a cada envio e a cada 6 horas).
  Só aceita envios do próprio Deckline e valida cada partida antes de somar.
- O guia usa só os últimos 120 dias, para acompanhar o meta.
