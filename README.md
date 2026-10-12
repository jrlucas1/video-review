# video-review

API de revisão de entregas de campanha. A campanha declara as peças que exige. A entrega só é aprovada quando cada peça exigida tem a versão atual aprovada.

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

As peças são `script` (roteiro), `video`, `cover` (capa) e `caption` (legenda).

| Rota | Corpo | O que faz |
| --- | --- | --- |
| `POST /campaigns` | `name`, `requiredPieces` | Cria a campanha |
| `GET /campaigns/:id` | | Mostra a campanha |
| `POST /campaigns/:id/deliveries` | `creator` | Cria uma entrega |
| `GET /deliveries/:id` | | Mostra o status, as pendências e a versão atual de cada peça |
| `POST /deliveries/:id/approve` | | Aprova a entrega |
| `POST /deliveries/:id/pieces/:piece/versions` | `url`; no vídeo, `durationSeconds` | Envia uma versão |
| `GET /deliveries/:id/pieces/:piece/versions` | | Lista as versões da peça |
| `GET /versions/:id` | | Mostra a versão e os comentários dela |
| `POST /versions/:id/approve` | | Aprova a versão |
| `POST /versions/:id/request-changes` | | Pede ajustes |
| `POST /versions/:id/comments` | `author`, `text`; no vídeo, `second` | Comenta na versão |

Todo erro tem `error` e `message`. Exemplo de aprovação com peça pendente (409):

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

## Regras

A regra de aprovação está em [src/approval.ts](src/approval.ts).

- As peças exigidas são dado da campanha. Cada peça é uma linha em `campaign_required_pieces`.
- A versão atual de uma peça é a de maior número.
- A API calcula o status da entrega. O banco guarda só a data da aprovação.
- A entrega está `approved` quando a data existe e nenhuma peça exigida está pendente.
- Uma versão nova nasce `pending` e sem comentários. Se a peça é exigida, a entrega volta a `in_production`.
- Quando a versão nova é aprovada, a entrega volta a `approved`.
- Uma peça não exigida aceita versão e comentário. Ela não bloqueia a aprovação.
- A decisão sobre uma versão é final: `approved` ou `changes_requested`.
- Uma versão substituída não recebe decisão nem comentário novo.
- No vídeo, o comentário tem `second`, de 0 até a duração. Nas outras peças, não tem.
- Aprovar a entrega de novo mantém a data da primeira aprovação.

## Código

`approval.ts` tem a regra. `service.ts` tem os casos de uso. `repository.ts` tem o SQL. `schemas.ts` tem o formato das requisições. `app.ts` tem as rotas. `db.ts` tem o schema do banco.

O índice `comments (version_id, second)` entrega os comentários de uma versão já na ordem do vídeo. Com 500 mil comentários, a leitura leva 37 µs e o insert leva 1,5 µs. Sem índice, a leitura leva 11 ms.

## O que ficou de fora

- Autenticação e papéis.
- Upload de arquivo. A versão guarda uma `url`.
- Paginação das versões e dos comentários.
- Vários comentários numa chamada.
- Edição das peças exigidas e dos comentários.
- Pagamento.
- Migrations.

## Uso de IA

O Claude Code (Claude Opus 5.5) escreveu o código, os testes e este README.

Eu tomei as decisões de desenho antes do código. As principais: status calculado, `changes_requested` como decisão final, peça não exigida aceita e ignorada, comentário só na versão atual, Fastify e SQLite sem ORM.

Eu revisei a primeira versão e pedi mudanças: a estrutura dos meus outros repositórios, o SQL num repository, os schemas num arquivo próprio, a query da versão atual com CTE, os `CHECK` por extenso e o código sem comentários. Pedi o plano de execução de cada query e a medição de cada índice. Li a regra em `src/approval.ts`. Não revisei o resto do código linha a linha.
