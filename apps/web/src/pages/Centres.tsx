import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, type Centre } from '../api';
import { QueryState } from '../components/QueryState';
import {
  Badge, Button, Card, EmptyState, Field, Icon, Input, Notice, PageHeader, ProgressBar, Skeleton, Table, Td, Th, Tr, useToast,
} from '../components/ui';

interface CentresResponse { maxCopies: number; totalSeats: number; centres: Centre[] }

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['centres'] });
}

function AddRoom({ centreId, error, setError }: { centreId: string; error: string; setError: (s: string) => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(5);
  const [inv, setInv] = useState('');
  const add = useMutation({
    mutationFn: () => api(`/centres/${centreId}/rooms`, {
      method: 'POST', json: { name, seats, invigilatorName: inv },
    }),
    onSuccess: () => { setName(''); setInv(''); setError(''); invalidate(); toast.push('Room added'); },
    onError: (e) => setError((e as Error).message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); add.mutate(); };
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_6rem_1fr_auto] sm:items-end">
      <Field label="Room">{(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Seats">{(p) => <Input {...p} type="number" min={1} max={20} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />}</Field>
      <Field label="Invigilator">{(p) => <Input {...p} required value={inv} onChange={(e) => setInv(e.target.value)} />}</Field>
      <Button type="submit" icon="plus" loading={add.isPending}>Add room</Button>
      {error && <Notice className="sm:col-span-4">{error}</Notice>}
    </form>
  );
}

export default function CentresPage() {
  const invalidate = useInvalidate();
  const toast = useToast();
  const data = useQuery({ queryKey: ['centres'], queryFn: () => api<CentresResponse>('/centres') });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [error, setError] = useState('');

  const addCentre = useMutation({
    mutationFn: () => api('/centres', { method: 'POST', json: { code, name, city } }),
    onSuccess: () => { setCode(''); setName(''); setCity(''); setError(''); invalidate(); toast.push('Centre added'); },
    onError: (e) => setError((e as Error).message),
  });
  const removeRoom = useMutation({
    mutationFn: ({ c, r }: { c: string; r: string }) => api(`/centres/${c}/rooms/${r}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => toast.push((e as Error).message, 'danger'),
  });
  const removeCentre = useMutation({
    mutationFn: (id: string) => api(`/centres/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (e) => toast.push((e as Error).message, 'danger'),
  });

  return (
    <div>
      <PageHeader
        title="Centres & rooms"
        subtitle="Each seat becomes one uniquely fingerprinted copy."
        actions={data.data && (() => {
          const { totalSeats, maxCopies } = data.data;
          const over = totalSeats > maxCopies;
          return <Badge tone={over ? 'danger' : totalSeats === maxCopies ? 'warn' : 'ok'} icon={over ? 'alert' : 'check'}>{totalSeats} / {maxCopies} copies</Badge>;
        })()}
      />
      <QueryState query={data} skeleton={<div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>}>
        {({ totalSeats, maxCopies, centres }) => (
          <div className="space-y-6">
            <Card>
              <div className="mb-2 flex justify-between text-sm"><span className="text-fg-muted">Seats allocated</span><span className="data-num">{totalSeats} / {maxCopies} copies</span></div>
              <ProgressBar label="Seats allocated" value={(totalSeats / maxCopies) * 100} tone={totalSeats > maxCopies ? 'danger' : totalSeats === maxCopies ? 'warn' : 'ok'} />
            </Card>

            <Card>
              <form onSubmit={(e) => { e.preventDefault(); addCentre.mutate(); }} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_1fr_auto] lg:items-end">
                <Field label="Code">{(p) => <Input {...p} required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
                <Field label="Name">{(p) => <Input {...p} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                <Field label="City">{(p) => <Input {...p} required value={city} onChange={(e) => setCity(e.target.value)} />}</Field>
                <Button type="submit" variant="primary" icon="plus" loading={addCentre.isPending}>Add centre</Button>
              </form>
            </Card>

            {centres.length === 0 ? (
              <EmptyState icon="centres" title="No centres yet">Add a centre, then give it rooms and seats.</EmptyState>
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {centres.map((c) => (
                  <Card key={c.id}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <h2 className="text-lg"><span className="data-num text-ok">{c.code}</span> {c.name}</h2>
                        <p className="text-sm text-fg-muted">{c.city}</p>
                      </div>
                      <Button variant="danger" icon="trash" aria-label={`Delete centre ${c.code}`}
                        onClick={() => confirm(`Delete centre ${c.code}?`) && removeCentre.mutate(c.id)}>Delete</Button>
                    </div>
                    <div className="mt-4">
                      {c.rooms.length === 0 ? <p className="text-sm text-fg-muted">No rooms yet.</p> : (
                        <Table caption={`Rooms in centre ${c.code}`}>
                          <thead><tr><Th>Room</Th><Th>Seats</Th><Th className="hidden sm:table-cell">Invigilator</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                          <tbody>
                            {c.rooms.map((r) => (
                              <Tr key={r.id}>
                                <Td>{r.name}<span className="block text-xs text-fg-muted sm:hidden">{r.invigilatorName}</span></Td>
                                <Td className="data-num">{r.seats} seats</Td>
                                <Td className="hidden text-fg-muted sm:table-cell">{r.invigilatorName}</Td>
                                <Td className="text-right">
                                  <button type="button" onClick={() => removeRoom.mutate({ c: c.id, r: r.id })}
                                    aria-label={`Remove room ${r.name}`}
                                    className="-my-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-danger hover:bg-danger-tint">
                                    <Icon name="trash" size={16} /><span className="hidden sm:inline">remove</span>
                                  </button>
                                </Td>
                              </Tr>
                            ))}
                          </tbody>
                        </Table>
                      )}
                    </div>
                    <AddRoom centreId={c.id} error={error} setError={setError} />
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
