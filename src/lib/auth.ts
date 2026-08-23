import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { query } from './db';
import { createToken, verifyToken, type JWTPayload } from './jwt';

// Re-export so existing imports from '@/lib/auth' keep working.
// NOTE: verifyToken lives in './jwt' (edge-safe) — middleware must import it
// from there, NOT from this file, which pulls in `pg` and `next/headers`.
export { createToken, verifyToken } from './jwt';
export type { JWTPayload } from './jwt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getSession(): Promise<JWTPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setAuthCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });
}

export async function clearAuthCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete('auth_token');
}

export async function authenticateUser(email: string, password: string): Promise<JWTPayload | null> {
  const result = await query(
    'SELECT id, email, password_hash, role, full_name FROM users WHERE email = $1',
    [email]
  );
  
  if (result.rows.length === 0) return null;
  
  const user = result.rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    fullName: user.full_name,
  };
}

export async function createUser(
  email: string,
  password: string,
  fullName: string,
  role: 'MEMBER' = 'MEMBER'
): Promise<JWTPayload | null> {
  const passwordHash = await hashPassword(password);
  
  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4) RETURNING id, email, role, full_name',
      [email, passwordHash, fullName, role]
    );
    
    const user = result.rows[0];
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return null; // Duplicate email
    }
    throw error;
  }
}
