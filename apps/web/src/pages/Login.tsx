import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { Button, Card, Field, Icon, Input, Notice } from '../components/ui';

export default function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = await api<User>('/auth/login', { method: 'POST', json: { email, password } });
      qc.setQueryData(['me'], user);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_top,rgb(var(--c-info-tint))_0%,transparent_60%)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-4 grid size-14 place-items-center rounded-lg border border-ok/50 bg-ok-tint text-ok shadow-glow-ok"><Icon name="shield" size={30} /></span>
          <h1 className="font-mono text-3xl tracking-widest">LEAKTRACE</h1>
          <p className="mt-1 text-sm text-fg-muted">Exam integrity and leak tracing</p>
        </div>
        <Card>
          <form onSubmit={submit} className="space-y-4">
            <h2 className="text-lg">Sign in</h2>
            <Field label="Email" id="email">
              {(p) => <Input {...p} type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
            </Field>
            <Field label="Password" id="password">
              {(p) => <Input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            </Field>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-fg-muted">Every sign-in and download is recorded.</p>
      </div>
    </main>
  );
}
