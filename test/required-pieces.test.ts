import { beforeEach, describe, expect, it } from 'vitest';
import type { Piece } from '../src/approval.ts';
import { createContext, createDelivery, get, post, submit, submitAndApprove } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

describe('aprovação da entrega', () => {
  it('aprovar com peça obrigatória pendente falha com erro claro', async () => {
    const deliveryId = await createDelivery(ctx.app, ['script', 'video', 'cover']);
    await submitAndApprove(ctx.app, deliveryId, 'script');
    await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(409);
    expect(body.error).toBe('pieces_pending');
    expect(body.message).toBe(
      'A entrega não pode ser aprovada. Peças exigidas pendentes: ' +
        'video (versão atual aguardando aprovação), cover (sem versão enviada).',
    );
    expect(body.pending).toEqual([
      { piece: 'video', reason: 'pending' },
      { piece: 'cover', reason: 'no_version' },
    ]);

    const delivery = await get(ctx.app, `/deliveries/${deliveryId}`);
    expect(delivery.body.status).toBe('in_production');
    expect(delivery.body.approvedAt).toBeNull();
  });

  it('aprova quando cada peça exigida tem versão aprovada', async () => {
    const deliveryId = await createDelivery(ctx.app, ['script', 'video', 'cover', 'caption']);
    for (const piece of ['script', 'video', 'cover', 'caption'] as const) {
      await submitAndApprove(ctx.app, deliveryId, piece);
    }

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'approved', approvedAt: '2026-03-01T12:00:00.000Z', pending: [] });
  });

  it('campanha só de vídeo não exige roteiro', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    await submitAndApprove(ctx.app, deliveryId, 'video');

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(200);
    expect(body.status).toBe('approved');
  });

  it('peça que a campanha não pediu não bloqueia, mesmo enviada e pendente', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    await submitAndApprove(ctx.app, deliveryId, 'video');
    await submit(ctx.app, deliveryId, 'script');
    const coverId = await submit(ctx.app, deliveryId, 'cover');
    await post(ctx.app, `/versions/${coverId}/request-changes`);

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(200);
    expect(body.status).toBe('approved');
  });

  it('versão com ajustes pedidos numa peça exigida bloqueia', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');
    await post(ctx.app, `/versions/${videoId}/request-changes`);

    const { status, body } = await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    expect(status).toBe(409);
    expect(body.pending).toEqual([{ piece: 'video', reason: 'changes_requested' }]);
  });

  it('peças todas aprovadas não aprovam a entrega sozinhas', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    await submitAndApprove(ctx.app, deliveryId, 'video');

    const { body } = await get(ctx.app, `/deliveries/${deliveryId}`);

    expect(body).toMatchObject({ status: 'in_production', pending: [] });
  });
});

describe('peças exigidas da campanha', () => {
  it('a lista é dado da campanha e aparece na entrega', async () => {
    const campaign = await post(ctx.app, '/campaigns', {
      name: 'Só capa e vídeo',
      requiredPieces: ['cover', 'video'],
    });
    const delivery = await post(ctx.app, `/campaigns/${campaign.body.id}/deliveries`, { creator: 'ana' });

    const stored = await get(ctx.app, `/campaigns/${campaign.body.id}`);
    expect(stored.body.requiredPieces).toEqual(['video', 'cover']);
    const required = delivery.body.pieces.map((entry: { piece: Piece; required: boolean }) => [
      entry.piece,
      entry.required,
    ]);
    expect(required).toEqual([
      ['script', false],
      ['video', true],
      ['cover', true],
      ['caption', false],
    ]);
  });

  it.each([
    ['vazia', []],
    ['com peça repetida', ['video', 'video']],
    ['com peça desconhecida', ['video', 'thumbnail']],
  ])('recusa campanha com lista %s', async (_case, requiredPieces) => {
    const { status, body } = await post(ctx.app, '/campaigns', { name: 'Inválida', requiredPieces });

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_payload');
  });
});
