import { createHash, randomBytes, randomInt } from 'node:crypto';

export const OWNER_TOKEN_PREFIX = 'sso_';
const USER_TOKEN_PREFIX = 'SS';
// Alphabet without ambiguous characters (0/O, 1/I/L): 31 symbols, ~4.95 bits each.
const USER_TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const USER_TOKEN_GROUPS = 4;
const USER_TOKEN_GROUP_LENGTH = 5;

/** 256-bit random owner master token. Shown once; only its hash is stored. */
export function generateOwnerToken(): string {
  return OWNER_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** Human-readable user token, e.g. `SS-7KQ2M-XH9PA-R4TZC-N8WEB` (~99 bits of entropy). */
export function generateUserToken(): string {
  const groups: string[] = [];
  for (let g = 0; g < USER_TOKEN_GROUPS; g++) {
    let group = '';
    for (let i = 0; i < USER_TOKEN_GROUP_LENGTH; i++) {
      group += USER_TOKEN_ALPHABET[randomInt(USER_TOKEN_ALPHABET.length)];
    }
    groups.push(group);
  }
  return [USER_TOKEN_PREFIX, ...groups].join('-');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
