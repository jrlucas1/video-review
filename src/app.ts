import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { PIECES } from './approval.ts';
import type { Piece } from './approval.ts';
import type { Db } from './db.ts';
import {
  ReviewError,
  addComment,
  approveDelivery,
  createCampaign,
  createDelivery,
  decideVersion,
  getCampaign,
  getDelivery,
  getVersion,
  listVersions,
  submitVersion,
} from './service.ts';

const id = { type: 'string', pattern: '^[1-9][0-9]{0,14}$' };
const text = { type: 'string', pattern: '\\S', maxLength: 2000 };

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id },
};

const idAndPieceParams = {
  type: 'object',
  required: ['id', 'piece'],
  properties: { id, piece: { enum: PIECES } },
};

const campaignBody = {
  type: 'object',
  required: ['name', 'requiredPieces'],
  additionalProperties: false,
  properties: {
    name: text,
    requiredPieces: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: PIECES } },
  },
};

const deliveryBody = {
  type: 'object',
  required: ['creator'],
  additionalProperties: false,
  properties: { creator: text },
};

const versionBody = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: { url: text, durationSeconds: { type: 'integer', minimum: 1 } },
};

const commentBody = {
  type: 'object',
  required: ['author', 'text'],
  additionalProperties: false,
  properties: { author: text, text, second: { type: 'integer', minimum: 0 } },
};

type WithId = { Params: { id: string } };
type WithIdAndPiece = { Params: { id: string; piece: Piece } };

export function buildApp(db: Db, clock: () => Date = () => new Date()): FastifyInstance {
  // Sem coerção: "12" não vira 12, e campo desconhecido é erro em vez de ser descartado.
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  app.setErrorHandler((error: Error & { validation?: unknown }, _request, reply) => {
    if (error instanceof ReviewError) {
      return reply
        .code(error.status)
        .send({ error: error.code, message: error.message, ...error.details });
    }
    if (error.validation) {
      return reply.code(400).send({ error: 'invalid_payload', message: error.message });
    }
    return reply.send(error);
  });

  app.post<{ Body: { name: string; requiredPieces: Piece[] } }>(
    '/campaigns',
    { schema: { body: campaignBody } },
    (request, reply) => reply.code(201).send(createCampaign(db, request.body)),
  );

  app.get<WithId>('/campaigns/:id', { schema: { params: idParams } }, (request) =>
    getCampaign(db, Number(request.params.id)),
  );

  app.post<WithId & { Body: { creator: string } }>(
    '/campaigns/:id/deliveries',
    { schema: { params: idParams, body: deliveryBody } },
    (request, reply) =>
      reply.code(201).send(createDelivery(db, Number(request.params.id), request.body)),
  );

  app.get<WithId>('/deliveries/:id', { schema: { params: idParams } }, (request) =>
    getDelivery(db, Number(request.params.id)),
  );

  app.post<WithId>('/deliveries/:id/approve', { schema: { params: idParams } }, (request) =>
    approveDelivery(db, Number(request.params.id), clock()),
  );

  app.post<WithIdAndPiece & { Body: { url: string; durationSeconds?: number } }>(
    '/deliveries/:id/pieces/:piece/versions',
    { schema: { params: idAndPieceParams, body: versionBody } },
    (request, reply) => {
      const { id: deliveryId, piece } = request.params;
      return reply
        .code(201)
        .send(submitVersion(db, Number(deliveryId), piece, request.body, clock()));
    },
  );

  app.get<WithIdAndPiece>(
    '/deliveries/:id/pieces/:piece/versions',
    { schema: { params: idAndPieceParams } },
    (request) => listVersions(db, Number(request.params.id), request.params.piece),
  );

  app.get<WithId>('/versions/:id', { schema: { params: idParams } }, (request) =>
    getVersion(db, Number(request.params.id)),
  );

  app.post<WithId>('/versions/:id/approve', { schema: { params: idParams } }, (request) =>
    decideVersion(db, Number(request.params.id), 'approved'),
  );

  app.post<WithId>('/versions/:id/request-changes', { schema: { params: idParams } }, (request) =>
    decideVersion(db, Number(request.params.id), 'changes_requested'),
  );

  app.post<WithId & { Body: { author: string; text: string; second?: number } }>(
    '/versions/:id/comments',
    { schema: { params: idParams, body: commentBody } },
    (request, reply) =>
      reply.code(201).send(addComment(db, Number(request.params.id), request.body, clock())),
  );

  return app;
}
