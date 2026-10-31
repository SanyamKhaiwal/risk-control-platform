import { describe, expect, it } from 'vitest';
import { live, parseUpdate } from './live';

describe('live updates', () => {
  it('reads an update pushed by the Gateway', () => {
    expect(parseUpdate('{"path":"/api/dashboard/overview?limit=10","body":{"heatmap":{"totalRisks":3}}}')).toEqual({
      path: '/api/dashboard/overview?limit=10',
      body: { heatmap: { totalRisks: 3 } },
    });
  });

  it('ignores anything that is not an update', () => {
    expect(parseUpdate('not json')).toBeNull();
    expect(parseUpdate('{"body":{}}')).toBeNull();
  });

  it('polls every 2 seconds until the stream covers an address', () => {
    // Not attached to a query client (as in these tests): nothing is pushed, so every query keeps polling.
    expect(live.covers('/api/dashboard/overview?limit=10')).toBe(false);
    expect(live.pollInterval()).toBe(2000);
  });
});
