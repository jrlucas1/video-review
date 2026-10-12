import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post, submit, submitAndApprove } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

interface DeliveryEvent {
  id: number;
  type: string;
  versions: { piece: string; versionId: number; number: number }[];
  createdAt: string;
}

async function eventsOf(deliveryId: number): Promise<DeliveryEvent[]> {
  const { status, body } = await get(ctx.app, `/deliveries/${deliveryId}/events`);
  expect(status).toBe(200);
  return body;
}

async function approvedVideoAndCoverDelivery() {
  const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
  const video = await submitAndApprove(ctx.app, deliveryId, 'video');
  const cover = await submitAndApprove(ctx.app, deliveryId, 'cover');
  await post(ctx.app, `/deliveries/${deliveryId}/approve`);
  return { deliveryId, video, cover };
}

describe('log de eventos da entrega', () => {
  it('entrega nova não tem eventos', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);

    expect(await eventsOf(deliveryId)).toEqual([]);
  });

  it('aprovação grava as versões aprovadas das peças exigidas, na ordem das peças', async () => {
    const deliveryId = await createDelivery(ctx.app, ['cover', 'video']);
    await submit(ctx.app, deliveryId, 'video');
    const video = await submitAndApprove(ctx.app, deliveryId, 'video');
    const cover = await submitAndApprove(ctx.app, deliveryId, 'cover');
    await submitAndApprove(ctx.app, deliveryId, 'script');

    ctx.now = new Date('2026-03-02T10:00:00.000Z');
    await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(await eventsOf(deliveryId)).toEqual([
      {
        id: expect.any(Number),
        type: 'approved',
        versions: [
          { piece: 'video', versionId: video, number: 2 },
          { piece: 'cover', versionId: cover, number: 1 },
        ],
        createdAt: '2026-03-02T10:00:00.000Z',
      },
    ]);
  });

  it('aprovação recusada por peça pendente não grava evento', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
    await submitAndApprove(ctx.app, deliveryId, 'video');

    const approval = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(approval.status).toBe(409);
    expect(await eventsOf(deliveryId)).toEqual([]);
  });

  it('aprovar de novo não grava outro evento', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();

    await post(ctx.app, `/deliveries/${deliveryId}/approve`);
    await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved']);
  });

  it('versão nova de peça exigida desfaz a aprovação e o evento diz qual peça e qual versão', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();

    ctx.now = new Date('2026-03-05T09:00:00.000Z');
    const newCover = await submit(ctx.app, deliveryId, 'cover');

    const events = await eventsOf(deliveryId);
    expect(events.map((event) => event.type)).toEqual(['approved', 'approval_undone']);
    expect(events[1]).toMatchObject({
      versions: [{ piece: 'cover', versionId: newCover, number: 2 }],
      createdAt: '2026-03-05T09:00:00.000Z',
    });
  });

  it('com a aprovação já desfeita, outra versão nova não grava outro evento', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();
    await submit(ctx.app, deliveryId, 'cover');

    await submit(ctx.app, deliveryId, 'cover');
    await submit(ctx.app, deliveryId, 'video');

    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved', 'approval_undone']);
  });

  it('aprovar a versão nova restaura a aprovação, com as versões que valem agora', async () => {
    const { deliveryId, video } = await approvedVideoAndCoverDelivery();
    const newCover = await submit(ctx.app, deliveryId, 'cover');

    ctx.now = new Date('2026-03-06T15:00:00.000Z');
    await post(ctx.app, `/versions/${newCover}/approve`);

    const events = await eventsOf(deliveryId);
    expect(events.map((event) => event.type)).toEqual(['approved', 'approval_undone', 'approval_restored']);
    expect(events[2]).toMatchObject({
      versions: [
        { piece: 'video', versionId: video, number: 1 },
        { piece: 'cover', versionId: newCover, number: 2 },
      ],
      createdAt: '2026-03-06T15:00:00.000Z',
    });
  });

  it('com duas peças reabertas, só a aprovação da última restaura', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();
    const newCover = await submit(ctx.app, deliveryId, 'cover');
    const newVideo = await submit(ctx.app, deliveryId, 'video');

    await post(ctx.app, `/versions/${newCover}/approve`);
    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved', 'approval_undone']);

    await post(ctx.app, `/versions/${newVideo}/approve`);
    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual([
      'approved',
      'approval_undone',
      'approval_restored',
    ]);
  });

  it('pedido de ajustes na versão nova não restaura; a versão seguinte aprovada, sim', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();
    const second = await submit(ctx.app, deliveryId, 'cover');
    await post(ctx.app, `/versions/${second}/request-changes`);
    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved', 'approval_undone']);

    const third = await submit(ctx.app, deliveryId, 'cover');
    await post(ctx.app, `/versions/${third}/approve`);

    const events = await eventsOf(deliveryId);
    expect(events.map((event) => event.type)).toEqual(['approved', 'approval_undone', 'approval_restored']);
    expect(events[2]?.versions).toContainEqual({ piece: 'cover', versionId: third, number: 3 });
  });

  it('desfazer e restaurar duas vezes grava os dois ciclos em ordem', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();
    for (let cycle = 0; cycle < 2; cycle++) {
      const version = await submit(ctx.app, deliveryId, 'video');
      await post(ctx.app, `/versions/${version}/approve`);
    }

    const events = await eventsOf(deliveryId);
    expect(events.map((event) => event.type)).toEqual([
      'approved',
      'approval_undone',
      'approval_restored',
      'approval_undone',
      'approval_restored',
    ]);
    expect(events.map((event) => event.id)).toEqual([...events.map((event) => event.id)].sort((a, b) => a - b));
  });

  it('versão de peça não exigida não grava evento', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();

    const script = await submit(ctx.app, deliveryId, 'script');
    await post(ctx.app, `/versions/${script}/approve`);

    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved']);
  });

  it('aprovar versões antes da primeira aprovação da entrega não grava evento', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
    await submitAndApprove(ctx.app, deliveryId, 'video');
    await submitAndApprove(ctx.app, deliveryId, 'cover');

    expect(await eventsOf(deliveryId)).toEqual([]);
  });

  it('reenviar o mesmo conteúdo da versão atual não grava evento', async () => {
    const deliveryId = await createDelivery(ctx.app, ['cover']);
    const payload = { url: 'https://cdn.test/capa-final.png' };
    const cover = await post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, payload);
    await post(ctx.app, `/versions/${cover.body.id}/approve`);
    await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    await post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, payload);

    expect((await eventsOf(deliveryId)).map((event) => event.type)).toEqual(['approved']);
  });

  it('os eventos de uma entrega não aparecem em outra', async () => {
    const { deliveryId } = await approvedVideoAndCoverDelivery();
    const other = await createDelivery(ctx.app, ['video']);

    expect(await eventsOf(deliveryId)).toHaveLength(1);
    expect(await eventsOf(other)).toEqual([]);
  });

  it('entrega inexistente responde 404', async () => {
    const { status, body } = await get(ctx.app, '/deliveries/999/events');

    expect(status).toBe(404);
    expect(body.error).toBe('not_found');
  });

  it('o banco recusa tipo de evento fora da lista', () => {
    ctx.db.prepare("INSERT INTO campaigns (id, name) VALUES (9, 'x')").run();
    ctx.db.prepare("INSERT INTO deliveries (id, campaign_id, creator) VALUES (9, 9, 'ana')").run();
    const insert = ctx.db.prepare(
      "INSERT INTO delivery_events (delivery_id, type, versions, created_at) VALUES (9, ?, '[]', '2026-03-01T12:00:00.000Z')",
    );

    expect(() => insert.run('approved')).not.toThrow();
    expect(() => insert.run('rejected')).toThrow(/CHECK/);
  });
});
