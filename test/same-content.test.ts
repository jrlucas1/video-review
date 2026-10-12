import { beforeEach, describe, expect, it } from 'vitest';
import { createContext, createDelivery, get, post } from './helpers.ts';
import type { TestContext } from './helpers.ts';

let ctx: TestContext;
let deliveryId: number;

beforeEach(async () => {
  ctx = createContext();
  deliveryId = await createDelivery(ctx.app, ['video', 'cover']);
});

const COVER = { url: 'https://cdn.test/capa-a.png' };
const VIDEO = { url: 'https://cdn.test/corte-a.mp4', durationSeconds: 30 };

function sendCover(payload: Record<string, unknown> = COVER) {
  return post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, payload);
}

function sendVideo(payload: Record<string, unknown> = VIDEO) {
  return post(ctx.app, `/deliveries/${deliveryId}/pieces/video/versions`, payload);
}

async function versionIds(piece: string): Promise<number[]> {
  const history = await get(ctx.app, `/deliveries/${deliveryId}/pieces/${piece}/versions`);
  return history.body.map((version: { id: number }) => version.id);
}

describe('envio com o mesmo conteúdo da versão atual', () => {
  it('não cria versão: responde 200 com a versão atual', async () => {
    const first = await sendCover();
    const again = await sendCover();

    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await versionIds('cover')).toEqual([first.body.id]);
  });

  it('enviado dez vezes em paralelo cria uma versão só', async () => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => sendCover()));

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 200)).toHaveLength(9);
    expect(await versionIds('cover')).toHaveLength(1);
  });

  it('no vídeo, a mesma url com outra duração é conteúdo novo', async () => {
    const first = await sendVideo();
    const same = await sendVideo();
    const otherDuration = await sendVideo({ ...VIDEO, durationSeconds: 31 });

    expect(same.status).toBe(200);
    expect(otherDuration.status).toBe(201);
    expect(otherDuration.body.number).toBe(2);
    expect(await versionIds('video')).toEqual([first.body.id, otherDuration.body.id]);
  });

  it('url diferente só em maiúsculas ou em um caractere é conteúdo novo', async () => {
    await sendCover();
    const upper = await sendCover({ url: 'https://cdn.test/CAPA-A.png' });
    const query = await sendCover({ url: 'https://cdn.test/CAPA-A.png?v=2' });

    expect([upper.status, query.status]).toEqual([201, 201]);
    expect(query.body.number).toBe(3);
  });

  it('compara só com a versão atual: conteúdo de uma versão antiga pode voltar', async () => {
    await sendCover();
    await sendCover({ url: 'https://cdn.test/capa-b.png' });
    const backToFirst = await sendCover();

    expect(backToFirst.status).toBe(201);
    expect(backToFirst.body.number).toBe(3);
  });

  it('o mesmo conteúdo em outra peça ou em outra entrega é versão nova', async () => {
    const otherDelivery = await createDelivery(ctx.app, ['cover']);
    await sendCover();

    const script = await post(ctx.app, `/deliveries/${deliveryId}/pieces/script/versions`, COVER);
    const elsewhere = await post(ctx.app, `/deliveries/${otherDelivery}/pieces/cover/versions`, COVER);

    expect([script.status, elsewhere.status]).toEqual([201, 201]);
  });

  it('reenviar o conteúdo que recebeu pedido de ajustes não cria versão nem limpa o pedido', async () => {
    const first = await sendCover();
    await post(ctx.app, `/versions/${first.body.id}/request-changes`);

    const again = await sendCover();

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'changes_requested' });
    const delivery = await get(ctx.app, `/deliveries/${deliveryId}`);
    expect(delivery.body.pending).toContainEqual({ piece: 'cover', reason: 'changes_requested' });
  });

  it('reenviar o conteúdo aprovado não desfaz a aprovação da entrega', async () => {
    const cover = await sendCover();
    const video = await sendVideo();
    await post(ctx.app, `/versions/${cover.body.id}/approve`);
    await post(ctx.app, `/versions/${video.body.id}/approve`);
    await post(ctx.app, `/deliveries/${deliveryId}/approve`);

    const again = await sendCover();

    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: cover.body.id, status: 'approved' });
    expect((await get(ctx.app, `/deliveries/${deliveryId}`)).body.status).toBe('approved');
  });

  it('a versão existente mantém a data do primeiro envio', async () => {
    const first = await sendCover();
    ctx.now = new Date('2026-03-05T09:00:00.000Z');

    const again = await sendCover();

    expect(again.body.createdAt).toBe(first.body.createdAt);
  });
});
