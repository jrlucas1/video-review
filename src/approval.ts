// Única regra de aprovação do sistema.
//
// Uma entrega está aprovada quando a marca registrou a aprovação e toda peça
// exigida pela campanha tem a versão atual aprovada. A lista de peças exigidas
// chega como argumento: ela é dado da campanha.

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

// Status da versão atual de cada peça. Peça sem versão não aparece.
export type CurrentStatusByPiece = Partial<Record<Piece, VersionStatus>>;

// Peças exigidas cuja versão atual ainda não está aprovada.
// Peça que a campanha não exige nunca entra aqui, em qualquer status.
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

// O status é calculado, não gravado. Por isso uma versão nova derruba a aprovação
// sem tocar no registro, e ela volta quando essa versão é aprovada.
export function deliveryStatus(
  approvalRecorded: boolean,
  pending: readonly PendingPiece[],
): DeliveryStatus {
  return approvalRecorded && pending.length === 0 ? 'approved' : 'in_production';
}
