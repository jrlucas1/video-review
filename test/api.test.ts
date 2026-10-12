import { beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../src/app';
import { abrirBanco } from '../src/banco';
import type { Peca } from '../src/regra';

let app: ReturnType<typeof criarApp>;
let relogio: Date;

beforeEach(() => {
  relogio = new Date('2026-03-01T12:00:00.000Z');
  app = criarApp({ banco: abrirBanco(':memory:'), agora: () => relogio });
});

async function post(url: string, corpo?: unknown) {
  const resposta = await app.inject({ method: 'POST', url, payload: corpo as object });
  return { status: resposta.statusCode, corpo: resposta.json() };
}

async function get(url: string) {
  const resposta = await app.inject({ method: 'GET', url });
  return { status: resposta.statusCode, corpo: resposta.json() };
}

/** Cria campanha e entrega; devolve o id da entrega. */
async function entregaDeCampanha(pecasExigidas: Peca[]): Promise<number> {
  const campanha = await post('/campanhas', { nome: 'Lançamento', pecasExigidas });
  const entrega = await post(`/campanhas/${campanha.corpo.id}/entregas`, { criador: 'ana' });
  return entrega.corpo.id;
}

/** Envia uma versão da peça; devolve o id da versão. */
async function enviar(entregaId: number, peca: Peca): Promise<number> {
  const corpo = peca === 'video' ? { url: 'https://cdn/v.mp4', duracaoSegundos: 30 } : { url: 'https://cdn/x' };
  const versao = await post(`/entregas/${entregaId}/pecas/${peca}/versoes`, corpo);
  expect(versao.status).toBe(201);
  return versao.corpo.id;
}

async function enviarEAprovar(entregaId: number, peca: Peca): Promise<number> {
  const versaoId = await enviar(entregaId, peca);
  expect((await post(`/versoes/${versaoId}/aprovacao`)).status).toBe(200);
  return versaoId;
}

describe('peças exigidas', () => {
  it('aprovar com peça obrigatória pendente falha com erro claro', async () => {
    const entregaId = await entregaDeCampanha(['roteiro', 'video', 'capa']);
    await enviarEAprovar(entregaId, 'roteiro');
    await enviar(entregaId, 'video');

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(409);
    expect(aprovacao.corpo.erro).toBe('PECAS_PENDENTES');
    expect(aprovacao.corpo.mensagem).toBe(
      'A entrega não pode ser aprovada. Peças exigidas pendentes: ' +
        'video (versão atual aguardando aprovação), capa (sem versão enviada).',
    );
    expect(aprovacao.corpo.pendencias).toEqual([
      { peca: 'video', motivo: 'pendente' },
      { peca: 'capa', motivo: 'sem_versao' },
    ]);

    const entrega = await get(`/entregas/${entregaId}`);
    expect(entrega.corpo.status).toBe('em_producao');
    expect(entrega.corpo.aprovacaoRegistradaEm).toBeNull();
  });

  it('aprova quando cada peça exigida tem versão aprovada', async () => {
    const entregaId = await entregaDeCampanha(['roteiro', 'video', 'capa', 'legenda']);
    for (const peca of ['roteiro', 'video', 'capa', 'legenda'] as const) {
      await enviarEAprovar(entregaId, peca);
    }

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(200);
    expect(aprovacao.corpo.status).toBe('aprovada');
    expect(aprovacao.corpo.aprovacaoRegistradaEm).toBe('2026-03-01T12:00:00.000Z');
    expect(aprovacao.corpo.pendencias).toEqual([]);
  });

  it('campanha só de vídeo não exige roteiro', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    await enviarEAprovar(entregaId, 'video');

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(200);
    expect(aprovacao.corpo.status).toBe('aprovada');
  });

  it('peça que a campanha não pediu não bloqueia, mesmo enviada e pendente', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    await enviarEAprovar(entregaId, 'video');
    await enviar(entregaId, 'roteiro');
    const capaId = await enviar(entregaId, 'capa');
    await post(`/versoes/${capaId}/ajustes`);

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(200);
    expect(aprovacao.corpo.status).toBe('aprovada');
  });

  it('versão com ajustes pedidos numa peça exigida bloqueia', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video');
    await post(`/versoes/${videoId}/ajustes`);

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(409);
    expect(aprovacao.corpo.pendencias).toEqual([{ peca: 'video', motivo: 'ajustes_pedidos' }]);
  });

  it('peças todas aprovadas não aprovam a entrega sozinhas', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    await enviarEAprovar(entregaId, 'video');

    const entrega = await get(`/entregas/${entregaId}`);

    expect(entrega.corpo.status).toBe('em_producao');
    expect(entrega.corpo.pendencias).toEqual([]);
  });

  it('a lista de peças exigidas é dado da campanha e aparece na entrega', async () => {
    const campanha = await post('/campanhas', { nome: 'Só capa e vídeo', pecasExigidas: ['capa', 'video'] });
    const entrega = await post(`/campanhas/${campanha.corpo.id}/entregas`, { criador: 'ana' });

    expect((await get(`/campanhas/${campanha.corpo.id}`)).corpo.pecasExigidas).toEqual(['video', 'capa']);
    expect(entrega.corpo.pecas.map((p: { peca: Peca; exigida: boolean }) => [p.peca, p.exigida])).toEqual([
      ['roteiro', false],
      ['video', true],
      ['capa', true],
      ['legenda', false],
    ]);
  });

  it.each([
    ['vazia', []],
    ['com peça repetida', ['video', 'video']],
    ['com peça desconhecida', ['video', 'thumbnail']],
  ])('recusa campanha com lista de peças %s', async (_caso, pecasExigidas) => {
    const campanha = await post('/campanhas', { nome: 'Inválida', pecasExigidas });

    expect(campanha.status).toBe(400);
    expect(campanha.corpo.erro).toBe('ENTRADA_INVALIDA');
  });
});

