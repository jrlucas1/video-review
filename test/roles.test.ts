import { beforeEach, describe, expect, it } from 'vitest';
import { BRAND, CREATOR, createContext, createDelivery, get, post, submit } from './helpers.ts';
import type { Actor, TestContext } from './helpers.ts';

const OTHER_BRAND: Actor = { role: 'brand', user: 'outra-marca' };
const OTHER_CREATOR: Actor = { role: 'creator', user: 'bia' };

let ctx: TestContext;
let campaignId: number;
let deliveryId: number;
let versionId: number;

beforeEach(async () => {
  ctx = createContext();
  deliveryId = await createDelivery(ctx.app, ['cover']);
  campaignId = (await get(ctx.app, `/deliveries/${deliveryId}`)).body.campaignId;
  versionId = await submit(ctx.app, deliveryId, 'cover');
});

const COVER = { url: 'https://cdn.test/capa-nova.png' };
const COMMENT = { author: 'alguém', text: 'ajustar a cor' };

type Call = (actor: Actor) => Promise<{ status: number; body: { error?: string; message?: string } }>;

const calls = {
  createCampaign: (actor) => post(ctx.app, '/campaigns', { name: 'Outra', requiredPieces: ['video'] }, actor),
  readCampaign: (actor) => get(ctx.app, `/campaigns/${campaignId}`, actor),
  createDelivery: (actor) => post(ctx.app, `/campaigns/${campaignId}/deliveries`, { creator: 'caio' }, actor),
  readDelivery: (actor) => get(ctx.app, `/deliveries/${deliveryId}`, actor),
  readEvents: (actor) => get(ctx.app, `/deliveries/${deliveryId}/events`, actor),
  approveDelivery: (actor) => post(ctx.app, `/deliveries/${deliveryId}/approve`, undefined, actor),
  submitVersion: (actor) => post(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, COVER, actor),
  listVersions: (actor) => get(ctx.app, `/deliveries/${deliveryId}/pieces/cover/versions`, actor),
  readVersion: (actor) => get(ctx.app, `/versions/${versionId}`, actor),
  approveVersion: (actor) => post(ctx.app, `/versions/${versionId}/approve`, undefined, actor),
  requestChanges: (actor) => post(ctx.app, `/versions/${versionId}/request-changes`, undefined, actor),
  comment: (actor) => post(ctx.app, `/versions/${versionId}/comments`, COMMENT, actor),
} satisfies Record<string, Call>;

type CallName = keyof typeof calls;
const ALL_CALLS = Object.keys(calls) as CallName[];

const BRAND_OWNER_CAN: CallName[] = [
  'createCampaign',
  'readCampaign',
  'createDelivery',
  'readDelivery',
  'readEvents',
  'listVersions',
  'readVersion',
  'comment',
  'requestChanges',
];
const CREATOR_OWNER_CAN: CallName[] = [
  'readDelivery',
  'readEvents',
  'listVersions',
  'readVersion',
  'comment',
  'submitVersion',
];

async function expectForbidden(name: CallName, actor: Actor) {
  const { status, body } = await calls[name](actor);
  expect(status, `${name} como ${actor.role}:${actor.user}`).toBe(403);
  expect(body).toEqual({ error: 'forbidden', message: expect.any(String) });
}

async function expectAllowed(name: CallName, actor: Actor) {
  const { status } = await calls[name](actor);
  expect([200, 201], `${name} como ${actor.role}:${actor.user}`).toContain(status);
}

