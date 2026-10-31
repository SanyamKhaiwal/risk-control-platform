import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './client';
import { live } from './live';
import type {
  Assessment,
  AssessmentResult,
  ChainVerification,
  Control,
  ControlFrequency,
  ControlType,
  Heatmap,
  HistoryEntry,
  Page,
  Rating,
  Risk,
  RiskCategory,
  RiskLink,
  RiskStatus,
} from './types';

/** Polling interval when the live stream is down (live.ts slows it to 30 s on an idle page). */
export const LIVE_INTERVAL_MS = 2000;

/**
 * A screen showing `path` live: pushed by the Gateway's live stream when it's up, polled when it isn't
 * (docs/performance.md). Returns the refetchInterval for useQuery.
 */
function useLive(path: string, key: QueryKey, enabled = true) {
  const hash = JSON.stringify(key);
  useEffect(() => (enabled ? live.watch(path, key) : undefined), [path, hash, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return () => (live.covers(path) ? false : live.pollInterval());
}

function query(params: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

// ---- Risks ----

export interface RiskFilters {
  status?: RiskStatus;
  rating?: Rating;
  owner?: string;
  controlId?: string;
  page?: number;
  size?: number;
}

export function useRisks(filters: RiskFilters, options: { live?: boolean; enabled?: boolean } = {}) {
  const path = `/api/risks${query({ ...filters })}`;
  const enabled = options.enabled ?? true;
  const interval = useLive(path, ['risks', filters], Boolean(options.live) && enabled);
  return useQuery({
    queryKey: ['risks', filters],
    queryFn: () => api<Page<Risk>>(path),
    enabled,
    refetchInterval: options.live ? interval : false,
    placeholderData: (previous) => previous,
  });
}

export function useRisk(id: string) {
  const interval = useLive(`/api/risks/${id}`, ['risk', id]);
  return useQuery({
    queryKey: ['risk', id],
    queryFn: () => api<Risk>(`/api/risks/${id}`),
    refetchInterval: interval,
  });
}

export function useRiskLinks(id: string) {
  const interval = useLive(`/api/risks/${id}/controls`, ['risk', id, 'links']);
  return useQuery({
    queryKey: ['risk', id, 'links'],
    queryFn: () => api<RiskLink[]>(`/api/risks/${id}/controls`),
    refetchInterval: interval,
  });
}

export function useRiskHistory(id: string) {
  const interval = useLive(`/api/risks/${id}/history`, ['risk', id, 'history']);
  return useQuery({
    queryKey: ['risk', id, 'history'],
    queryFn: () => api<HistoryEntry[]>(`/api/risks/${id}/history`),
    refetchInterval: interval,
  });
}

/** The Overview screen in one request: both heat-maps and the riskiest risks (GET /api/dashboard/overview). */
export function useOverview(limit = 10) {
  const path = `/api/dashboard/overview${query({ limit })}`;
  const interval = useLive(path, ['dashboard', 'overview', limit]);
  return useQuery({
    queryKey: ['dashboard', 'overview', limit],
    queryFn: () => api<{ heatmap: Heatmap; top: { risks: Risk[] } }>(path),
    refetchInterval: interval,
  });
}

export function useHeatmap() {
  const interval = useLive('/api/dashboard/heatmap', ['dashboard', 'heatmap']);
  return useQuery({
    queryKey: ['dashboard', 'heatmap'],
    queryFn: () => api<Heatmap>('/api/dashboard/heatmap'),
    refetchInterval: interval,
  });
}

export function useTopRisks(limit: number) {
  const path = `/api/dashboard/top${query({ limit })}`;
  const interval = useLive(path, ['dashboard', 'top', limit]);
  return useQuery({
    queryKey: ['dashboard', 'top', limit],
    queryFn: () => api<{ risks: Risk[] }>(path),
    refetchInterval: interval,
  });
}

export interface RiskInput {
  title: string;
  description: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
}

function useInvalidateRisks() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ['risks'] });
    client.invalidateQueries({ queryKey: ['risk'] });
    client.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export function useCreateRisk() {
  const invalidate = useInvalidateRisks();
  return useMutation({
    mutationFn: (input: RiskInput) => api<Risk>('/api/risks', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateRisk(id: string) {
  const invalidate = useInvalidateRisks();
  return useMutation({
    mutationFn: (input: RiskInput & { version: number }) => api<Risk>(`/api/risks/${id}`, { method: 'PUT', body: input }),
    onSuccess: invalidate,
  });
}

export function useChangeStatus(id: string) {
  const invalidate = useInvalidateRisks();
  return useMutation({
    mutationFn: (input: { status: RiskStatus; version: number }) =>
      api<Risk>(`/api/risks/${id}/status`, { method: 'PATCH', body: input }),
    onSuccess: invalidate,
  });
}

export function useLinkControl(riskId: string) {
  const invalidate = useInvalidateRisks();
  return useMutation({
    mutationFn: (controlId: string) => api<RiskLink>(`/api/risks/${riskId}/controls/${controlId}`, { method: 'POST' }),
    onSuccess: invalidate,
  });
}

export function useUnlinkControl(riskId: string) {
  const invalidate = useInvalidateRisks();
  return useMutation({
    mutationFn: (controlId: string) => api<void>(`/api/risks/${riskId}/controls/${controlId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

// ---- Controls ----

export interface ControlFilters {
  type?: ControlType;
  owner?: string;
  retestRequired?: boolean;
  page?: number;
  size?: number;
}

export function useControls(filters: ControlFilters, options: { live?: boolean; enabled?: boolean } = {}) {
  const path = `/api/controls${query({ ...filters })}`;
  const enabled = options.enabled ?? true;
  const interval = useLive(path, ['controls', filters], Boolean(options.live) && enabled);
  return useQuery({
    queryKey: ['controls', filters],
    queryFn: () => api<Page<Control>>(path),
    enabled,
    refetchInterval: options.live ? interval : false,
    placeholderData: (previous) => previous,
  });
}

export function useControl(id: string) {
  const interval = useLive(`/api/controls/${id}`, ['control', id]);
  return useQuery({
    queryKey: ['control', id],
    queryFn: () => api<Control>(`/api/controls/${id}`),
    refetchInterval: interval,
  });
}

export function useAssessments(controlId: string) {
  return useQuery({
    queryKey: ['control', controlId, 'assessments'],
    queryFn: () => api<Page<Assessment>>(`/api/controls/${controlId}/assessments?size=50`),
  });
}

export function useVerifyChain(controlId: string) {
  return useMutation({
    mutationFn: () => api<ChainVerification>(`/api/controls/${controlId}/assessments/verify`),
  });
}

function useInvalidateControls() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ['controls'] });
    client.invalidateQueries({ queryKey: ['control'] });
  };
}

export interface ControlInput {
  name: string;
  description: string;
  frequency: ControlFrequency;
}

export function useCreateControl() {
  const invalidate = useInvalidateControls();
  return useMutation({
    mutationFn: (input: ControlInput & { type: ControlType }) => api<Control>('/api/controls', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useUpdateControl(id: string) {
  const invalidate = useInvalidateControls();
  return useMutation({
    mutationFn: (input: ControlInput & { version: number }) => api<Control>(`/api/controls/${id}`, { method: 'PUT', body: input }),
    onSuccess: invalidate,
  });
}

export function useRecordAssessment(controlId: string) {
  const invalidate = useInvalidateControls();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { result: AssessmentResult; evidence: string; comments: string }) =>
      api<Assessment>(`/api/controls/${controlId}/assessments`, { method: 'POST', body: input }),
    onSuccess: () => {
      invalidate();
      client.invalidateQueries({ queryKey: ['dashboard'] });
      client.invalidateQueries({ queryKey: ['risks'] });
    },
  });
}
