// k6: simulated people using the dashboard, making exactly the requests the React app makes (dashboard/src/api).
// This is the polling fallback (a browser without the live stream); live-load.mjs tests the stream itself.
// Every open screen re-asks for its data every 2 seconds, so a user is a loop: fetch the screen's requests together
// (as the browser does), wait out the 2 seconds, sometimes act.
//
//   80% viewers   Overview (maps and top 10 in one request, re-test count: 2 requests; 5 before the optimisation), or a
//                 risk's page (the risk, its controls, its history, the control list, the re-test count)
//   15% testers   Controls page (2 requests); record a test about once a minute
//    5% owners    Risk register (2 requests); add a risk about every two minutes
//
// Run through load-tests/run.mjs. Environment: USERS (concurrent people), HOLD (how long at that level), GATEWAY.
import http from 'k6/http';
import exec from 'k6/execution';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const GATEWAY = __ENV.GATEWAY || 'http://gateway:8080';
const USERS = Number(__ENV.USERS || 100);
const HOLD = __ENV.HOLD || '2m';
const tokens = JSON.parse(open('/load/out/tokens.json'));
const screenTime = new Trend('screen_refresh', true); // how long one screen takes to refresh, all its requests

export const options = {
  scenarios: {
    people: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '30s', target: USERS }, { duration: HOLD, target: USERS }],
      gracefulRampDown: '5s',
    },
  },
  // The service level this test checks: 95% of requests under half a second, under 1% failing.
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: true,
};

export function setup() {
  const auth = { headers: { Authorization: `Bearer ${tokens.viewers[0]}` } };
  const risks = JSON.parse(http.get(`${GATEWAY}/api/risks?size=100`, { ...auth, responseType: 'text' }).body).content.map((r) => r.id);
  const controls = JSON.parse(http.get(`${GATEWAY}/api/controls?size=100`, { ...auth, responseType: 'text' }).body).content.map((c) => c.id);
  return { risks, controls };
}

const get = (token, url, name) => ['GET', `${GATEWAY}${url}`, null, { headers: { Authorization: `Bearer ${token}` }, tags: { name } }];

function refresh(requests) {
  const started = Date.now();
  const responses = http.batch(requests);
  screenTime.add(Date.now() - started);
  check(responses, { 'every request of the screen succeeded': (rs) => rs.every((r) => r.status >= 200 && r.status < 300) });
  sleep(Math.max(0, 2 - (Date.now() - started) / 1000));
}

export default function (data) {
  const vu = exec.vu.idInTest;
  const slot = vu % 20; // 16 of 20 viewers, 3 testers, 1 owner
  const rand = (list) => list[Math.floor(Math.random() * list.length)];

  if (slot < 16) {
    const token = tokens.viewers[vu % tokens.viewers.length];
    if (vu % 5 === 0) {
      const risk = data.risks[vu % data.risks.length];
      refresh([
        get(token, `/api/risks/${risk}`, 'risk'),
        get(token, `/api/risks/${risk}/controls`, 'risk controls'),
        get(token, `/api/risks/${risk}/history`, 'risk history'),
        get(token, '/api/controls?size=100', 'controls (100)'),
        get(token, '/api/controls?retestRequired=true&size=1', 're-test count'),
      ]);
    } else {
      // The Overview since the optimisation: maps and top 10 in one request; lists only for the roles that use them.
      // PATTERN=before replays the old 5 requests, to compare the two on the same build.
      refresh(__ENV.PATTERN === 'before'
        ? [
          get(token, '/api/dashboard/heatmap', 'heatmap'),
          get(token, '/api/dashboard/top?limit=10', 'top 10'),
          get(token, '/api/risks?size=100', 'risks (100)'),
          get(token, '/api/controls?size=100', 'controls (100)'),
          get(token, '/api/controls?retestRequired=true&size=1', 're-test count'),
        ]
        : [
          get(token, '/api/dashboard/overview?limit=10', 'overview'),
          get(token, '/api/controls?retestRequired=true&size=1', 're-test count'),
        ]);
    }
  } else if (slot < 19) {
    const token = tokens.testers[vu % tokens.testers.length];
    if (Math.random() < 1 / 30) {
      const result = rand(['EFFECTIVE', 'EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'INEFFECTIVE']);
      const r = http.post(`${GATEWAY}/api/controls/${rand(data.controls)}/assessments`, JSON.stringify({ result, evidence: 'load test' }), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, tags: { name: 'record a test' },
      });
      check(r, { 'test recorded': (x) => x.status === 201 });
    }
    refresh([get(token, '/api/controls?page=0&size=20', 'controls page'), get(token, '/api/controls?retestRequired=true&size=1', 're-test count')]);
  } else {
    const token = tokens.owners[vu % tokens.owners.length];
    if (Math.random() < 1 / 60) {
      const r = http.post(`${GATEWAY}/api/risks`, JSON.stringify({ title: `Load risk by VU ${vu}`, category: 'OPERATIONAL', likelihood: 3, impact: 3 }), {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, tags: { name: 'add a risk' },
      });
      check(r, { 'risk added': (x) => x.status === 201 });
    }
    refresh([get(token, '/api/risks?page=0&size=20', 'register page'), get(token, '/api/controls?retestRequired=true&size=1', 're-test count')]);
  }
}
