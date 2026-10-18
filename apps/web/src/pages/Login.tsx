import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';

export default function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const user = await api<User>('/auth/login', { method: 'POST', json: { email, password } });
      qc.setQueryData(['me'], user);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="panel w-full max-w-sm space-y-4">
        <div>
          <h1 className="font-mono text-xl text-emerald-400 tracking-widest">LEAKTRACE</h1>
          <p className="font-mono text-xs text-lab-dim">forensic exam distribution lab</p>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p className="font-mono text-sm text-red-400" role="alert">{error}</p>}
        <button className="btn btn-primary w-full" type="submit">Sign in</button>
      </form>
    </div>
  );
}
