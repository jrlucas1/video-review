# video-review

API de revisão de entregas de campanha. A campanha declara quais peças exige (roteiro, vídeo, capa, legenda). Cada peça de uma entrega tem versões, e a entrega só é aprovada quando toda peça exigida tem a versão atual aprovada.

## Rodar

Use Node 20 ou mais novo.

```bash
npm install
npm run dev        # http://127.0.0.1:3000, banco em video-review.db
npm test
npm run typecheck
```

`PORT` e `DATABASE_PATH` mudam a porta e o arquivo do banco.

## Rotas

| Rota | O que faz |
| --- | --- |
| `POST /campaigns` | Cria a campanha com as peças exigidas |
| `GET /campaigns/:id` | Mostra a campanha e as peças exigidas |
| `POST /campaigns/:id/deliveries` | Cria uma entrega |
| `GET /deliveries/:id` | Mostra o status, as pendências e a versão atual de cada peça |
| `POST /deliveries/:id/approve` | Aprova a entrega, ou responde 409 com as pendências |
| `POST /deliveries/:id/pieces/:piece/versions` | Envia uma versão da peça |
| `GET /deliveries/:id/pieces/:piece/versions` | Lista o histórico de versões da peça |
| `GET /versions/:id` | Mostra a versão, se é a atual, e os comentários dela |
| `POST /versions/:id/approve` | Aprova a versão |
| `POST /versions/:id/request-changes` | Pede ajustes na versão |
| `POST /versions/:id/comments` | Comenta na versão |

As peças são `script`, `video`, `cover` e `caption`.

```json
{ "name": "Lançamento", "requiredPieces": ["video", "cover"] }
```

```json
{ "url": "https://cdn.exemplo/video-v2.mp4", "durationSeconds": 30 }
```

```json
{ "author": "marca", "text": "Logo cortado aqui", "second": 12 }
```

Aprovar com peça pendente responde 409:

```json
{
  "error": "pieces_pending",
  "message": "A entrega não pode ser aprovada. Peças exigidas pendentes: video (versão atual aguardando aprovação), cover (sem versão enviada).",
  "pending": [
    { "piece": "video", "reason": "pending" },
    { "piece": "cover", "reason": "no_version" }
  ]
}
```

Todo erro tem `error` e `message`. 400 é payload fora do formato, 404 é recurso que não existe, 409 é conflito com o estado atual e 422 é campo que não combina com a peça.

## Regra de aprovação

A regra está em [src/approval.ts](src/approval.ts). Os testes estão em [test/approval.test.ts](test/approval.test.ts) e, pela API, em [test/required-pieces.test.ts](test/required-pieces.test.ts) e [test/reopened-delivery.test.ts](test/reopened-delivery.test.ts).

1. As peças exigidas são dado da campanha: uma linha por peça em `campaign_required_pieces`. A regra recebe a lista como argumento.
2. Uma peça exigida está pendente enquanto a versão atual dela não estiver aprovada.
3. A entrega está `approved` quando a marca registrou a aprovação e não há peça pendente. Senão está `in_production`.

O status da entrega é calculado, não gravado. O banco guarda só a data da aprovação. Por isso uma versão nova numa peça exigida derruba a aprovação na hora, e ela volta quando essa versão é aprovada, sem ninguém aprovar a entrega de novo.

## Como cada caso é tratado

| Caso | O que a API faz |
| --- | --- |
| Aprovar com peça exigida pendente | Responde 409 com cada peça e o motivo. |
| Peça que a campanha não exige | Aceita versão, comentário e decisão. Não entra na conta. |
| Versão nova | Vira a atual da peça, em qualquer status da anterior. Nasce `pending` e sem comentários. |
| Versão nova em entrega aprovada | A entrega volta a `in_production` até a versão ser aprovada. |
| Decisão sobre a versão | `pending` vira `approved` ou `changes_requested`. As duas são finais. |
| Versão substituída | Continua legível com seus comentários. Não recebe decisão nem comentário novo. |
| Comentário em vídeo | `second` é obrigatório, inteiro, de 0 até `durationSeconds`. |
| Comentário nas outras peças | Não tem `second`. |
| Aprovar a entrega de novo | Devolve o estado atual e mantém a data da primeira aprovação. |

## Código

- [src/approval.ts](src/approval.ts): a regra, em funções puras.
- [src/service.ts](src/service.ts): os casos de uso e os erros.
- [src/repository.ts](src/repository.ts): todo o SQL.
- [src/db.ts](src/db.ts): schema e conexão.
- [src/app.ts](src/app.ts): rotas e validação de formato.

## Índices

Medido em SQLite em memória, com script fora do repositório.

| Índice | Leitura | Escrita | Decisão |
| --- | --- | --- | --- |
| `UNIQUE (delivery_id, piece, number)` em `versions` | Atende a versão atual e o histórico por busca no índice. | Já existe pela integridade. | Fica. |
| `comments (version_id)` | Comentários de uma versão: de 11,4 ms para 43 µs, com 500 mil comentários. | Insert de 1,1 para 1,4 µs. Banco 18% maior. | Trocado pelo de baixo. |
| `comments (version_id, second)` | 37 µs, sem ordenar na leitura. | Insert de 1,5 µs. Banco 4% maior que com o anterior. | Fica. |
| `deliveries (campaign_id)` | Nenhuma rota lista entregas por campanha. | Insert de entrega de 0,9 para 1,3 µs. | Não criado. |

## O que ficou de fora

- Autenticação e papéis. Qualquer chamada pode aprovar; `author` e `creator` são texto livre.
- Upload de arquivo. A versão guarda uma `url`, e a duração do vídeo é a que o cliente declara.
- Paginação do histórico de versões e dos comentários de uma versão.
- Envio de vários comentários numa chamada.
- Edição das peças exigidas de uma campanha, e edição ou remoção de comentários.
- Pagamento. Quem ligar pagamento ao status precisa tratar a queda e a volta da aprovação quando chega versão nova.
- Migrations. O schema é criado na abertura do banco; peça ou status novo pede migration nos bancos que já existem.

## Uso de IA

O Claude Code (Claude Opus 5.5) escreveu o código, os testes e este README.

Eu tomei as decisões de desenho antes do código: status da entrega calculado a partir da aprovação registrada, comentário em qualquer peça com `second` só em vídeo, o estado `changes_requested` final como a aprovação, peça não exigida aceita e ignorada, lista de exigidas imutável, aprovação idempotente, comentário só na versão atual, duração declarada no vídeo, Fastify, SQLite sem ORM e Vitest.

Revisei a primeira versão e pedi mudanças: nomes e estrutura iguais aos dos meus outros repositórios, o SQL separado do service num repository, a query da versão atual reescrita com CTE e as listas dos `CHECK` escritas no schema em vez de montadas por interpolação. Pedi o plano de execução de cada query e a medição de cada índice; dessa revisão saiu a troca do índice de comentários. Não revisei o resto do código linha a linha.
