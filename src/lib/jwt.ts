import { SignJWT, jwtVerify } from 'jose';

// Role values match the database enum exactly (uppercase).
export interface JWTPayload {
  userId: string;
  email: string;
  role: 'ADMIN' | 'STAFF' | 'MEMBER';
  fullName: string | null;
}

const DEV_FALLBACK_SECRET = 'omix-sacco-dev-secret-do-not-use-in-production';

/**
 * Edge-safe module: contains ONLY jose-based token logic so it can be imported
 * from middleware (Edge runtime) without pulling in `pg` or `next/headers`.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET environment variable must be set in production');
    }
    return new TextEncoder().encode(DEV_FALLBACK_SECRET);
  }
  return new TextEncoder().encode(secret);
}

export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getJwtSecret());
}

const VALID_ROLES = new Set(['ADMIN', 'STAFF', 'MEMBER']);

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    // Validate the minimal shape before trusting the cast.
    if (
      typeof payload.userId !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.role !== 'string' ||
      !VALID_ROLES.has(payload.role)
    ) {
      return null;
    }

    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}
