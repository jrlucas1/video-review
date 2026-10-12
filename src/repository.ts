import type { Piece, VersionStatus } from './approval.ts';
import type { Db } from './db.ts';

export interface CampaignRow {
  id: number;
  name: string;
}

export interface DeliveryRow {
  id: number;
  campaignId: number;
  creator: string;
  approvedAt: string | null;
}

export interface Version {
  id: number;
  deliveryId: number;
  piece: Piece;
  number: number;
  url: string;
  durationSeconds: number | null;
  status: VersionStatus;
  createdAt: string;
}

export interface Comment {
  id: number;
  versionId: number;
  author: string;
  text: string;
  second: number | null;
  createdAt: string;
}

const VERSION_COLUMNS =
  'id, delivery_id AS deliveryId, piece, number, url, duration_seconds AS durationSeconds, status, created_at AS createdAt';

const COMMENT_COLUMNS = 'id, version_id AS versionId, author, text, second, created_at AS createdAt';

export function insertCampaign(db: Db, name: string, requiredPieces: readonly Piece[]): number {
  const run = db.transaction((): number => {
    const campaignId = Number(
      db.prepare('INSERT INTO campaigns (name) VALUES (?)').run(name).lastInsertRowid,
    );
    const insertPiece = db.prepare(
      'INSERT INTO campaign_required_pieces (campaign_id, piece) VALUES (?, ?)',
    );
    for (const piece of requiredPieces) {
      insertPiece.run(campaignId, piece);
    }
    return campaignId;
  });
  return run.immediate();
}

export function findCampaign(db: Db, campaignId: number): CampaignRow | null {
  const row = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(campaignId);
  return (row as CampaignRow | undefined) ?? null;
}

export function listRequiredPieces(db: Db, campaignId: number): Piece[] {
  return db
    .prepare('SELECT piece FROM campaign_required_pieces WHERE campaign_id = ?')
    .pluck()
    .all(campaignId) as Piece[];
}

export function insertDelivery(db: Db, campaignId: number, creator: string): number {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO deliveries (campaign_id, creator) VALUES (?, ?)')
    .run(campaignId, creator);
  return Number(lastInsertRowid);
}

export function findDelivery(db: Db, deliveryId: number): DeliveryRow | null {
  const row = db
    .prepare(
      'SELECT id, campaign_id AS campaignId, creator, approved_at AS approvedAt FROM deliveries WHERE id = ?',
    )
    .get(deliveryId);
  return (row as DeliveryRow | undefined) ?? null;
}

export function recordFirstDeliveryApproval(db: Db, deliveryId: number, approvedAt: string): void {
  db.prepare('UPDATE deliveries SET approved_at = ? WHERE id = ? AND approved_at IS NULL').run(
    approvedAt,
    deliveryId,
  );
}

export function insertVersion(
  db: Db,
  version: {
    deliveryId: number;
    piece: Piece;
    url: string;
    durationSeconds: number | null;
    createdAt: string;
  },
): Version {
  const run = db.transaction((): Version => {
    const number = currentVersionNumber(db, version.deliveryId, version.piece) + 1;
    return db
      .prepare(
        `INSERT INTO versions (delivery_id, piece, number, url, duration_seconds, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         RETURNING ${VERSION_COLUMNS}`,
      )
      .get(
        version.deliveryId,
        version.piece,
        number,
        version.url,
        version.durationSeconds,
        version.createdAt,
      ) as Version;
  });
  return run.immediate();
}

export function findVersion(db: Db, versionId: number): Version | null {
  const row = db.prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE id = ?`).get(versionId);
  return (row as Version | undefined) ?? null;
}

export function listVersions(db: Db, deliveryId: number, piece: Piece): Version[] {
  return db
    .prepare(`SELECT ${VERSION_COLUMNS} FROM versions WHERE delivery_id = ? AND piece = ? ORDER BY number`)
    .all(deliveryId, piece) as Version[];
}

export function findCurrentVersion(db: Db, deliveryId: number, piece: Piece): Version | null {
  const row = db
    .prepare(
      `SELECT ${VERSION_COLUMNS} FROM versions WHERE delivery_id = ? AND piece = ? ORDER BY number DESC LIMIT 1`,
    )
    .get(deliveryId, piece);
  return (row as Version | undefined) ?? null;
}

export function currentVersionNumber(db: Db, deliveryId: number, piece: Piece): number {
  return db
    .prepare('SELECT COALESCE(MAX(number), 0) FROM versions WHERE delivery_id = ? AND piece = ?')
    .pluck()
    .get(deliveryId, piece) as number;
}

export function listCurrentVersions(db: Db, deliveryId: number): Version[] {
  return db
    .prepare(
      `WITH latest AS (
         SELECT piece, MAX(number) AS number
         FROM versions
         WHERE delivery_id = @deliveryId
         GROUP BY piece
       )
       SELECT ${VERSION_COLUMNS}
       FROM versions
       JOIN latest USING (piece, number)
       WHERE delivery_id = @deliveryId`,
    )
    .all({ deliveryId }) as Version[];
}

export function updateVersionStatus(db: Db, versionId: number, status: VersionStatus): void {
  db.prepare('UPDATE versions SET status = ? WHERE id = ?').run(status, versionId);
}

export function insertComment(
  db: Db,
  comment: {
    versionId: number;
    author: string;
    text: string;
    second: number | null;
    createdAt: string;
  },
): Comment {
  return db
    .prepare(
      `INSERT INTO comments (version_id, author, text, second, created_at)
       VALUES (?, ?, ?, ?, ?)
       RETURNING ${COMMENT_COLUMNS}`,
    )
    .get(comment.versionId, comment.author, comment.text, comment.second, comment.createdAt) as Comment;
}

export function listComments(db: Db, versionId: number): Comment[] {
  return db
    .prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE version_id = ? ORDER BY second, id`)
    .all(versionId) as Comment[];
}
