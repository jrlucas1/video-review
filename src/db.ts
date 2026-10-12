import Database from 'better-sqlite3';

export type Db = Database.Database;

// As peças que a campanha exige são linhas de campaign_required_pieces, não colunas nem código.
// deliveries.approved_at registra que a marca aprovou; o status da entrega é calculado (approval.ts).
// A versão atual de uma peça é a de maior number em (delivery_id, piece).
//
// As listas dos CHECK repetem PIECES e VERSION_STATUSES de approval.ts. Elas ficam
// escritas aqui porque o schema de um banco já criado não muda quando a constante muda:
// peça ou status novo pede migration. O test/db.test.ts falha se as duas listas divergirem.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_required_pieces (
  campaign_id INTEGER NOT NULL REFERENCES campaigns (id),
  piece       TEXT NOT NULL CHECK (piece IN ('script', 'video', 'cover', 'caption')),
  PRIMARY KEY (campaign_id, piece)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id          INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns (id),
  creator     TEXT NOT NULL,
  approved_at TEXT
);

-- Só vídeo tem duração.
-- O UNIQUE também é o índice das buscas de versão atual: (delivery_id, piece, number).
CREATE TABLE IF NOT EXISTS versions (
  id               INTEGER PRIMARY KEY,
  delivery_id      INTEGER NOT NULL REFERENCES deliveries (id),
  piece            TEXT NOT NULL CHECK (piece IN ('script', 'video', 'cover', 'caption')),
  number           INTEGER NOT NULL,
  url              TEXT NOT NULL,
  duration_seconds INTEGER,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'changes_requested')),
  created_at       TEXT NOT NULL,
  UNIQUE (delivery_id, piece, number),
  CHECK ((piece = 'video') = (duration_seconds IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  version_id INTEGER NOT NULL REFERENCES versions (id),
  author     TEXT NOT NULL,
  text       TEXT NOT NULL,
  second     INTEGER,
  created_at TEXT NOT NULL
);

-- A leitura é sempre "comentários da versão, na ordem do vídeo". Com second no índice
-- ela sai ordenada, sem sort. O id da linha já é o desempate.
CREATE INDEX IF NOT EXISTS comments_by_version_second ON comments (version_id, second);
`;

export function openDatabase(path = ':memory:'): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
