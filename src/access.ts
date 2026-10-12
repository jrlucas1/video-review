export const ROLES = ['brand', 'creator'] as const;
export type Role = (typeof ROLES)[number];

export interface Actor {
  role: Role;
  user: string;
}

export function readActor(headers: Record<string, string | string[] | undefined>): Actor | null {
  const role = headers['x-role'];
  const user = headers['x-user'];
  if (typeof role !== 'string' || typeof user !== 'string') {
    return null;
  }
  if (!ROLES.includes(role as Role) || user.trim() === '') {
    return null;
  }
  return { role: role as Role, user };
}

export function ownsCampaign(actor: Actor, campaign: { brand: string | null }): boolean {
  return actor.role === 'brand' && campaign.brand === actor.user;
}

export function ownsDelivery(actor: Actor, delivery: { creator: string }): boolean {
  return actor.role === 'creator' && delivery.creator === actor.user;
}
