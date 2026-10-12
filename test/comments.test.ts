import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post, submit } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;

beforeEach(() => {
  ctx = createContext();
});

function comment(versionId: number, payload: Record<string, unknown>) {
  return post(ctx.app, `/versions/${versionId}/comments`, { author: 'marca', text: 'Ajustar', ...payload });
}

async function commentsOf(versionId: number) {
  return (await get(ctx.app, `/versions/${versionId}`)).body.comments;
}

describe('comentário preso à versão', () => {
  it('fica preso ao segundo e visível na versão em que foi feito', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await comment(videoId, { text: 'Logo cortado aqui', second: 12 });

    expect(status).toBe(201);
    expect(body).toMatchObject({ versionId: videoId, second: 12, text: 'Logo cortado aqui' });
    expect(await commentsOf(videoId)).toEqual([body]);
  });

  it('não migra sozinho para a versão nova', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const v1 = await submit(ctx.app, deliveryId, 'video');
    await comment(v1, { text: 'Trocar a trilha', second: 5 });

    const v2 = await submit(ctx.app, deliveryId, 'video');

    expect(await commentsOf(v2)).toEqual([]);
    expect(await commentsOf(v1)).toMatchObject([{ versionId: v1, second: 5 }]);
  });

  it('comentário feito na versão nova não aparece na anterior', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const v1 = await submit(ctx.app, deliveryId, 'video');
    const v2 = await submit(ctx.app, deliveryId, 'video');

    await comment(v2, { second: 5 });

    expect(await commentsOf(v1)).toEqual([]);
    expect(await commentsOf(v2)).toHaveLength(1);
  });

  it('versão substituída não aceita comentário novo', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const v1 = await submit(ctx.app, deliveryId, 'video');
    await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await comment(v1, { second: 1 });

    expect(status).toBe(409);
    expect(body.error).toBe('version_superseded');
  });

  it('lista na ordem do vídeo; empate fica na ordem de criação', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');
    await comment(videoId, { text: 'c', second: 20 });
    await comment(videoId, { text: 'a', second: 3 });
    await comment(videoId, { text: 'b', second: 3 });

    const comments = await commentsOf(videoId);

    expect(comments.map((entry: { text: string }) => entry.text)).toEqual(['a', 'b', 'c']);
  });
});

describe('segundo do comentário', () => {
  it('aceita o segundo 0 e o último segundo do vídeo; recusa o seguinte', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');

    const first = await comment(videoId, { second: 0 });
    const last = await comment(videoId, { second: 30 });
    const beyond = await comment(videoId, { second: 31 });

    expect(first.status).toBe(201);
    expect(last.status).toBe(201);
    expect(beyond.status).toBe(422);
    expect(beyond.body.error).toBe('second_out_of_range');
  });

  it.each([
    ['negativo', -1],
    ['fracionário', 1.5],
    ['em texto', '12'],
    ['nulo', null],
  ])('recusa segundo %s', async (_case, second) => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await comment(videoId, { second });

    expect(status).toBe(400);
    expect(body.error).toBe('invalid_payload');
    expect(await commentsOf(videoId)).toEqual([]);
  });

  it('em vídeo o segundo é obrigatório', async () => {
    const deliveryId = await createDelivery(ctx.app, ['video']);
    const videoId = await submit(ctx.app, deliveryId, 'video');

    const { status, body } = await comment(videoId, {});

    expect(status).toBe(422);
    expect(body.error).toBe('second_required');
  });

  it('nas outras peças o comentário não tem segundo', async () => {
    const deliveryId = await createDelivery(ctx.app, ['script']);
    const scriptId = await submit(ctx.app, deliveryId, 'script');

    const withoutSecond = await comment(scriptId, { text: 'Encurtar' });
    const withSecond = await comment(scriptId, { second: 3 });

    expect(withoutSecond.status).toBe(201);
    expect(withoutSecond.body.second).toBeNull();
    expect(withSecond.status).toBe(422);
    expect(withSecond.body.error).toBe('second_not_allowed');
  });
});
