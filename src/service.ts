import { ownsCampaign, ownsDelivery } from './access.ts';
import type { Actor } from './access.ts';
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
import type {
  CampaignRow,
  Comment,
  DeliveryEvent,
  DeliveryRow,
  EventVersion,
  Version,
} from './repository.ts';

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
  brand: string | null;
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

function forbidden(): ReviewError {
  return new ReviewError(403, 'forbidden', 'Este papel e este usuário não podem fazer isso aqui.');
}

function requireCampaign(db: Db, campaignId: number): CampaignRow {
  const campaign = repository.findCampaign(db, campaignId);
  if (!campaign) {
    throw notFound('Campanha');
  }
  return campaign;
}

function requireDelivery(db: Db, deliveryId: number): DeliveryRow {
  const delivery = repository.findDelivery(db, deliveryId);
  if (!delivery) {
    throw notFound('Entrega');
  }
  return delivery;
}

function assertCampaignOwner(db: Db, actor: Actor, campaignId: number): CampaignRow {
  const campaign = requireCampaign(db, campaignId);
  if (!ownsCampaign(actor, campaign)) {
    throw forbidden();
  }
  return campaign;
}

function assertDeliveryCreator(actor: Actor, delivery: DeliveryRow): void {
  if (!ownsDelivery(actor, delivery)) {
    throw forbidden();
  }
}

function assertParty(db: Db, actor: Actor, delivery: DeliveryRow): void {
  if (ownsDelivery(actor, delivery)) {
    return;
  }
  assertCampaignOwner(db, actor, delivery.campaignId);
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

export function getCampaign(db: Db, actor: Actor, campaignId: number): Campaign {
  const campaign = assertCampaignOwner(db, actor, campaignId);
  return { ...campaign, requiredPieces: requiredPiecesOf(db, campaignId) };
}

export function createCampaign(
  db: Db,
  actor: Actor,
  input: { name: string; requiredPieces: Piece[] },
): Campaign {
  if (actor.role !== 'brand') {
    throw forbidden();
  }
  const campaignId = repository.insertCampaign(db, input.name, actor.user, input.requiredPieces);
  return getCampaign(db, actor, campaignId);
}

export function getDelivery(db: Db, actor: Actor, deliveryId: number): DeliveryView {
  assertParty(db, actor, requireDelivery(db, deliveryId));
  return deliveryView(db, deliveryId);
}

function deliveryView(db: Db, deliveryId: number): DeliveryView {
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

function toEventVersion(version: Version): EventVersion {
  return { piece: version.piece, versionId: version.id, number: version.number };
}

function recordStatusChange(db: Db, before: DeliveryView, now: Date, undoneBy?: Version): DeliveryView {
  const after = deliveryView(db, before.id);
  if (after.status === before.status) {
    return after;
  }
  const event = { deliveryId: after.id, createdAt: now.toISOString() };
  if (after.status === 'in_production') {
    const versions = undoneBy ? [toEventVersion(undoneBy)] : [];
    repository.insertDeliveryEvent(db, { ...event, type: 'approval_undone', versions });
    return after;
  }
  const versions = after.pieces
    .filter((entry) => entry.required && entry.currentVersion !== null)
    .map((entry) => toEventVersion(entry.currentVersion as Version));
  const type = before.approvedAt === null ? 'approved' : 'approval_restored';
  repository.insertDeliveryEvent(db, { ...event, type, versions });
  return after;
}

export function listDeliveryEvents(db: Db, actor: Actor, deliveryId: number): DeliveryEvent[] {
  assertParty(db, actor, requireDelivery(db, deliveryId));
  return repository.listDeliveryEvents(db, deliveryId);
}

export function createDelivery(
  db: Db,
  actor: Actor,
  campaignId: number,
  input: { creator: string },
): DeliveryView {
  assertCampaignOwner(db, actor, campaignId);
  return deliveryView(db, repository.insertDelivery(db, campaignId, input.creator));
}

export function approveDelivery(db: Db, actor: Actor, deliveryId: number, now: Date): DeliveryView {
  assertCampaignOwner(db, actor, requireDelivery(db, deliveryId).campaignId);
  const run = db.transaction((): DeliveryView => {
    const before = deliveryView(db, deliveryId);
    const { pending } = before;
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
    return recordStatusChange(db, before, now);
  });
  return run.immediate();
}

export function submitVersion(
  db: Db,
  actor: Actor,
  deliveryId: number,
  piece: Piece,
  input: { url: string; durationSeconds?: number },
  now: Date,
): { version: Version; created: boolean } {
  assertDeliveryCreator(actor, requireDelivery(db, deliveryId));
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
    const before = deliveryView(db, deliveryId);
    const version = repository.insertVersion(db, {
      deliveryId,
      piece,
      url: input.url,
      durationSeconds,
      createdAt: now.toISOString(),
    });
    recordStatusChange(db, before, now, version);
    return { version, created: true };
  });
  return run.immediate();
}

export function listVersions(db: Db, actor: Actor, deliveryId: number, piece: Piece): Version[] {
  assertParty(db, actor, requireDelivery(db, deliveryId));
  return repository.listVersions(db, deliveryId, piece);
}

export function getVersion(db: Db, actor: Actor, versionId: number): VersionView {
  const version = requireVersion(db, versionId);
  assertParty(db, actor, requireDelivery(db, version.deliveryId));
  return versionView(db, versionId);
}

function versionView(db: Db, versionId: number): VersionView {
  const version = requireVersion(db, versionId);
  return {
    ...version,
    current: isCurrent(db, version),
    comments: repository.listComments(db, versionId),
  };
}

export function decideVersion(
  db: Db,
  actor: Actor,
  versionId: number,
  decision: 'approved' | 'changes_requested',
  now: Date,
): VersionView {
  const run = db.transaction((): VersionView => {
    const version = requireVersion(db, versionId);
    assertCampaignOwner(db, actor, requireDelivery(db, version.deliveryId).campaignId);
    assertCurrent(db, version);
    if (version.status !== 'pending') {
      throw new ReviewError(
        409,
        'version_already_decided',
        `A versão ${version.number} de ${version.piece} já está como ${version.status}.`,
      );
    }
    const before = deliveryView(db, version.deliveryId);
    repository.updateVersionStatus(db, versionId, decision);
    recordStatusChange(db, before, now);
    return versionView(db, versionId);
  });
  return run.immediate();
}

export function addComment(
  db: Db,
  actor: Actor,
  versionId: number,
  input: { author: string; text: string; second?: number },
  now: Date,
): Comment {
  const version = requireVersion(db, versionId);
  assertParty(db, actor, requireDelivery(db, version.deliveryId));
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
