import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
// Import from './lib/jwt' — NOT './lib/auth'. Middleware runs on the Edge
// runtime, where `pg` (imported transitively by auth.ts) cannot be bundled.
import { verifyToken } from './lib/jwt';

const authPaths = ['/login', '/signup'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get('auth_token')?.value;
  const session = token ? await verifyToken(token) : null;

  if (session && authPaths.includes(pathname)) {
    return NextResponse.redirect(new URL(`/dashboard/${session.role.toLowerCase()}`, request.url));
  }

  if (pathname.startsWith('/dashboard')) {
    if (!session) return NextResponse.redirect(new URL('/login', request.url));
    const role = session.role.toLowerCase();
    if (pathname.startsWith('/dashboard/admin') && session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL(`/dashboard/${role}`, request.url));
    }
    if (pathname.startsWith('/dashboard/staff') && session.role !== 'STAFF' && session.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard/member', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
