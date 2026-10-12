import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

describe('entrada inválida', () => {
  it('vídeo exige duração; as outras peças não aceitam', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);

    const videoWithoutDuration = await post(ctx.app, `/deliveries/${deliveryId}/pieces/video/versions`, {
      url: 'https://cdn.test/video.mp4',
    });
    const coverWithDuration = await post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, {
      url: 'https://cdn.test/cover.png',
      durationSeconds: 10,
    });

    expect(videoWithoutDuration.status).toBe(422);
    expect(videoWithoutDuration.body.error).toBe('duration_required');
    expect(coverWithDuration.status).toBe(422);
    expect(coverWithDuration.body.error).toBe('duration_not_allowed');
  });

  it('recusa peça desconhecida, id malformado e campo desconhecido', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);

    const unknownPiece = await post(ctx.app, `/deliveries/${deliveryId}/pieces/thumbnail/versions`, {
      url: 'https://cdn.test/thumb.png',
    });
    const malformedId = await get(ctx.app, '/deliveries/abc');
    const unknownField = await post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, {
      url: 'https://cdn.test/cover.png',
      status: 'approved',
    });

    for (const response of [unknownPiece, malformedId, unknownField]) {
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_payload');
    }
  });

  it('responde 404 para campanha, entrega e versão que não existem', async () => {
    const responses = [
      await get(ctx.app, '/campaigns/999'),
      await post(ctx.app, '/campaigns/999/deliveries', { creator: 'ana' }),
      await get(ctx.app, '/deliveries/999'),
      await post(ctx.app, '/deliveries/999/approve'),
      await post(ctx.app, '/deliveries/999/pieces/video/versions', {
        url: 'https://cdn.test/video.mp4',
        durationSeconds: 10,
      }),
      await get(ctx.app, '/deliveries/999/pieces/video/versions'),
      await get(ctx.app, '/versions/999'),
      await post(ctx.app, '/versions/999/approve'),
      await post(ctx.app, '/versions/999/comments', { author: 'marca', text: 'x', second: 1 }),
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    }
  });
});