describe('versão que substitui a anterior', () => {
  it('a versão nova vira a atual, pendente, e a anterior fica no histórico', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const v1 = await enviarEAprovar(entregaId, 'video');
    const v2 = await enviar(entregaId, 'video');

    const entrega = await get(`/entregas/${entregaId}`);
    const video = entrega.corpo.pecas.find((p: { peca: Peca }) => p.peca === 'video');
    expect(video.versaoAtual).toMatchObject({ id: v2, numero: 2, estado: 'pendente' });

    expect((await get(`/versoes/${v1}`)).corpo).toMatchObject({ numero: 1, estado: 'aprovada', atual: false });
    expect((await get(`/versoes/${v2}`)).corpo).toMatchObject({ numero: 2, atual: true });

    const historico = await get(`/entregas/${entregaId}/pecas/video/versoes`);
    expect(historico.corpo.map((v: { id: number }) => v.id)).toEqual([v1, v2]);
  });

  it('aprovação da versão anterior não vale para a entrega', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    await enviarEAprovar(entregaId, 'video');
    await enviar(entregaId, 'video');

    const aprovacao = await post(`/entregas/${entregaId}/aprovacao`);

    expect(aprovacao.status).toBe(409);
    expect(aprovacao.corpo.pendencias).toEqual([{ peca: 'video', motivo: 'pendente' }]);
  });

  it('versão substituída não pode mais ser aprovada nem receber pedido de ajustes', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const v1 = await enviar(entregaId, 'video');
    await enviar(entregaId, 'video');

    const aprovacao = await post(`/versoes/${v1}/aprovacao`);
    const ajustes = await post(`/versoes/${v1}/ajustes`);

    expect(aprovacao.status).toBe(409);
    expect(aprovacao.corpo.erro).toBe('VERSAO_SUBSTITUIDA');
    expect(ajustes.corpo.erro).toBe('VERSAO_SUBSTITUIDA');
    expect((await get(`/versoes/${v1}`)).corpo.estado).toBe('pendente');
  });

  it('a numeração é por peça e por entrega', async () => {
    const entregaA = await entregaDeCampanha(['video', 'capa']);
    const entregaB = await entregaDeCampanha(['video']);
    await enviar(entregaA, 'video');
    await enviar(entregaA, 'video');

    const capaDeA = await enviar(entregaA, 'capa');
    const videoDeB = await enviar(entregaB, 'video');

    expect((await get(`/versoes/${capaDeA}`)).corpo).toMatchObject({ numero: 1, atual: true });
    expect((await get(`/versoes/${videoDeB}`)).corpo).toMatchObject({ numero: 1, atual: true });
  });

  it('cada versão é decidida uma única vez', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const aprovada = await enviarEAprovar(entregaId, 'video');
    const capa = await enviar(entregaId, 'capa');
    await post(`/versoes/${capa}/ajustes`);

    const repetida = await post(`/versoes/${aprovada}/aprovacao`);
    const desfeita = await post(`/versoes/${aprovada}/ajustes`);
    const aprovadaDepoisDeAjustes = await post(`/versoes/${capa}/aprovacao`);

    for (const resposta of [repetida, desfeita, aprovadaDepoisDeAjustes]) {
      expect(resposta.status).toBe(409);
      expect(resposta.corpo.erro).toBe('VERSAO_JA_DECIDIDA');
    }
    expect((await get(`/versoes/${aprovada}`)).corpo.estado).toBe('aprovada');
    expect((await get(`/versoes/${capa}`)).corpo.estado).toBe('ajustes_pedidos');
  });
});

