import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post, submit, submitAndApprove } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

interface DeliveryBody {
  status: string;
  approvedAt: string | null;
  pending: unknown[];
  pieces: { required: boolean; currentVersion: { id: number; status: string } | null }[];
}

async function expectConsistent(deliveryId: number): Promise<DeliveryBody> {
  const delivery: DeliveryBody = (await get(ctx.app, `/deliveries/${deliveryId}`)).body;
  const events: { type: string; versions: { versionId: number }[] }[] = (
    await get(ctx.app, `/deliveries/${deliveryId}/events`)
  ).body;

  const requiredStatuses = delivery.pieces
    .filter((entry) => entry.required)
    .map((entry) => entry.currentVersion?.status);
  if (delivery.status === 'approved') {
    expect(requiredStatuses.every((status) => status === 'approved')).toBe(true);
    expect(delivery.pending).toEqual([]);
  }

  const lastEvent = events.at(-1);
  if (delivery.approvedAt === null) {
    expect(events).toEqual([]);
  } else if (delivery.status === 'approved') {
    expect(['approved', 'approval_restored']).toContain(lastEvent?.type);
  } else {
    expect(lastEvent?.type).toBe('approval_undone');
  }
  for (const event of events.filter((entry) => entry.type !== 'approval_undone')) {
    for (const { versionId } of event.versions) {
      expect((await get(ctx.app, `/versions/${versionId}`)).body.status).toBe('approved');
    }
  }
  return delivery;
}

describe('aprovar a entrega contra versão nova', () => {
  it.each([
    ['aprovação disparada antes', true],
    ['versão nova disparada antes', false],
  ])('%s: nunca termina aprovada com versão atual pendente', async (_name, approveFirst) => {
    for (let round = 0; round < 25; round++) {
      const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
      await submitAndApprove(ctx.app, deliveryId, 'video');
      await submitAndApprove(ctx.app, deliveryId, 'cover');

      const approve = () => post(ctx.app, `/deliveries/${deliveryId}/approve`);
      const newVersion = () => submit(ctx.app, deliveryId, 'cover');
      const [first, second] = approveFirst ? [approve(), newVersion()] : [newVersion(), approve()];
      await Promise.all([first, second]);

      const delivery = await expectConsistent(deliveryId);
      expect(delivery.status).toBe('in_production');
      expect(delivery.pending).toEqual([{ piece: 'cover', reason: 'pending' }]);
    }
  });

  it('muitas aprovações e versões novas misturadas mantêm status e log coerentes', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
    await submitAndApprove(ctx.app, deliveryId, 'video');
    await submitAndApprove(ctx.app, deliveryId, 'cover');

    for (let round = 0; round < 15; round++) {
      const calls: Promise<unknown>[] = [
        post(ctx.app, `/deliveries/${deliveryId}/approve`),
        post(ctx.app, `/deliveries/${deliveryId}/approve`),
      ];
      if (round % 3 !== 2) calls.splice(1, 0, submit(ctx.app, deliveryId, round % 2 === 0 ? 'cover' : 'video'));
      await Promise.all(calls);
      await expectConsistent(deliveryId);

      const delivery: DeliveryBody = (await get(ctx.app, `/deliveries/${deliveryId}`)).body;
      for (const entry of delivery.pieces) {
        if (entry.currentVersion?.status === 'pending') {
          await post(ctx.app, `/versions/${entry.currentVersion.id}/approve`);
        }
      }
      await expectConsistent(deliveryId);
    }

    const final = await expectConsistent(deliveryId);
    expect(final.status).toBe('approved');
  });

  it('aprovação e aprovação da última versão pendente ao mesmo tempo: aprovada só com tudo aprovado', async () => {
    for (let round = 0; round < 25; round++) {
      const deliveryId = await createDelivery(ctx.app, ['video']);
      const video = await submit(ctx.app, deliveryId, 'video');

      const [approval] = await Promise.all([
        post(ctx.app, `/deliveries/${deliveryId}/approve`),
        post(ctx.app, `/versions/${video}/approve`),
      ]);

      const delivery = await expectConsistent(deliveryId);
      expect(delivery.status).toBe(approval.status === 200 ? 'approved' : 'in_production');
    }
  });
});
