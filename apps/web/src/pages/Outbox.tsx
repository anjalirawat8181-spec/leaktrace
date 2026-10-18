import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

interface Notification { id: string; topic: string; subject: string; body: string; at: string }

const TOPIC_STYLE: Record<string, string> = {
  'leak-alerts': 'text-red-400 border-red-700',
  'ops-alerts': 'text-amber-400 border-amber-700',
  'release-notices': 'text-emerald-400 border-emerald-700',
};

export default function OutboxPage() {
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
    refetchInterval: 5000,
  });
  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="font-mono text-lg">Outbox</h2>
      {list.data?.length === 0 && <p className="font-mono text-lab-dim">Nothing published yet.</p>}
      {list.data?.map((n) => (
        <div key={n.id} className={`panel border-l-4 ${TOPIC_STYLE[n.topic] ?? ''}`}>
          <div className="flex justify-between font-mono text-xs text-lab-dim">
            <span>{n.topic}</span><span>{new Date(n.at).toLocaleString()}</span>
          </div>
          <p className="font-semibold mt-1">{n.subject}</p>
          <p className="text-sm whitespace-pre-wrap mt-1">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
