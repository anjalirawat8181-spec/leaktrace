import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { QueryState } from '../components/QueryState';
import { Badge, Card, EmptyState, PageHeader, SkeletonRows, type IconName, type Tone } from '../components/ui';
import { formatDateTime } from '../lib/hooks';

interface Notification { id: string; topic: string; subject: string; body: string; at: string }

const TOPIC: Record<string, { tone: Tone; icon: IconName; card: 'danger' | 'warn' | 'ok' }> = {
  'leak-alerts': { tone: 'danger', icon: 'target', card: 'danger' },
  'ops-alerts': { tone: 'warn', icon: 'alert', card: 'warn' },
  'release-notices': { tone: 'ok', icon: 'unlock', card: 'ok' },
};

export default function OutboxPage() {
  const list = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Notification[]>('/notifications'),
    refetchInterval: 5000,
  });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Outbox" subtitle="Every notification the app has published." />
      <QueryState query={list} skeleton={<SkeletonRows rows={4} />}>
        {(items) => items.length === 0 ? (
          <EmptyState icon="outbox" title="Nothing published yet">Alerts and release notices appear here.</EmptyState>
        ) : (
          <ul className="space-y-4">
            {items.map((n) => {
              const t = TOPIC[n.topic] ?? { tone: 'neutral' as Tone, icon: 'outbox' as IconName, card: undefined };
              return (
                <li key={n.id}>
                  <Card tone={t.card}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={t.tone} icon={t.icon}>{n.topic}</Badge>
                      <time dateTime={n.at} className="data-num text-xs text-fg-muted">{formatDateTime(n.at)}</time>
                    </div>
                    <h2 className="mt-3 text-lg">{n.subject}</h2>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{n.body}</p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
