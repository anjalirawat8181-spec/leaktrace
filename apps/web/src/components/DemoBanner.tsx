import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function useDemoConfig() {
  return useQuery({
    queryKey: ['demo-config'],
    queryFn: () => api<{ demo: boolean }>('/auth/demo-config').catch(() => ({ demo: false })),
    staleTime: Infinity,
  });
}

export function DemoBanner() {
  const { data } = useDemoConfig();
  if (!data?.demo) return null;
  return (
    <div role="note" className="bg-info-tint px-4 py-1.5 text-center text-xs text-fg-muted">
      Public demo: data resets every night. Please do not upload anything private.
    </div>
  );
}
