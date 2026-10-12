export const PIECES = ['script', 'video', 'cover', 'caption'] as const;
export type Piece = (typeof PIECES)[number];

export const VERSION_STATUSES = ['pending', 'approved', 'changes_requested'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export type PendingReason = 'no_version' | 'pending' | 'changes_requested';

export interface PendingPiece {
  piece: Piece;
  reason: PendingReason;
}

export type DeliveryStatus = 'in_production' | 'approved';

export const DELIVERY_EVENT_TYPES = ['approved', 'approval_undone', 'approval_restored'] as const;
export type DeliveryEventType = (typeof DELIVERY_EVENT_TYPES)[number];

export type CurrentStatusByPiece = Partial<Record<Piece, VersionStatus>>;

export function pendingPieces(
  requiredPieces: readonly Piece[],
  currentStatus: CurrentStatusByPiece,
): PendingPiece[] {
  const pending: PendingPiece[] = [];
  for (const piece of requiredPieces) {
    const status = currentStatus[piece];
    if (status === 'approved') {
      continue;
    }
    pending.push({ piece, reason: status ?? 'no_version' });
  }
  return pending;
}

export function deliveryStatus(
  approvalRecorded: boolean,
  pending: readonly PendingPiece[],
): DeliveryStatus {
  return approvalRecorded && pending.length === 0 ? 'approved' : 'in_production';
}
