import { describe, expect, it } from 'vitest';
import { deliveryStatus, pendingPieces } from '../src/approval.ts';

describe('pendingPieces', () => {
  it('não tem pendência quando toda peça exigida está aprovada', () => {
    const pending = pendingPieces(['script', 'video'], { script: 'approved', video: 'approved' });

    expect(pending).toEqual([]);
  });

  it('aponta cada peça exigida pendente com o motivo', () => {
    const pending = pendingPieces(['script', 'video', 'cover', 'caption'], {
      script: 'approved',
      video: 'pending',
      cover: 'changes_requested',
    });

    expect(pending).toEqual([
      { piece: 'video', reason: 'pending' },
      { piece: 'cover', reason: 'changes_requested' },
      { piece: 'caption', reason: 'no_version' },
    ]);
  });

  it('campanha só de vídeo não exige roteiro', () => {
    expect(pendingPieces(['video'], { video: 'approved' })).toEqual([]);
  });

  it('peça não exigida não bloqueia, mesmo pendente ou com ajustes pedidos', () => {
    const pending = pendingPieces(['video'], {
      video: 'approved',
      script: 'pending',
      cover: 'changes_requested',
    });

    expect(pending).toEqual([]);
  });

  it('sem nenhuma versão, toda peça exigida está pendente', () => {
    expect(pendingPieces(['video', 'cover'], {})).toEqual([
      { piece: 'video', reason: 'no_version' },
      { piece: 'cover', reason: 'no_version' },
    ]);
  });
});

describe('deliveryStatus', () => {
  it('é approved só com aprovação registrada e nenhuma pendência', () => {
    expect(deliveryStatus(true, [])).toBe('approved');
  });

  it('peças aprovadas sem aprovação da entrega ainda é in_production', () => {
    expect(deliveryStatus(false, [])).toBe('in_production');
  });

  it('aprovação registrada com pendência volta a ser in_production', () => {
    expect(deliveryStatus(true, [{ piece: 'video', reason: 'pending' }])).toBe('in_production');
  });
});
