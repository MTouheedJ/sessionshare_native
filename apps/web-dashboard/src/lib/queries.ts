"use client";

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, request } from "./api";
import type { OwnerSession, OwnerToken, OwnerTokenCreated, Session, TokenStatus, UserToken } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  userTokens: ["tokens", "user"] as const,
  ownerTokens: ["tokens", "owner"] as const,
  sessions: ["sessions"] as const,
};

export function useMe(): UseQueryResult<OwnerSession> {
  return useQuery({ queryKey: queryKeys.me, queryFn: () => request<OwnerSession>("/api/auth/session") });
}

export function useUserTokens(): UseQueryResult<UserToken[]> {
  return useQuery({ queryKey: queryKeys.userTokens, queryFn: () => api<UserToken[]>("tokens") });
}

export function useOwnerTokens(): UseQueryResult<OwnerToken[]> {
  return useQuery({ queryKey: queryKeys.ownerTokens, queryFn: () => api<OwnerToken[]>("owner/tokens") });
}

export function useSessions(): UseQueryResult<Session[]> {
  return useQuery({ queryKey: queryKeys.sessions, queryFn: () => api<Session[]>("sessions") });
}

function useInvalidate(): (...keys: readonly (readonly string[])[]) => Promise<void> {
  const client = useQueryClient();
  return async (...keys) => {
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
  };
}

export function useCreateUserToken() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { maxUses?: number; expiresInHours?: number }) =>
      api<UserToken>("tokens/generate", { method: "POST", body }),
    onSuccess: () => invalidate(queryKeys.userTokens),
  });
}

export function useSetTokenStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Exclude<TokenStatus, "EXPIRED"> }) =>
      api<UserToken>(`tokens/${id}/status`, { method: "PATCH", body: { status } }),
    onSuccess: () => invalidate(queryKeys.userTokens, queryKeys.sessions),
  });
}

export function useDeleteUserToken() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<void>(`tokens/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidate(queryKeys.userTokens, queryKeys.sessions),
  });
}

export function useCreateOwnerToken() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (name: string | undefined) =>
      api<OwnerTokenCreated>("owner/tokens", { method: "POST", body: name ? { name } : {} }),
    onSuccess: () => invalidate(queryKeys.ownerTokens),
  });
}

export function useRevokeOwnerToken() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<OwnerToken>(`owner/tokens/${id}/revoke`, { method: "POST" }),
    onSuccess: () => invalidate(queryKeys.ownerTokens),
  });
}

export function useTerminateSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, block }: { id: string; block: boolean }) =>
      api<Session>(`sessions/${id}/terminate`, { method: "POST", body: { block } }),
    onSuccess: () => invalidate(queryKeys.sessions, queryKeys.userTokens),
  });
}

export function useUnblockSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api<Session>(`sessions/${id}/unblock`, { method: "POST" }),
    onSuccess: () => invalidate(queryKeys.sessions, queryKeys.userTokens),
  });
}
