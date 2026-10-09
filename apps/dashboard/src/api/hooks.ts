import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/api';
import type { HealthResponse, Site, User, Workspace } from './types';

/**
 * Typed API hooks (TanStack Query).
 * Health, me, workspaces, and sites are wired for this skeleton phase; more
 * hooks arrive with their feature phases.
 */

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiFetch<{ user: User }>('/api/me'),
    retry: false,
  });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () =>
      apiFetch<{ workspaces: Array<Workspace & { role?: string }> }>('/api/workspaces'),
    retry: false,
  });
}

export function useSites(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ['sites', workspaceId],
    queryFn: () => apiFetch<{ sites: Site[] }>(`/api/workspaces/${workspaceId}/sites`),
    enabled: workspaceId !== undefined,
  });
}

export function useSite(siteId: string | undefined) {
  return useQuery({
    queryKey: ['site', siteId],
    queryFn: () => apiFetch<{ site: Site }>(`/api/sites/${siteId}`),
    enabled: siteId !== undefined,
  });
}
