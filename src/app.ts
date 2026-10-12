import Fastify from 'fastify';
import type { FastifyError, FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import {
  STRICT_VALIDATION,
  campaignBody,
  commentBody,
  deliveryBody,
  idAndPieceParams,
  idParams,
  versionBody,
} from './schemas.ts';
import type {
  CampaignBody,
  CommentBody,
  DeliveryBody,
  IdAndPieceParams,
  IdParams,
  VersionBody,
} from './schemas.ts';
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
  listDeliveryEvents,
  listVersions,
  submitVersion,
} from './service.ts';

export interface AppOptions {
  clock?: () => Date;
  logger?: boolean;
}

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  FST_ERR_CTP_INVALID_JSON_BODY: 'O corpo não é um JSON válido.',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'O corpo está vazio, mas o content-type é JSON.',
};

export function buildApp(db: Db, options: AppOptions = {}): FastifyInstance {
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: STRICT_VALIDATION },
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'Rota não existe.' }),
  );

  app.setErrorHandler((error: FastifyError | ReviewError, request, reply) => {
    if (error instanceof ReviewError) {
      return reply
        .code(error.status)
        .send({ error: error.code, message: error.message, ...error.details });
    }
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.code(error.statusCode).send({
        error: 'invalid_payload',
        message: CLIENT_ERROR_MESSAGES[error.code] ?? error.message,
      });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: 'Erro interno.' });
  });

  app.post<{ Body: CampaignBody }>(
    '/campaigns',
    { schema: { body: campaignBody } },
    (request, reply) => reply.code(201).send(createCampaign(db, request.body)),
  );

  app.get<{ Params: IdParams }>('/campaigns/:id', { schema: { params: idParams } }, (request) =>
    getCampaign(db, Number(request.params.id)),
  );

  app.post<{ Params: IdParams; Body: DeliveryBody }>(
    '/campaigns/:id/deliveries',
    { schema: { params: idParams, body: deliveryBody } },
    (request, reply) =>
      reply.code(201).send(createDelivery(db, Number(request.params.id), request.body)),
  );

  app.get<{ Params: IdParams }>('/deliveries/:id', { schema: { params: idParams } }, (request) =>
    getDelivery(db, Number(request.params.id)),
  );

  app.get<{ Params: IdParams }>(
    '/deliveries/:id/events',
    { schema: { params: idParams } },
    (request) => listDeliveryEvents(db, Number(request.params.id)),
  );

  app.post<{ Params: IdParams }>(
    '/deliveries/:id/approve',
    { schema: { params: idParams } },
    (request) => approveDelivery(db, Number(request.params.id), clock()),
  );

  app.post<{ Params: IdAndPieceParams; Body: VersionBody }>(
    '/deliveries/:id/pieces/:piece/versions',
    { schema: { params: idAndPieceParams, body: versionBody } },
    (request, reply) => {
      const { id: deliveryId, piece } = request.params;
      const { version, created } = submitVersion(db, Number(deliveryId), piece, request.body, clock());
      return reply.code(created ? 201 : 200).send(version);
    },
  );

  app.get<{ Params: IdAndPieceParams }>(
    '/deliveries/:id/pieces/:piece/versions',
    { schema: { params: idAndPieceParams } },
    (request) => listVersions(db, Number(request.params.id), request.params.piece),
  );

  app.get<{ Params: IdParams }>('/versions/:id', { schema: { params: idParams } }, (request) =>
    getVersion(db, Number(request.params.id)),
  );

  app.post<{ Params: IdParams }>(
    '/versions/:id/approve',
    { schema: { params: idParams } },
    (request) => decideVersion(db, Number(request.params.id), 'approved', clock()),
  );

  app.post<{ Params: IdParams }>(
    '/versions/:id/request-changes',
    { schema: { params: idParams } },
    (request) => decideVersion(db, Number(request.params.id), 'changes_requested', clock()),
  );

  app.post<{ Params: IdParams; Body: CommentBody }>(
    '/versions/:id/comments',
    { schema: { params: idParams, body: commentBody } },
    (request, reply) =>
      reply.code(201).send(addComment(db, Number(request.params.id), request.body, clock())),
  );

  return app;
}
