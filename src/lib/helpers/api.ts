import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export type Role = 'ADMIN' | 'STAFF' | 'MEMBER';

/** Standard JSON error response (this codebase uses 401 for all auth/role failures). */
export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 400 response from a failed zod safeParse result.
 * Structurally typed so it works with both zod v3 and v4 error objects.
 */
export function zodFail(result: {
  success: false;
  error: {
    flatten(): {
      formErrors: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
  };
}): NextResponse {
  return NextResponse.json(
    {
      error: 'Validation failed',
      issues: result.error.flatten().fieldErrors ?? {},
    },
    { status: 400 }
  );
}

/** Session guard: returns the session when the role is allowed, else null. */
export async function requireRole(roles: Role[]) {
  const session = await getSession();
  return session && roles.includes(session.role) ? session : null;
}

/** Parse `page` / `pageSize` query params with caps (pageSize ≤ 100). */
export function paginate(url: URL, defaults = { page: 1, pageSize: 20 }) {
  const rawPage = parseInt(url.searchParams.get('page') || String(defaults.page), 10);
  const rawSize = parseInt(
    url.searchParams.get('pageSize') || String(defaults.pageSize),
    10
  );
  const page = Math.max(1, Number.isNaN(rawPage) ? defaults.page : rawPage);
  const pageSize = Math.min(
    100,
    Math.max(1, Number.isNaN(rawSize) ? defaults.pageSize : rawSize)
  );
  return { offset: (page - 1) * pageSize, limit: pageSize, page, pageSize };
}