describe('entrega aprovada que recebe versão nova', () => {
  async function entregaAprovada(): Promise<number> {
    const entregaId = await entregaDeCampanha(['video', 'capa']);
    await enviarEAprovar(entregaId, 'video');
    await enviarEAprovar(entregaId, 'capa');
    expect((await post(`/entregas/${entregaId}/aprovacao`)).corpo.status).toBe('aprovada');
    return entregaId;
  }

  it('deixa de estar aprovada até a versão nova ser aprovada', async () => {
    const entregaId = await entregaAprovada();

    relogio = new Date('2026-03-05T09:00:00.000Z');
    const novaCapa = await enviar(entregaId, 'capa');

    const depoisDoEnvio = await get(`/entregas/${entregaId}`);
    expect(depoisDoEnvio.corpo.status).toBe('em_producao');
    expect(depoisDoEnvio.corpo.pendencias).toEqual([{ peca: 'capa', motivo: 'pendente' }]);
    expect((await post(`/entregas/${entregaId}/aprovacao`)).status).toBe(409);

    await post(`/versoes/${novaCapa}/aprovacao`);

    const depoisDaAprovacao = await get(`/entregas/${entregaId}`);
    expect(depoisDaAprovacao.corpo.status).toBe('aprovada');
    expect(depoisDaAprovacao.corpo.aprovacaoRegistradaEm).toBe('2026-03-01T12:00:00.000Z');
  });

  it('continua em produção se a versão nova recebe pedido de ajustes', async () => {
    const entregaId = await entregaAprovada();
    const novoVideo = await enviar(entregaId, 'video');

    await post(`/versoes/${novoVideo}/ajustes`);

    const entrega = await get(`/entregas/${entregaId}`);
    expect(entrega.corpo.status).toBe('em_producao');
    expect(entrega.corpo.pendencias).toEqual([{ peca: 'video', motivo: 'ajustes_pedidos' }]);
  });

  it('versão nova em peça não exigida não desfaz a aprovação', async () => {
    const entregaId = await entregaAprovada();

    await enviar(entregaId, 'roteiro');

    expect((await get(`/entregas/${entregaId}`)).corpo.status).toBe('aprovada');
  });

  it('aprovar de novo é idempotente e mantém a data da primeira aprovação', async () => {
    const entregaId = await entregaAprovada();

    relogio = new Date('2026-03-09T18:30:00.000Z');
    const repetida = await post(`/entregas/${entregaId}/aprovacao`);

    expect(repetida.status).toBe(200);
    expect(repetida.corpo.status).toBe('aprovada');
    expect(repetida.corpo.aprovacaoRegistradaEm).toBe('2026-03-01T12:00:00.000Z');
  });
});

