import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post, submit, submitAndApprove } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

// Entrega de campanha que exige vídeo e capa, já aprovada em START.
async function approvedDelivery(): Promise<number> {
  const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
  await submitAndApprove(ctx.app, deliveryId, 'video');
  await submitAndApprove(ctx.app, deliveryId, 'cover');
  const approval = await post(ctx.app, `/deliveries/${deliveryId}/approve`);
  expect(approval.body.status).toBe('approved');
  return deliveryId;
}

describe('entrega aprovada que recebe versão nova', () => {
  it('deixa de estar aprovada até a versão nova ser aprovada', async () => {
    const deliveryId = await approvedDelivery();

    ctx.now = new Date('2026-03-05T09:00:00.000Z');
    const newCover = await submit(ctx.app, deliveryId, 'cover');

    const afterSubmit = await get(ctx.app, `/deliveries/${deliveryId}`);
    expect(afterSubmit.body.status).toBe('in_production');
    expect(afterSubmit.body.pending).toEqual([{ piece: 'cover', reason: 'pending' }]);
    expect((await post(ctx.app, `/deliveries/${deliveryId}/approve`)).status).toBe(409);

    await post(ctx.app, `/versions/${newCover}/approve`);

    const afterApproval = await get(ctx.app, `/deliveries/${deliveryId}`);
    expect(afterApproval.body.status).toBe('approved');
    expect(afterApproval.body.approvedAt).toBe('2026-03-01T12:00:00.000Z');
  });

  it('continua em produção se a versão nova recebe pedido de ajustes', async () => {
    const deliveryId = await approvedDelivery();
    const newVideo = await submit(ctx.app, deliveryId, 'video');

    await post(ctx.app, `/versions/${newVideo}/request-changes`);

    const { body } = await get(ctx.app, `/deliveries/${deliveryId}`);
    expect(body.status).toBe('in_production');
    expect(body.pending).toEqual([{ piece: 'video', reason: 'changes_requested' }]);
  });

  it('versão nova em peça não exigida não desfaz a aprovação', async () => {
    const deliveryId = await approvedDelivery();

    await submit(ctx.app, deliveryId, 'script');

    expect((await get(ctx.app, `/deliveries/${deliveryId}`)).body.status).toBe('approved');
  });

  it('aprovar de novo é idempotente e mantém a data da primeira aprovação', async () => {
    const deliveryId = await approvedDelivery();

    ctx.now = new Date('2026-03-09T18:30:00.000Z');
    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'approved', approvedAt: '2026-03-01T12:00:00.000Z' });
  });
});
