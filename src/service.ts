import { PIECES, deliveryStatus, pendingPieces } from './approval.ts';
import type {
  CurrentStatusByPiece,
  DeliveryStatus,
  PendingPiece,
  PendingReason,
  Piece,
} from './approval.ts';
import type { Db } from './db.ts';
import * as repository from './repository.ts';
import type { Comment, DeliveryRow, Version } from './repository.ts';

export class ReviewError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface Campaign {
  id: number;
  name: string;
  requiredPieces: Piece[];
}

export interface DeliveryView {
  id: number;
  campaignId: number;
  creator: string;
  status: DeliveryStatus;
  approvedAt: string | null;
  pending: PendingPiece[];
  pieces: { piece: Piece; required: boolean; currentVersion: Version | null }[];
}

export interface VersionView extends Version {
  current: boolean;
  comments: Comment[];
}

const REASON_TEXT: Record<PendingReason, string> = {
  no_version: 'sem versão enviada',
  pending: 'versão atual aguardando aprovação',
  changes_requested: 'versão atual com ajustes pedidos',
};

function notFound(what: string): ReviewError {
  return new ReviewError(404, 'not_found', `${what} não existe.`);
}

function requireDelivery(db: Db, deliveryId: number): DeliveryRow {
  const delivery = repository.findDelivery(db, deliveryId);
  if (!delivery) {
    throw notFound('Entrega');
  }
  return delivery;
}

function requireVersion(db: Db, versionId: number): Version {
  const version = repository.findVersion(db, versionId);
  if (!version) {
    throw notFound('Versão');
  }
  return version;
}

function isCurrent(db: Db, version: Version): boolean {
  return repository.currentVersionNumber(db, version.deliveryId, version.piece) === version.number;
}

function assertCurrent(db: Db, version: Version): void {
  if (!isCurrent(db, version)) {
    throw new ReviewError(
      409,
      'version_superseded',
      `A versão ${version.number} de ${version.piece} já foi substituída por uma mais nova.`,
    );
  }
}

function requiredPiecesOf(db: Db, campaignId: number): Piece[] {
  const required = repository.listRequiredPieces(db, campaignId);
  return PIECES.filter((piece) => required.includes(piece));
}

export function getCampaign(db: Db, campaignId: number): Campaign {
  const campaign = repository.findCampaign(db, campaignId);
  if (!campaign) {
    throw notFound('Campanha');
  }
  return { ...campaign, requiredPieces: requiredPiecesOf(db, campaignId) };
}

export function createCampaign(db: Db, input: { name: string; requiredPieces: Piece[] }): Campaign {
  return getCampaign(db, repository.insertCampaign(db, input.name, input.requiredPieces));
}

export function getDelivery(db: Db, deliveryId: number): DeliveryView {
  const delivery = requireDelivery(db, deliveryId);
  const required = requiredPiecesOf(db, delivery.campaignId);
  const currentVersions = repository.listCurrentVersions(db, deliveryId);

  const currentStatus: CurrentStatusByPiece = {};
  for (const version of currentVersions) {
    currentStatus[version.piece] = version.status;
  }
  const pending = pendingPieces(required, currentStatus);

  return {
    id: delivery.id,
    campaignId: delivery.campaignId,
    creator: delivery.creator,
    status: deliveryStatus(delivery.approvedAt !== null, pending),
    approvedAt: delivery.approvedAt,
    pending,
    pieces: PIECES.map((piece) => ({
      piece,
      required: required.includes(piece),
      currentVersion: currentVersions.find((version) => version.piece === piece) ?? null,
    })),
  };
}

export function createDelivery(db: Db, campaignId: number, input: { creator: string }): DeliveryView {
  getCampaign(db, campaignId);
  return getDelivery(db, repository.insertDelivery(db, campaignId, input.creator));
}

export function approveDelivery(db: Db, deliveryId: number, now: Date): DeliveryView {
  const { pending } = getDelivery(db, deliveryId);
  if (pending.length > 0) {
    const missing = pending.map(({ piece, reason }) => `${piece} (${REASON_TEXT[reason]})`).join(', ');
    throw new ReviewError(
      409,
      'pieces_pending',
      `A entrega não pode ser aprovada. Peças exigidas pendentes: ${missing}.`,
      { pending },
    );
  }
  repository.recordFirstDeliveryApproval(db, deliveryId, now.toISOString());
  return getDelivery(db, deliveryId);
}

export function submitVersion(
  db: Db,
  deliveryId: number,
  piece: Piece,
  input: { url: string; durationSeconds?: number },
  now: Date,
): { version: Version; created: boolean } {
  requireDelivery(db, deliveryId);
  if (piece === 'video' && input.durationSeconds === undefined) {
    throw new ReviewError(422, 'duration_required', 'Versão de vídeo exige durationSeconds.');
  }
  if (piece !== 'video' && input.durationSeconds !== undefined) {
    throw new ReviewError(422, 'duration_not_allowed', `durationSeconds não se aplica a ${piece}.`);
  }
  const durationSeconds = input.durationSeconds ?? null;
  const run = db.transaction((): { version: Version; created: boolean } => {
    const current = repository.findCurrentVersion(db, deliveryId, piece);
    if (current && current.url === input.url && current.durationSeconds === durationSeconds) {
      return { version: current, created: false };
    }
    const version = repository.insertVersion(db, {
      deliveryId,
      piece,
      url: input.url,
      durationSeconds,
      createdAt: now.toISOString(),
    });
    return { version, created: true };
  });
  return run.immediate();
}

export function listVersions(db: Db, deliveryId: number, piece: Piece): Version[] {
  requireDelivery(db, deliveryId);
  return repository.listVersions(db, deliveryId, piece);
}

export function getVersion(db: Db, versionId: number): VersionView {
  const version = requireVersion(db, versionId);
  return {
    ...version,
    current: isCurrent(db, version),
    comments: repository.listComments(db, versionId),
  };
}

export function decideVersion(
  db: Db,
  versionId: number,
  decision: 'approved' | 'changes_requested',
): VersionView {
  const version = requireVersion(db, versionId);
  assertCurrent(db, version);
  if (version.status !== 'pending') {
    throw new ReviewError(
      409,
      'version_already_decided',
      `A versão ${version.number} de ${version.piece} já está como ${version.status}.`,
    );
  }
  repository.updateVersionStatus(db, versionId, decision);
  return getVersion(db, versionId);
}

export function addComment(
  db: Db,
  versionId: number,
  input: { author: string; text: string; second?: number },
  now: Date,
): Comment {
  const version = requireVersion(db, versionId);
  assertCurrent(db, version);

  if (version.piece !== 'video') {
    if (input.second !== undefined) {
      throw new ReviewError(422, 'second_not_allowed', `second não se aplica a ${version.piece}.`);
    }
  } else {
    if (input.second === undefined) {
      throw new ReviewError(422, 'second_required', 'Comentário em vídeo exige second.');
    }
    if (version.durationSeconds !== null && input.second > version.durationSeconds) {
      throw new ReviewError(
        422,
        'second_out_of_range',
        `O vídeo tem ${version.durationSeconds}s; não existe o segundo ${input.second}.`,
      );
    }
  }

  return repository.insertComment(db, {
    versionId,
    author: input.author,
    text: input.text,
    second: input.second ?? null,
    createdAt: now.toISOString(),
  });
}
