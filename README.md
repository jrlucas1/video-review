# video-review

API de revisão de entregas de campanha. Uma campanha declara quais peças exige (roteiro, vídeo, capa, legenda). Cada peça de uma entrega tem versões, e a entrega só é aprovada quando toda peça exigida tem a **versão atual** aprovada.

## Rodar

Precisa de Node 20 ou mais novo.

```bash
npm install
npm test
npm run typecheck
npm start
```

`npm start` sobe em `http://127.0.0.1:3000` e grava em `video-review.db`. As variáveis `PORT`, `HOST` e `BANCO` mudam isso.

## Por onde ler

1. [src/regra.ts](src/regra.ts): a regra inteira, em duas funções puras. Recebe a lista de peças exigidas como argumento.
2. [test/regra.test.ts](test/regra.test.ts) e [test/api.test.ts](test/api.test.ts): os casos do enunciado, pelo nome.
3. [src/servico.ts](src/servico.ts): as operações e o SQL.
4. [src/banco.ts](src/banco.ts) e [src/app.ts](src/app.ts): schema e rotas.

## Regras

- **Peças exigidas são dado da campanha.** Ficam na tabela `campanha_peca_exigida`, uma linha por peça. São definidas na criação (ao menos uma, sem repetição) e não mudam depois.
- **Versão.** Cada envio cria uma versão numerada da peça naquela entrega. A de maior número é a atual. Ela nasce `pendente` e vira `aprovada` ou `ajustes_pedidos`; as duas decisões são finais. Para corrigir, envia-se outra versão.
- **Versão substituída fica congelada.** Não pode ser aprovada, receber pedido de ajustes nem comentário novo. Continua legível, com os comentários que recebeu.
- **Aprovação da entrega.** Falha com `409 PECAS_PENDENTES` enquanto alguma peça exigida não tiver a versão atual aprovada. A resposta lista cada peça e o motivo (`sem_versao`, `pendente`, `ajustes_pedidos`).
- **O status é calculado, não gravado.** O banco guarda só a data em que a marca aprovou. A entrega está `aprovada` quando essa data existe e não há pendência. Por isso uma versão nova numa peça exigida derruba o status para `em_producao` na hora, e ele volta quando essa versão é aprovada, sem ninguém aprovar a entrega de novo.
- **Peça não exigida não bloqueia.** Pode receber versão, comentário e decisão, e não entra na conta.
- **Comentário pertence a uma versão.** Em vídeo, `segundo` é obrigatório, inteiro, de 0 até a duração declarada. Nas outras peças o comentário não tem `segundo`. A versão nova nasce sem comentários.
- **Aprovar a entrega de novo** devolve o estado atual e mantém a data da primeira aprovação.

## API

| Método e rota | O que faz |
| --- | --- |
| `POST /campanhas` | Cria campanha. Corpo: `nome`, `pecasExigidas`. |
| `GET /campanhas/:id` | Campanha e peças exigidas. |
| `POST /campanhas/:id/entregas` | Cria entrega. Corpo: `criador`. |
| `GET /entregas/:id` | Status, pendências e a versão atual de cada peça. |
| `POST /entregas/:id/aprovacao` | Aprova a entrega, ou `409` com as pendências. |
| `POST /entregas/:id/pecas/:peca/versoes` | Envia versão. Corpo: `url`; em vídeo também `duracaoSegundos`. |
| `GET /entregas/:id/pecas/:peca/versoes` | Histórico de versões da peça. |
| `GET /versoes/:id` | Versão, se é a atual, e os comentários dela. |
| `POST /versoes/:id/aprovacao` | Aprova a versão. |
| `POST /versoes/:id/ajustes` | Pede ajustes na versão. |
| `POST /versoes/:id/comentarios` | Comenta. Corpo: `autor`, `texto`; em vídeo também `segundo`. |

Erros têm sempre `erro` (código) e `mensagem`. `400` é entrada fora do formato, `404` recurso inexistente, `409` conflito com o estado atual, `422` campo que não combina com a peça.

Exemplo de aprovação recusada:

```json
{
  "erro": "PECAS_PENDENTES",
  "mensagem": "A entrega não pode ser aprovada. Peças exigidas pendentes: video (versão atual aguardando aprovação), capa (sem versão enviada).",
  "pendencias": [
    { "peca": "video", "motivo": "pendente" },
    { "peca": "capa", "motivo": "sem_versao" }
  ]
}
```

## Decisões

- **Status derivado em vez de coluna.** Só existe um lugar que decide se a entrega está aprovada, e ele não fica dessincronizado das versões. O custo é calcular a cada leitura, com no máximo quatro peças.
- **SQLite com SQL direto.** Roda só com `npm install` e ainda tem chave estrangeira, `UNIQUE (entrega, peça, número)` e transação na numeração da versão. Os testes usam banco em memória.
- **Validação sem coerção.** `"12"` não vira `12` e campo desconhecido é `400`.

## Fora de escopo

- Autenticação e papéis. Qualquer chamada pode aprovar; `autor` e `criador` são texto livre.
- Upload de arquivo. A versão guarda uma `url`, e a duração do vídeo é a que o cliente declara.
- Editar as peças exigidas de uma campanha, e editar ou apagar comentários.
- Pagamento. Quem ligar pagamento ao status precisa tratar a queda e a volta da aprovação quando chega versão nova.
- Migrations: o schema é criado na abertura do banco.

## Uso de IA

O código, os testes e este README foram escritos com Claude Code (Claude Opus 5.5).

O que eu decidi, respondendo a perguntas de desenho antes de qualquer código: status da entrega derivado com aprovação registrada; comentário em qualquer peça, com `segundo` só em vídeo; estado `ajustes_pedidos`, final como a aprovação; peça não exigida aceita e ignorada; lista de exigidas imutável; aprovação idempotente; comentário só na versão atual; duração declarada no vídeo; Fastify, SQLite sem ORM e Vitest.

O que eu revisei: ainda não revisei o código linha a linha.
