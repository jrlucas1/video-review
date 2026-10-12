import { beforeEach, describe, expect, it } from 'vitest';
import { PIECES, VERSION_STATUSES } from '../src/approval.ts';
import { openDatabase } from '../src/db.ts';
import type { Db } from '../src/db.ts';

let db: Db;

beforeEach(() => {
  db = openDatabase();
  db.prepare("INSERT INTO campaigns (id, name) VALUES (1, 'Lançamento')").run();
  db.prepare("INSERT INTO deliveries (id, campaign_id, creator) VALUES (1, 1, 'ana')").run();
});

function insertVersion(piece: string, status: string, number = 1): void {
  db.prepare(
    `INSERT INTO versions (delivery_id, piece, number, url, duration_seconds, status, created_at)
     VALUES (1, ?, ?, 'https://cdn.test/x', ?, ?, '2026-03-01T12:00:00.000Z')`,
  ).run(piece, number, piece === 'video' ? 30 : null, status);
}

describe('schema e constantes do domínio', () => {
  it('aceita toda peça de PIECES, como exigida e como versão', () => {
    const requirePiece = db.prepare('INSERT INTO campaign_required_pieces (campaign_id, piece) VALUES (1, ?)');

    for (const piece of PIECES) {
      expect(() => requirePiece.run(piece)).not.toThrow();
      expect(() => insertVersion(piece, 'pending')).not.toThrow();
    }
  });

  it('aceita todo status de VERSION_STATUSES', () => {
    VERSION_STATUSES.forEach((status, index) => {
      expect(() => insertVersion('cover', status, index + 1)).not.toThrow();
    });
  });

  it('recusa peça e status fora das listas', () => {
    const requirePiece = db.prepare('INSERT INTO campaign_required_pieces (campaign_id, piece) VALUES (1, ?)');

    expect(() => requirePiece.run('thumbnail')).toThrow(/CHECK/);
    expect(() => insertVersion('thumbnail', 'pending')).toThrow(/CHECK/);
    expect(() => insertVersion('cover', 'rejected')).toThrow(/CHECK/);
  });
});

describe('integridade das versões', () => {
  it('recusa o mesmo número duas vezes na mesma peça da entrega', () => {
    insertVersion('cover', 'pending', 1);

    expect(() => insertVersion('cover', 'pending', 1)).toThrow(/UNIQUE/);
  });

  it('só vídeo tem duração', () => {
    const insert = db.prepare(
      `INSERT INTO versions (delivery_id, piece, number, url, duration_seconds, status, created_at)
       VALUES (1, ?, 1, 'https://cdn.test/x', ?, 'pending', '2026-03-01T12:00:00.000Z')`,
    );

    expect(() => insert.run('video', null)).toThrow(/CHECK/);
    expect(() => insert.run('cover', 30)).toThrow(/CHECK/);
  });
});
