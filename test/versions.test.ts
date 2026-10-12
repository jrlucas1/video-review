import { beforeEach, describe, expect, it } from 'vitest';
import type { Piece } from '../src/approval.ts';
import { createContext, createDelivery, get, post, submit, submitAndApprove } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

describe('versão que substitui a anterior', () => {
  it('a versão nova vira a atual, pendente, e a anterior fica no histórico', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const v1 = await submitAndApprove(ctx.app, deliveryId, 'video');
    const v2 = await submit(ctx.app, deliveryId, 'video');

    const delivery = await get(ctx.app, `/deliveries/${deliveryId}`);
    const video = delivery.body.pieces.find((entry: { piece: Piece }) => entry.piece === 'video');
    expect(video.currentVersion).toMatchObject({ id: v2, number: 2, status: 'pending' });

    const first = await get(ctx.app, `/versions/${v1}`);
    const second = await get(ctx.app, `/versions/${v2}`);
    expect(first.body).toMatchObject({ number: 1, status: 'approved', current: false });
    expect(second.body).toMatchObject({ number: 2, current: true });

    const history = await get(ctx.app, `/deliveries/${deliveryId}/pieces/video/versions`);
    expect(history.body.map((version: { id: number }) => version.id)).toEqual([v1, v2]);
  });

  it('aprovação da versão anterior não vale para a entrega', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    await submitAndApprove(ctx.app, deliveryId, 'video');
    await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(409);
    expect(body.pending).toEqual([{ piece: 'video', reason: 'pending' }]);
  });

  it('versão substituída não pode mais ser aprovada nem receber pedido de ajustes', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const v1 = await submit(ctx.app, deliveryId, 'video');
    await submit(ctx.app, deliveryId, 'video');

    const approval = await post(ctx.app, `/versions/${v1}/approve`);
    const changes = await post(ctx.app, `/versions/${v1}/request-changes`);

    expect(approval.status).toBe(409);
    expect(approval.body.error).toBe('version_superseded');
    expect(changes.body.error).toBe('version_superseded');
    expect((await get(ctx.app, `/versions/${v1}`)).body.status).toBe('pending');
  });

  it('a numeração é por peça e por entrega', async () => {
    const deliveryA = await createDelivery(ctx.app, ['video', 'cover']);
    const deliveryB = await createDelivery(ctx.app, ['video']);
    await submit(ctx.app, deliveryA, 'video');
    await submit(ctx.app, deliveryA, 'video');

    const coverOfA = await submit(ctx.app, deliveryA, 'cover');
    const videoOfB = await submit(ctx.app, deliveryB, 'video');

    expect((await get(ctx.app, `/versions/${coverOfA}`)).body).toMatchObject({ number: 1, current: true });
    expect((await get(ctx.app, `/versions/${videoOfB}`)).body).toMatchObject({ number: 1, current: true });
  });
});

describe('versão atual entre entregas', () => {
  it('a versão atual de uma entrega não se mistura com a de outra', async () => {
    const deliveryA = await createDelivery(ctx.app, ['video']);
    const deliveryB = await createDelivery(ctx.app, ['video']);
    const videoOfA = await submit(ctx.app, deliveryA, 'video');
    const videoOfB = await submitAndApprove(ctx.app, deliveryB, 'video');

    const a = await get(ctx.app, `/deliveries/${deliveryA}`);
    const b = await get(ctx.app, `/deliveries/${deliveryB}`);

    const currentVideo = (body: { pieces: { piece: Piece; currentVersion: { id: number } }[] }) =>
      body.pieces.find((entry) => entry.piece === 'video')?.currentVersion.id;
    expect(currentVideo(a.body)).toBe(videoOfA);
    expect(currentVideo(b.body)).toBe(videoOfB);
    expect(a.body.pending).toEqual([{ piece: 'video', reason: 'pending' }]);
    expect(b.body.pending).toEqual([]);
    expect((await post(ctx.app, `/deliveries/${deliveryA}/approve`)).status).toBe(409);
  });
});

describe('decisão sobre a versão', () => {
  it('cada versão é decidida uma única vez', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const approved = await submitAndApprove(ctx.app, deliveryId, 'video');
    const cover = await submit(ctx.app, deliveryId, 'cover');
    await post(ctx.app, `/versions/${cover}/request-changes`);

    const repeated = await post(ctx.app, `/versions/${approved}/approve`);
    const undone = await post(ctx.app, `/versions/${approved}/request-changes`);
    const approvedAfterChanges = await post(ctx.app, `/versions/${cover}/approve`);

    for (const response of [repeated, undone, approvedAfterChanges]) {
      expect(response.status).toBe(409);
      expect(response.body.error).toBe('version_already_decided');
    }
    expect((await get(ctx.app, `/versions/${approved}`)).body.status).toBe('approved');
    expect((await get(ctx.app, `/versions/${cover}`)).body.status).toBe('changes_requested');
  });
});
