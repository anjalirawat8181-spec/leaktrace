import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, SkeletonRows } from './ui';

export function QueryState<T>({ query, skeleton, children }: {
  query: UseQueryResult<T>; skeleton?: ReactNode; children: (data: T) => ReactNode;
}) {
  if (query.isError) return <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return <>{skeleton ?? <SkeletonRows />}</>;
  return <>{children(query.data)}</>;
}
