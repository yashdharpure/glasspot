'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import Button from '@/components/button';
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
    try {
      const result =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });

      if (result.error) {
        setError(result.error.message);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Could not connect to Glasspot. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Glasspot login</h1>

      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
        <Button
          type="button"
          variant={mode === 'signin' ? 'primary' : 'ghost'}
          aria-pressed={mode === 'signin'}
          onClick={() => setMode('signin')}
        >
          Sign in
        </Button>
        <Button
          type="button"
          variant={mode === 'signup' ? 'primary' : 'ghost'}
          aria-pressed={mode === 'signup'}
          onClick={() => setMode('signup')}
        >
          Sign up
        </Button>
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

        <Button
          type="submit"
          disabled={loading}
          loading={loading}
          loadingText={mode === 'signin' ? 'Signing in...' : 'Creating account...'}
        >
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </Button>
      </form>
    </main>
  );
}
