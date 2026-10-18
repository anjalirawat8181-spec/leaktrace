import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type Centre } from '../api';

interface CentresResponse { maxCopies: number; totalSeats: number; centres: Centre[] }

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['centres'] });
}

function AddRoom({ centreId, error, setError }: { centreId: string; error: string; setError: (s: string) => void }) {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(5);
  const [inv, setInv] = useState('');
  const add = useMutation({
    mutationFn: () => api(`/centres/${centreId}/rooms`, {
      method: 'POST', json: { name, seats, invigilatorName: inv },
    }),
    onSuccess: () => { setName(''); setInv(''); setError(''); invalidate(); },
    onError: (e) => setError((e as Error).message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  return (
    <form onSubmit={submit} className="grid grid-cols-[1fr_5rem_1fr_auto] gap-2 mt-3 items-end">
      <div><label className="label">Room</label><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label className="label">Seats</label><input className="input" type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(Number(e.target.value))} /></div>
      <div><label className="label">Invigilator</label><input className="input" required value={inv} onChange={(e) => setInv(e.target.value)} /></div>
      <button className="btn" disabled={add.isPending}>Add room</button>
      {error && <p className="col-span-4 font-mono text-sm text-amber-400" role="alert">{error}</p>}
    </form>
  );
}

export default function CentresPage() {
  const invalidate = useInvalidate();
  const data = useQuery({ queryKey: ['centres'], queryFn: () => api<CentresResponse>('/centres') });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  const addCentre = useMutation({
    mutationFn: () => api('/centres', { method: 'POST', json: { code, name, city } }),
    onSuccess: () => { setCode(''); setName(''); setCity(''); setError(''); invalidate(); },
    onError: (e) => setError((e as Error).message),
  });
  const removeRoom = useMutation({
    mutationFn: ({ c, r }: { c: string; r: string }) => api(`/centres/${c}/rooms/${r}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const removeCentre = useMutation({
    mutationFn: (id: string) => api(`/centres/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  if (!data.data) return <p className="font-mono text-lab-dim">loading…</p>;
  const { totalSeats, maxCopies, centres } = data.data;
  const over = totalSeats > maxCopies;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <h2 className="font-mono text-lg">Centres &amp; rooms</h2>
        <span className={`ml-auto font-mono text-sm ${totalSeats === maxCopies ? 'text-amber-400' : over ? 'text-red-400' : 'text-emerald-400'}`}>
          {totalSeats} / {maxCopies} copies
        </span>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); addCentre.mutate(); }} className="panel grid sm:grid-cols-4 gap-3 items-end">
        <div><label className="label">Code</label><input className="input" required value={code} onChange={(e) => setCode(e.target.value)} /></div>
        <div><label className="label">Name</label><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">City</label><input className="input" required value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <button className="btn btn-primary">Add centre</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {centres.map((c) => (
          <div key={c.id} className="panel">
            <div className="flex items-center">
              <div>
                <h3 className="font-semibold"><span className="font-mono text-emerald-400">{c.code}</span> {c.name}</h3>
                <p className="font-mono text-xs text-lab-dim">{c.city}</p>
              </div>
              <button className="btn ml-auto" onClick={() => confirm(`Delete centre ${c.code}?`) && removeCentre.mutate(c.id)}>Delete</button>
            </div>
            <table className="w-full mt-3 font-mono text-sm">
              <tbody>
                {c.rooms.map((r) => (
                  <tr key={r.id} className="border-t border-lab-line">
                    <td className="py-1">{r.name}</td>
                    <td>{r.seats} seats</td>
                    <td className="text-lab-dim">{r.invigilatorName}</td>
                    <td className="text-right"><button className="text-red-400 hover:underline" onClick={() => removeRoom.mutate({ c: c.id, r: r.id })}>remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <AddRoom centreId={c.id} error={error} setError={setError} />
          </div>
        ))}
      </div>
    </div>
  );
}
