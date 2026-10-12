import type { FastifyInstance } from 'fastify';
import type { Piece } from '../src/approval.ts';
import { buildApp } from '../src/app.ts';
import { openDatabase } from '../src/db.ts';
import type { Db } from '../src/db.ts';

export const START = '2026-03-01T12:00:00.000Z';
export const VIDEO_DURATION_SECONDS = 30;

export interface TestContext {
  app: FastifyInstance;
  db: Db;
  now: Date;
}

export function createContext(): TestContext {
  const db = openDatabase();
  const ctx: TestContext = { app: buildApp(db, () => ctx.now), db, now: new Date(START) };
  return ctx;
}

export async function post(app: FastifyInstance, url: string, payload?: Record<string, unknown>) {
  const response = await app.inject({ method: 'POST', url, payload });
  return { status: response.statusCode, body: response.json() };
}

export async function get(app: FastifyInstance, url: string) {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() };
}

export async function createDelivery(app: FastifyInstance, requiredPieces: Piece[]): Promise<number> {
  const campaign = await post(app, '/campaigns', { name: 'Lançamento', requiredPieces });
  const delivery = await post(app, `/campaigns/${campaign.body.id}/deliveries`, { creator: 'ana' });
  return delivery.body.id;
}

export async function submit(app: FastifyInstance, deliveryId: number, piece: Piece): Promise<number> {
  const payload =
    piece === 'video'
      ? { url: 'https://cdn.test/video.mp4', durationSeconds: VIDEO_DURATION_SECONDS }
      : { url: `https://cdn.test/${piece}` };
  const version = await post(app, `/deliveries/${deliveryId}/pieces/${piece}/versions`, payload);
  if (version.status !== 201) {
    throw new Error(`envio de ${piece} falhou: ${JSON.stringify(version.body)}`);
  }
  return version.body.id;
}

export async function submitAndApprove(
  app: FastifyInstance,
  deliveryId: number,
  piece: Piece,
): Promise<number> {
  const versionId = await submit(app, deliveryId, piece);
  const approval = await post(app, `/versions/${versionId}/approve`);
  if (approval.status !== 200) {
    throw new Error(`aprovação de ${piece} falhou: ${JSON.stringify(approval.body)}`);
  }
  return versionId;
}
