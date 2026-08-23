'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Landmark, Loader2 } from 'lucide-react';

export default function SignUpPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: formData.get('email'),
        password: formData.get('password'),
        fullName: formData.get('full_name'),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || 'Sign up failed');
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  };

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0f1a] px-4">
        <div className="w-full max-w-md text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">Account Created!</h2>
          <p className="text-slate-400">Your account has been created successfully. You can now sign in.</p>
          <Link href="/login" className="inline-block bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-lg font-medium transition-colors">
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0f1a] px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <Landmark className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-white text-xl">Omix SACCO</span>
          </Link>
          <h2 className="text-2xl font-bold text-white">Create your account</h2>
          <p className="mt-2 text-sm text-slate-400">Join Omix SACCO and start managing your cooperative.</p>
        </div>

        <div className="rounded-2xl bg-white/5 p-8 border border-white/10">
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 border border-red-500/20">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-slate-300 mb-1">Full Name</label>
              <input id="full_name" name="full_name" type="text" required
                className="block w-full rounded-lg bg-slate-800/50 border border-slate-700 py-2.5 px-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                placeholder="John Doe" />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email"
                className="block w-full rounded-lg bg-slate-800/50 border border-slate-700 py-2.5 px-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                placeholder="name@example.com" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">Password</label>
              <input id="password" name="password" type="password" required minLength={6}
                className="block w-full rounded-lg bg-slate-800/50 border border-slate-700 py-2.5 px-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-500 text-sm"
                placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full flex justify-center rounded-lg bg-orange-500 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Create Account'}
            </button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <Link href="/login" className="text-orange-400 hover:text-orange-300 font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
