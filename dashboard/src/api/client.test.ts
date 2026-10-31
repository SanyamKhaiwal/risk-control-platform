import { afterEach, describe, expect, it, vi } from 'vitest';
import { ratingOf } from '../format';
import { api, ApiError, configureClient } from './client';

function respond(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(body === undefined ? null : JSON.stringify(body), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  configureClient(() => null, () => {});
});

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    configureClient(() => 'tok', () => {});
    respond(200, { ok: true });

    await expect(api('/api/risks')).resolves.toEqual({ ok: true });
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('turns problem+json into an ApiError with field errors', async () => {
    respond(400, { title: 'Bad Request', detail: 'Request validation failed.', errors: { title: 'must not be blank' } });

    const error = await api<never>('/api/risks', { method: 'POST', body: {} }).catch((e: ApiError) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Request validation failed.');
    expect(error.fieldErrors).toEqual({ title: 'must not be blank' });
  });

  it('ends the session when a token is rejected', async () => {
    const unauthorized = vi.fn();
    configureClient(() => 'expired', unauthorized);
    respond(401, { title: 'Unauthorized', detail: 'A valid bearer token is required.' });

    await expect(api('/api/risks')).rejects.toBeInstanceOf(ApiError);
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('reports an unreachable gateway as status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const error = await api<never>('/api/risks').catch((e: ApiError) => e);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/not reachable/);
  });
});

describe('rating bands', () => {
  it.each([
    [5, 'LOW'],
    [6, 'MEDIUM'],
    [11, 'MEDIUM'],
    [12, 'HIGH'],
    [19, 'HIGH'],
    [20, 'CRITICAL'],
  ])('score %i is %s', (score, rating) => {
    expect(ratingOf(score)).toBe(rating);
  });
});