describe('papéis por header', () => {
  it('a marca dona da campanha faz o que é da marca', async () => {
    for (const name of BRAND_OWNER_CAN) {
      await expectAllowed(name, BRAND);
    }
  });

  it('a marca dona aprova a versão e depois a entrega', async () => {
    await expectAllowed('approveVersion', BRAND);
    await expectAllowed('approveDelivery', BRAND);
  });

  it('a marca não envia versão, nem na própria campanha', async () => {
    await expectForbidden('submitVersion', BRAND);

    expect((await calls.listVersions(BRAND)).body).toHaveLength(1);
  });

  it('o criador dono da entrega faz o que é do criador', async () => {
    for (const name of CREATOR_OWNER_CAN) {
      await expectAllowed(name, CREATOR);
    }
  });

  it('o criador dono da entrega não faz o que é da marca', async () => {
    const brandOnly = ALL_CALLS.filter((name) => !CREATOR_OWNER_CAN.includes(name));
    expect(brandOnly).toEqual([
      'createCampaign',
      'readCampaign',
      'createDelivery',
      'approveDelivery',
      'approveVersion',
      'requestChanges',
    ]);

    for (const name of brandOnly) {
      await expectForbidden(name, CREATOR);
    }
    expect((await calls.readVersion(BRAND)).body.status).toBe('pending');
    expect((await calls.readDelivery(BRAND)).body.approvedAt).toBeNull();
  });

  it('outra marca não lê nem altera nada da campanha', async () => {
    for (const name of ALL_CALLS.filter((entry) => entry !== 'createCampaign')) {
      await expectForbidden(name, OTHER_BRAND);
    }
    expect((await calls.readVersion(BRAND)).body).toMatchObject({ status: 'pending', comments: [] });
  });

  it('outro criador não lê nem altera nada da entrega', async () => {
    for (const name of ALL_CALLS) {
      await expectForbidden(name, OTHER_CREATOR);
    }
    expect((await calls.listVersions(BRAND)).body).toHaveLength(1);
    expect((await calls.readVersion(BRAND)).body.comments).toEqual([]);
  });

  it('o mesmo usuário com o papel trocado não ganha o que é do outro papel', async () => {
    await expectForbidden('approveVersion', { role: 'creator', user: BRAND.user });
    await expectForbidden('approveDelivery', { role: 'creator', user: BRAND.user });
    await expectForbidden('submitVersion', { role: 'brand', user: CREATOR.user });
    await expectForbidden('readDelivery', { role: 'brand', user: CREATOR.user });
    await expectForbidden('readDelivery', { role: 'creator', user: BRAND.user });
  });

  it('o usuário é comparado por inteiro, com maiúsculas', async () => {
    await expectForbidden('readDelivery', { role: 'creator', user: 'ANA' });
    await expectForbidden('readDelivery', { role: 'brand', user: 'Marca' });
  });

  it('a campanha guarda quem a criou e cada marca só alcança a sua', async () => {
    const mine = await post(ctx.app, '/campaigns', { name: 'Da outra', requiredPieces: ['video'] }, OTHER_BRAND);

    expect(mine.body.brand).toBe('outra-marca');
    expect((await get(ctx.app, `/campaigns/${mine.body.id}`, OTHER_BRAND)).status).toBe(200);
    expect((await get(ctx.app, `/campaigns/${mine.body.id}`, BRAND)).status).toBe(403);
  });

  it('o criador da entrega é o que a marca informou ao criá-la', async () => {
    const delivery = await post(ctx.app, `/campaigns/${campaignId}/deliveries`, { creator: 'bia' });

    const asBia = await post(ctx.app, `/deliveries/${delivery.body.id}/pieces/cover/versions`, COVER, OTHER_CREATOR);
    const asAna = await post(ctx.app, `/deliveries/${delivery.body.id}/pieces/cover/versions`, COVER, CREATOR);

    expect(asBia.status).toBe(201);
    expect(asAna.status).toBe(403);
  });

  it('o que não existe responde 404 para qualquer papel', async () => {
    for (const actor of [BRAND, CREATOR, OTHER_BRAND]) {
      expect((await get(ctx.app, '/deliveries/999', actor)).status).toBe(404);
      expect((await get(ctx.app, '/versions/999', actor)).status).toBe(404);
      expect((await post(ctx.app, '/versions/999/approve', undefined, actor)).status).toBe(404);
    }
  });
});

describe('requisição sem identidade', () => {
  const inject = (headers: Record<string, string>) =>
    ctx.app.inject({ method: 'GET', url: `/deliveries/${deliveryId}`, headers });

  it.each([
    ['sem headers', {}],
    ['sem X-Role', { 'x-user': 'ana' }],
    ['sem X-User', { 'x-role': 'creator' }],
    ['com papel desconhecido', { 'x-role': 'admin', 'x-user': 'ana' }],
    ['com papel em maiúsculas', { 'x-role': 'Creator', 'x-user': 'ana' }],
    ['com usuário vazio', { 'x-role': 'creator', 'x-user': '' }],
    ['com usuário só de espaços', { 'x-role': 'creator', 'x-user': '   ' }],
  ])('%s responde 401', async (_name, headers) => {
    const response = await inject(headers);

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'unauthenticated', message: expect.any(String) });
  });

  it('nenhuma rota atende sem identidade, e nada é gravado', async () => {
    const anonymous = [
      ['POST', '/campaigns', { name: 'Anônima', requiredPieces: ['video'] }],
      ['GET', `/campaigns/${campaignId}`, undefined],
      ['POST', `/campaigns/${campaignId}/deliveries`, { creator: 'caio' }],
      ['GET', `/deliveries/${deliveryId}`, undefined],
      ['GET', `/deliveries/${deliveryId}/events`, undefined],
      ['POST', `/deliveries/${deliveryId}/approve`, undefined],
      ['POST', `/deliveries/${deliveryId}/pieces/cover/versions`, COVER],
      ['GET', `/deliveries/${deliveryId}/pieces/cover/versions`, undefined],
      ['GET', `/versions/${versionId}`, undefined],
      ['POST', `/versions/${versionId}/approve`, undefined],
      ['POST', `/versions/${versionId}/request-changes`, undefined],
      ['POST', `/versions/${versionId}/comments`, COMMENT],
    ] as const;

    for (const [method, url, payload] of anonymous) {
      const response = await ctx.app.inject({ method, url, payload });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
    expect((await calls.readVersion(BRAND)).body).toMatchObject({ status: 'pending', comments: [] });
    expect((await calls.listVersions(BRAND)).body).toHaveLength(1);
  });

  it('payload inválido continua respondendo 400 antes da identidade', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/campaigns', payload: { name: 'Sem peças' } });

    expect(response.statusCode).toBe(400);
  });
});
