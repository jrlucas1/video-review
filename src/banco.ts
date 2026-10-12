import Database from 'better-sqlite3';
import { ESTADOS_DA_VERSAO, PECAS } from './regra';

export type Banco = Database.Database;

const lista = (valores: readonly string[]) => valores.map((valor) => `'${valor}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campanha (
  id   INTEGER PRIMARY KEY,
  nome TEXT NOT NULL
);

-- As peças que a campanha exige são linhas, não colunas nem código.
CREATE TABLE IF NOT EXISTS campanha_peca_exigida (
  campanha_id INTEGER NOT NULL REFERENCES campanha (id),
  peca        TEXT    NOT NULL CHECK (peca IN (${lista(PECAS)})),
  PRIMARY KEY (campanha_id, peca)
);

-- aprovada_em registra que a marca aprovou. O status da entrega é calculado (ver regra.ts).
CREATE TABLE IF NOT EXISTS entrega (
  id          INTEGER PRIMARY KEY,
  campanha_id INTEGER NOT NULL REFERENCES campanha (id),
  criador     TEXT    NOT NULL,
  aprovada_em TEXT
);

-- A versão atual de uma peça é a de maior numero em (entrega_id, peca).
CREATE TABLE IF NOT EXISTS versao (
  id               INTEGER PRIMARY KEY,
  entrega_id       INTEGER NOT NULL REFERENCES entrega (id),
  peca             TEXT    NOT NULL CHECK (peca IN (${lista(PECAS)})),
  numero           INTEGER NOT NULL,
  url              TEXT    NOT NULL,
  duracao_segundos INTEGER,
  estado           TEXT    NOT NULL DEFAULT 'pendente' CHECK (estado IN (${lista(ESTADOS_DA_VERSAO)})),
  criada_em        TEXT    NOT NULL,
  UNIQUE (entrega_id, peca, numero),
  CHECK ((peca = 'video') = (duracao_segundos IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS comentario (
  id        INTEGER PRIMARY KEY,
  versao_id INTEGER NOT NULL REFERENCES versao (id),
  autor     TEXT    NOT NULL,
  texto     TEXT    NOT NULL,
  segundo   INTEGER,
  criado_em TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS comentario_por_versao ON comentario (versao_id);
`;

/** Abre o banco e cria as tabelas. Use ':memory:' nos testes. */
export function abrirBanco(arquivo: string): Banco {
  const banco = new Database(arquivo);
  banco.pragma('foreign_keys = ON');
  banco.exec(SCHEMA);
  return banco;
}
