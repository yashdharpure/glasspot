'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();
    const result =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setError(result.error.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
    setLoading(false);
  }

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Glasspot login</h1>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setMode('signin')}
          style={{
            padding: '0.6rem 1rem',
            border: '1px solid #d5dfdd',
            background: mode === 'signin' ? '#1f6f8b' : '#fff',
            color: mode === 'signin' ? '#fff' : '#14272e',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setMode('signup')}
          style={{
            padding: '0.6rem 1rem',
            border: '1px solid #d5dfdd',
            background: mode === 'signup' ? '#1f6f8b' : '#fff',
            color: mode === 'signup' ? '#fff' : '#14272e',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Sign up
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <label style={{ display: 'grid', gap: '0.4rem' }}>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #d5dfdd' }}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.4rem' }}>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            style={{ padding: '0.75rem', borderRadius: 8, border: '1px solid #d5dfdd' }}
          />
        </label>

        {error ? (
          <p role="alert" style={{ color: '#c4432f' }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.8rem 1rem',
            borderRadius: 8,
            border: 'none',
            background: '#1f6f8b',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          {loading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </main>
  );
}
