import { NextRequest, NextResponse } from 'next/server';
import { createUser, createToken, setAuthCookie } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password || !fullName) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const user = await createUser(email, password, fullName);

    if (!user) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    }

    const token = await createToken(user);
    await setAuthCookie(token);

    return NextResponse.json({ success: true, role: user.role, fullName: user.fullName });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json({ error: 'An error occurred during signup' }, { status: 500 });
  }
}
