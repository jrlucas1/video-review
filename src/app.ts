import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
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
  listVersions,
  submitVersion,
} from './service.ts';

export function buildApp(db: Db, clock: () => Date = () => new Date()): FastifyInstance {
  const app = Fastify({ ajv: { customOptions: STRICT_VALIDATION } });

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
      return reply
        .code(201)
        .send(submitVersion(db, Number(deliveryId), piece, request.body, clock()));
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
    (request) => decideVersion(db, Number(request.params.id), 'approved'),
  );

  app.post<{ Params: IdParams }>(
    '/versions/:id/request-changes',
    { schema: { params: idParams } },
    (request) => decideVersion(db, Number(request.params.id), 'changes_requested'),
  );

  app.post<{ Params: IdParams; Body: CommentBody }>(
    '/versions/:id/comments',
    { schema: { params: idParams, body: commentBody } },
    (request, reply) =>
      reply.code(201).send(addComment(db, Number(request.params.id), request.body, clock())),
  );

  return app;
}
