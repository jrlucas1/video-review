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
  const ctx: TestContext = { app: buildApp(db, { clock: () => ctx.now }), db, now: new Date(START) };
  return ctx;
}

export interface Actor {
  role: 'brand' | 'creator';
  user: string;
}

export const BRAND: Actor = { role: 'brand', user: 'marca' };
export const CREATOR: Actor = { role: 'creator', user: 'ana' };

function identity(actor: Actor): Record<string, string> {
  return { 'x-role': actor.role, 'x-user': actor.user };
}

function defaultActor(method: 'GET' | 'POST', url: string): Actor {
  const submitsVersion = method === 'POST' && /\/pieces\/[^/]+\/versions$/.test(url);
  return submitsVersion ? CREATOR : BRAND;
}

export async function post(
  app: FastifyInstance,
  url: string,
  payload?: Record<string, unknown>,
  actor: Actor = defaultActor('POST', url),
) {
  const response = await app.inject({ method: 'POST', url, payload, headers: identity(actor) });
  return { status: response.statusCode, body: response.json() };
}

export async function get(app: FastifyInstance, url: string, actor: Actor = defaultActor('GET', url)) {
  const response = await app.inject({ method: 'GET', url, headers: identity(actor) });
  return { status: response.statusCode, body: response.json() };
}

export async function createDelivery(app: FastifyInstance, requiredPieces: Piece[]): Promise<number> {
  const campaign = await post(app, '/campaigns', { name: 'Lançamento', requiredPieces });
  const delivery = await post(app, `/campaigns/${campaign.body.id}/deliveries`, { creator: 'ana' });
  return delivery.body.id;
}

let submissions = 0;

export async function submit(app: FastifyInstance, deliveryId: number, piece: Piece): Promise<number> {
  submissions += 1;
  const url = `https://cdn.test/${piece}-${submissions}`;
  const payload = piece === 'video' ? { url, durationSeconds: VIDEO_DURATION_SECONDS } : { url };
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
