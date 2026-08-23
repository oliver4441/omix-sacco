import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser, createToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    const user = await authenticateUser(email, password);

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const token = await createToken(user);
    await setAuthCookie(token);

    return NextResponse.json({ success: true, role: user.role, fullName: user.fullName });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'An error occurred during login' }, { status: 500 });
  }
}
