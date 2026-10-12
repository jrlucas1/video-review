import Fastify from 'fastify';
import type { Banco } from './banco';
import { ErroDaApi } from './erros';
import { PECAS, type Peca } from './regra';
import { criarServico } from './servico';

const id = { type: 'string', pattern: '^[1-9][0-9]{0,14}$' } as const;
const texto = { type: 'string', pattern: '\\S', maxLength: 2000 } as const;

const paramsComId = {
  type: 'object',
  required: ['id'],
  properties: { id },
} as const;

const paramsComIdEPeca = {
  type: 'object',
  required: ['id', 'peca'],
  properties: { id, peca: { enum: PECAS } },
} as const;

const corpoDaCampanha = {
  type: 'object',
  required: ['nome', 'pecasExigidas'],
  additionalProperties: false,
  properties: {
    nome: texto,
    pecasExigidas: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: PECAS } },
  },
} as const;

const corpoDaEntrega = {
  type: 'object',
  required: ['criador'],
  additionalProperties: false,
  properties: { criador: texto },
} as const;

const corpoDaVersao = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: { url: texto, duracaoSegundos: { type: 'integer', minimum: 1 } },
} as const;

const corpoDoComentario = {
  type: 'object',
  required: ['autor', 'texto'],
  additionalProperties: false,
  properties: { autor: texto, texto, segundo: { type: 'integer', minimum: 0 } },
} as const;

type ComId = { Params: { id: string } };
type ComIdEPeca = { Params: { id: string; peca: Peca } };

export function criarApp(opcoes: { banco: Banco; agora?: () => Date }) {
  const servico = criarServico(opcoes.banco, opcoes.agora ?? (() => new Date()));

  // Sem coerção: "12" não vira 12 e campo desconhecido é erro, não é descartado.
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.setErrorHandler((erro: Error & { validation?: unknown }, _requisicao, resposta) => {
    if (erro instanceof ErroDaApi) {
      return resposta
        .status(erro.status)
        .send({ erro: erro.codigo, mensagem: erro.message, ...erro.detalhes });
    }
    if (erro.validation) {
      return resposta.status(400).send({ erro: 'ENTRADA_INVALIDA', mensagem: erro.message });
    }
    return resposta.send(erro);
  });

  app.post<{ Body: { nome: string; pecasExigidas: Peca[] } }>(
    '/campanhas',
    { schema: { body: corpoDaCampanha } },
    (requisicao, resposta) => resposta.status(201).send(servico.criarCampanha(requisicao.body)),
  );

  app.get<ComId>('/campanhas/:id', { schema: { params: paramsComId } }, (requisicao) =>
    servico.verCampanha(Number(requisicao.params.id)),
  );

  app.post<ComId & { Body: { criador: string } }>(
    '/campanhas/:id/entregas',
    { schema: { params: paramsComId, body: corpoDaEntrega } },
    (requisicao, resposta) =>
      resposta
        .status(201)
        .send(servico.criarEntrega(Number(requisicao.params.id), requisicao.body)),
  );

  app.get<ComId>('/entregas/:id', { schema: { params: paramsComId } }, (requisicao) =>
    servico.verEntrega(Number(requisicao.params.id)),
  );

  app.post<ComId>('/entregas/:id/aprovacao', { schema: { params: paramsComId } }, (requisicao) =>
    servico.aprovarEntrega(Number(requisicao.params.id)),
  );

  app.post<ComIdEPeca & { Body: { url: string; duracaoSegundos?: number } }>(
    '/entregas/:id/pecas/:peca/versoes',
    { schema: { params: paramsComIdEPeca, body: corpoDaVersao } },
    (requisicao, resposta) => {
      const { id, peca } = requisicao.params;
      return resposta.status(201).send(servico.enviarVersao(Number(id), peca, requisicao.body));
    },
  );

  app.get<ComIdEPeca>(
    '/entregas/:id/pecas/:peca/versoes',
    { schema: { params: paramsComIdEPeca } },
    (requisicao) => servico.listarVersoes(Number(requisicao.params.id), requisicao.params.peca),
  );

  app.get<ComId>('/versoes/:id', { schema: { params: paramsComId } }, (requisicao) =>
    servico.verVersao(Number(requisicao.params.id)),
  );

  app.post<ComId>('/versoes/:id/aprovacao', { schema: { params: paramsComId } }, (requisicao) =>
    servico.decidirVersao(Number(requisicao.params.id), 'aprovada'),
  );

  app.post<ComId>('/versoes/:id/ajustes', { schema: { params: paramsComId } }, (requisicao) =>
    servico.decidirVersao(Number(requisicao.params.id), 'ajustes_pedidos'),
  );

  app.post<ComId & { Body: { autor: string; texto: string; segundo?: number } }>(
    '/versoes/:id/comentarios',
    { schema: { params: paramsComId, body: corpoDoComentario } },
    (requisicao, resposta) =>
      resposta.status(201).send(servico.comentar(Number(requisicao.params.id), requisicao.body)),
  );

  return app;
}
