import { PIECES } from './approval.ts';
import type { Piece } from './approval.ts';

const positiveId = { type: 'string', pattern: '^[1-9][0-9]{0,14}$' };
const nonBlankText = { type: 'string', pattern: '\\S', maxLength: 2000 };
const piece = { enum: PIECES };

export const STRICT_VALIDATION = { coerceTypes: false, removeAdditional: false };

export interface IdParams {
  id: string;
}

export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: positiveId },
};

export interface IdAndPieceParams {
  id: string;
  piece: Piece;
}

export const idAndPieceParams = {
  type: 'object',
  required: ['id', 'piece'],
  properties: { id: positiveId, piece },
};

export interface CampaignBody {
  name: string;
  requiredPieces: Piece[];
}

export const campaignBody = {
  type: 'object',
  required: ['name', 'requiredPieces'],
  additionalProperties: false,
  properties: {
    name: nonBlankText,
    requiredPieces: { type: 'array', minItems: 1, uniqueItems: true, items: piece },
  },
};

export interface DeliveryBody {
  creator: string;
}

export const deliveryBody = {
  type: 'object',
  required: ['creator'],
  additionalProperties: false,
  properties: { creator: nonBlankText },
};

export interface VersionBody {
  url: string;
  durationSeconds?: number;
}

export const versionBody = {
  type: 'object',
  required: ['url'],
  additionalProperties: false,
  properties: { url: nonBlankText, durationSeconds: { type: 'integer', minimum: 1 } },
};

export interface CommentBody {
  author: string;
  text: string;
  second?: number;
}

export const commentBody = {
  type: 'object',
  required: ['author', 'text'],
  additionalProperties: false,
  properties: {
    author: nonBlankText,
    text: nonBlankText,
    second: { type: 'integer', minimum: 0 },
  },
};