describe('comentários', () => {
  it('fica preso ao segundo e visível na versão em que foi feito', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video');

    const comentario = await post(`/versoes/${videoId}/comentarios`, {
      autor: 'marca',
      texto: 'Logo cortado aqui',
      segundo: 12,
    });

    expect(comentario.status).toBe(201);
    expect(comentario.corpo).toMatchObject({ versaoId: videoId, segundo: 12, texto: 'Logo cortado aqui' });
    expect((await get(`/versoes/${videoId}`)).corpo.comentarios).toEqual([comentario.corpo]);
  });

  it('não migra sozinho para a versão nova', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const v1 = await enviar(entregaId, 'video');
    await post(`/versoes/${v1}/comentarios`, { autor: 'marca', texto: 'Trocar a trilha', segundo: 5 });

    const v2 = await enviar(entregaId, 'video');

    expect((await get(`/versoes/${v2}`)).corpo.comentarios).toEqual([]);
    const comentariosDaV1 = (await get(`/versoes/${v1}`)).corpo.comentarios;
    expect(comentariosDaV1).toHaveLength(1);
    expect(comentariosDaV1[0]).toMatchObject({ versaoId: v1, segundo: 5 });
  });

  it('comentário feito na versão nova não aparece na anterior', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const v1 = await enviar(entregaId, 'video');
    const v2 = await enviar(entregaId, 'video');

    await post(`/versoes/${v2}/comentarios`, { autor: 'marca', texto: 'Agora sim', segundo: 5 });

    expect((await get(`/versoes/${v1}`)).corpo.comentarios).toEqual([]);
    expect((await get(`/versoes/${v2}`)).corpo.comentarios).toHaveLength(1);
  });

  it('versão substituída não aceita comentário novo', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const v1 = await enviar(entregaId, 'video');
    await enviar(entregaId, 'video');

    const comentario = await post(`/versoes/${v1}/comentarios`, { autor: 'marca', texto: 'Atrasado', segundo: 1 });

    expect(comentario.status).toBe(409);
    expect(comentario.corpo.erro).toBe('VERSAO_SUBSTITUIDA');
  });

  it('aceita o segundo 0 e o último segundo do vídeo; recusa o seguinte', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video'); // 30s

    const inicio = await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto: 'Abertura', segundo: 0 });
    const fim = await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto: 'Encerramento', segundo: 30 });
    const alem = await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto: 'Depois do fim', segundo: 31 });

    expect(inicio.status).toBe(201);
    expect(fim.status).toBe(201);
    expect(alem.status).toBe(422);
    expect(alem.corpo.erro).toBe('SEGUNDO_FORA_DO_VIDEO');
  });

  it.each([
    ['negativo', -1],
    ['fracionário', 1.5],
    ['em texto', '12'],
    ['nulo', null],
  ])('recusa segundo %s', async (_caso, segundo) => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video');

    const comentario = await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto: 'x', segundo });

    expect(comentario.status).toBe(400);
    expect((await get(`/versoes/${videoId}`)).corpo.comentarios).toEqual([]);
  });

  it('em vídeo o segundo é obrigatório', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video');

    const comentario = await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto: 'Sem âncora' });

    expect(comentario.status).toBe(422);
    expect(comentario.corpo.erro).toBe('SEGUNDO_OBRIGATORIO');
  });

  it('nas outras peças o comentário não tem segundo', async () => {
    const entregaId = await entregaDeCampanha(['roteiro']);
    const roteiroId = await enviar(entregaId, 'roteiro');

    const semSegundo = await post(`/versoes/${roteiroId}/comentarios`, { autor: 'marca', texto: 'Encurtar' });
    const comSegundo = await post(`/versoes/${roteiroId}/comentarios`, { autor: 'marca', texto: 'x', segundo: 3 });

    expect(semSegundo.status).toBe(201);
    expect(semSegundo.corpo.segundo).toBeNull();
    expect(comSegundo.status).toBe(422);
    expect(comSegundo.corpo.erro).toBe('SEGUNDO_SO_EM_VIDEO');
  });

  it('lista os comentários na ordem do vídeo; empate fica na ordem de criação', async () => {
    const entregaId = await entregaDeCampanha(['video']);
    const videoId = await enviar(entregaId, 'video');
    for (const [texto, segundo] of [['c', 20], ['a', 3], ['b', 3]] as const) {
      await post(`/versoes/${videoId}/comentarios`, { autor: 'marca', texto, segundo });
    }

    const { comentarios } = (await get(`/versoes/${videoId}`)).corpo;

    expect(comentarios.map((c: { texto: string }) => c.texto)).toEqual(['a', 'b', 'c']);
  });
});

describe('entrada inválida', () => {
  it('vídeo exige duração; as outras peças não aceitam', async () => {
    const entregaId = await entregaDeCampanha(['video']);

    const videoSemDuracao = await post(`/entregas/${entregaId}/pecas/video/versoes`, { url: 'https://cdn/v.mp4' });
    const capaComDuracao = await post(`/entregas/${entregaId}/pecas/capa/versoes`, {
      url: 'https://cdn/c.png',
      duracaoSegundos: 10,
    });

    expect(videoSemDuracao.status).toBe(422);
    expect(videoSemDuracao.corpo.erro).toBe('DURACAO_OBRIGATORIA');
    expect(capaComDuracao.status).toBe(422);
    expect(capaComDuracao.corpo.erro).toBe('DURACAO_SO_EM_VIDEO');
  });

  it('recusa peça desconhecida, id malformado e campo desconhecido', async () => {
    const entregaId = await entregaDeCampanha(['video']);

    const pecaDesconhecida = await post(`/entregas/${entregaId}/pecas/thumbnail/versoes`, { url: 'https://cdn/t' });
    const idMalformado = await get('/entregas/abc');
    const campoDesconhecido = await post(`/entregas/${entregaId}/pecas/capa/versoes`, {
      url: 'https://cdn/c.png',
      estado: 'aprovada',
    });

    for (const resposta of [pecaDesconhecida, idMalformado, campoDesconhecido]) {
      expect(resposta.status).toBe(400);
      expect(resposta.corpo.erro).toBe('ENTRADA_INVALIDA');
    }
  });

  it('responde 404 para campanha, entrega e versão que não existem', async () => {
    const respostas = [
      await get('/campanhas/999'),
      await post('/campanhas/999/entregas', { criador: 'ana' }),
      await get('/entregas/999'),
      await post('/entregas/999/aprovacao'),
      await post('/entregas/999/pecas/video/versoes', { url: 'https://cdn/v.mp4', duracaoSegundos: 10 }),
      await get('/versoes/999'),
      await post('/versoes/999/aprovacao'),
      await post('/versoes/999/comentarios', { autor: 'marca', texto: 'x', segundo: 1 }),
    ];

    for (const resposta of respostas) {
      expect(resposta.status).toBe(404);
      expect(resposta.corpo.erro).toBe('NAO_ENCONTRADO');
    }
  });
});
