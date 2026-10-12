import { describe, expect, it } from 'vitest';
import { pendenciasDaEntrega, statusDaEntrega } from '../src/regra';

describe('pendenciasDaEntrega', () => {
  it('não tem pendência quando toda peça exigida está aprovada', () => {
    const pendencias = pendenciasDaEntrega(['roteiro', 'video'], {
      roteiro: 'aprovada',
      video: 'aprovada',
    });

    expect(pendencias).toEqual([]);
  });

  it('aponta cada peça exigida pendente com o motivo', () => {
    const pendencias = pendenciasDaEntrega(['roteiro', 'video', 'capa', 'legenda'], {
      roteiro: 'aprovada',
      video: 'pendente',
      capa: 'ajustes_pedidos',
    });

    expect(pendencias).toEqual([
      { peca: 'video', motivo: 'pendente' },
      { peca: 'capa', motivo: 'ajustes_pedidos' },
      { peca: 'legenda', motivo: 'sem_versao' },
    ]);
  });

  it('campanha só de vídeo não exige roteiro', () => {
    expect(pendenciasDaEntrega(['video'], { video: 'aprovada' })).toEqual([]);
  });

  it('peça não exigida não bloqueia, mesmo pendente ou com ajustes pedidos', () => {
    const pendencias = pendenciasDaEntrega(['video'], {
      video: 'aprovada',
      roteiro: 'pendente',
      capa: 'ajustes_pedidos',
    });

    expect(pendencias).toEqual([]);
  });

  it('sem nenhuma versão, toda peça exigida está pendente', () => {
    expect(pendenciasDaEntrega(['video', 'capa'], {})).toEqual([
      { peca: 'video', motivo: 'sem_versao' },
      { peca: 'capa', motivo: 'sem_versao' },
    ]);
  });
});

describe('statusDaEntrega', () => {
  it('é aprovada só com aprovação registrada e nenhuma pendência', () => {
    expect(statusDaEntrega(true, [])).toBe('aprovada');
  });

  it('peças aprovadas sem aprovação da entrega ainda é em produção', () => {
    expect(statusDaEntrega(false, [])).toBe('em_producao');
  });

  it('aprovação registrada com pendência volta a ser em produção', () => {
    expect(statusDaEntrega(true, [{ peca: 'video', motivo: 'pendente' }])).toBe('em_producao');
  });
});
