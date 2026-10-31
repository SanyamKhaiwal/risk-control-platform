// k6: how many sign-ins a second the Gateway handles. Each one runs a bcrypt check, which is deliberately slow
// (that's what makes stolen password hashes hard to crack), so this is measured on its own. Usernames are random,
// so the per-user throttle doesn't stop the test; an unknown user costs the same bcrypt check as a real one.
// Run through load-tests/run.mjs. Environment: RATE (sign-ins a second to try), HOLD, GATEWAY.
import http from 'k6/http';
import { check } from 'k6';

const GATEWAY = __ENV.GATEWAY || 'http://gateway:8080';

export const options = {
  scenarios: {
    signins: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 20),
      timeUnit: '1s',
      duration: __ENV.HOLD || '1m',
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: { http_req_duration: ['p(95)<1000'] },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export default function () {
  const r = http.post(`${GATEWAY}/api/auth/login`, JSON.stringify({ username: `load-${Math.random().toString(36).slice(2)}`, password: 'wrong' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  check(r, { 'answered (401 for an unknown user)': (x) => x.status === 401 });
}
