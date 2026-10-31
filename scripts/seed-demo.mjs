#!/usr/bin/env node
// Seeds a synthetic bank risk register through the gateway, as the demo users, so every record goes
// through the real rules (roles, ownership, segregation of duties) and events.
// Usage: node scripts/seed-demo.mjs [--force]      Gateway: GATEWAY_URL (default http://localhost:8080)
//
// All names and figures are invented demo data.

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const PASSWORD = 'demo123';
const force = process.argv.includes('--force');

// key, owner, name, type, frequency, first assessment (tester, result) or null for untested
const CONTROLS = [
  ['mfa', 'bob', 'MFA on admin accounts', 'PREVENTIVE', 'QUARTERLY', ['carol', 'PARTIALLY_EFFECTIVE', '2 of 14 admin accounts still accept password-only login.']],
  ['siem', 'bob', 'SIEM alerting on privileged access', 'DETECTIVE', 'MONTHLY', null],
  ['uar', 'bob', 'Quarterly user access review', 'PREVENTIVE', 'QUARTERLY', ['carol', 'EFFECTIVE', 'Sampled 40 leavers; all access removed within 24 h.']],
  ['dual', 'bob', 'Dual authorisation of payments', 'PREVENTIVE', 'MONTHLY', ['erin', 'EFFECTIVE', 'Re-performed 25 payments over EUR 50k; all had a second approver.']],
  ['txmon', 'bob', 'Transaction monitoring rules', 'DETECTIVE', 'MONTHLY', ['carol', 'PARTIALLY_EFFECTIVE', 'Two scenarios disabled since the March rule refresh.']],
  ['backup', 'bob', 'Daily backup with restore test', 'CORRECTIVE', 'QUARTERLY', ['carol', 'EFFECTIVE', 'Restored the ledger database to staging in 47 minutes.']],
  ['dr', 'bob', 'Disaster recovery failover', 'CORRECTIVE', 'SEMI_ANNUALLY', ['carol', 'INEFFECTIVE', 'Failover exercise exceeded the 4 h recovery objective.']],
  ['vendor', 'bob', 'Critical vendor due diligence', 'PREVENTIVE', 'ANNUALLY', ['carol', 'PARTIALLY_EFFECTIVE', '3 of 9 critical vendors missing an exit plan.']],
  ['cab', 'bob', 'Change advisory board approval', 'PREVENTIVE', 'MONTHLY', ['carol', 'EFFECTIVE', 'All 31 production changes in the sample had CAB approval.']],
  ['sanctions', 'erin', 'Sanctions screening of new customers', 'PREVENTIVE', 'MONTHLY', ['carol', 'EFFECTIVE', 'Test names were all caught by the screening engine.']],
  ['dlp', 'erin', 'Data loss prevention on outbound email', 'DETECTIVE', 'QUARTERLY', ['carol', 'INEFFECTIVE', 'Test file with card numbers left the network unflagged.']],
  ['recon', 'bob', 'Suspense account reconciliation', 'DETECTIVE', 'MONTHLY', ['erin', 'EFFECTIVE', 'Month-end reconciliations signed off with no unexplained items.']],
];

// title, category, likelihood, impact, linked control keys, description
const RISKS = [
  ['Account takeover of privileged users', 'CYBER', 4, 5, ['mfa', 'siem'], 'Attackers phish or brute-force an administrator account and gain control of production systems.'],
  ['Unauthorised payment release', 'FRAUD', 3, 5, ['dual', 'txmon'], 'A single employee releases a high-value payment without independent approval.'],
  ['Card-not-present fraud spike', 'FRAUD', 4, 4, ['txmon'], 'Stolen card details are used for online purchases faster than monitoring can respond.'],
  ['Core banking outage', 'OPERATIONAL', 3, 5, ['backup', 'dr'], 'The core ledger is unavailable for more than four hours during business hours.'],
  ['Primary data centre loss', 'OPERATIONAL', 2, 5, ['dr'], 'Fire, flood or power loss takes the primary data centre offline.'],
  ['Critical vendor failure', 'THIRD_PARTY', 3, 4, ['vendor'], 'A critical outsourced service provider fails with no tested exit plan.'],
  ['Unapproved production change', 'OPERATIONAL', 4, 3, ['cab'], 'A change reaches production without review and causes an incident.'],
  ['Sanctions breach', 'COMPLIANCE', 2, 5, ['sanctions'], 'The bank onboards or pays a sanctioned party.'],
  ['Customer data leak via email', 'CYBER', 3, 4, ['dlp'], 'Customer personal data is emailed outside the bank, by mistake or on purpose.'],
  ['Misstated suspense balances', 'FINANCIAL', 3, 3, ['recon'], 'Unreconciled suspense items hide losses or errors in the financial statements.'],
  ['Excessive access rights', 'CYBER', 4, 3, ['uar'], 'Staff keep access they no longer need after moving roles.'],
  ['Ransomware on branch network', 'CYBER', 4, 5, ['backup'], 'Ransomware encrypts branch systems and spreads to shared drives.'],
  ['Late regulatory reporting', 'COMPLIANCE', 3, 3, [], 'A mandatory regulatory return is filed after its deadline.'],
  ['AML alert backlog', 'COMPLIANCE', 4, 4, ['txmon'], 'Anti-money-laundering alerts age beyond policy because of analyst capacity.'],
];
const CONTROL_DESCRIPTIONS = {
  mfa: 'Administrator logins to production consoles require a second factor. Test: attempt a password-only login on a sample of admin accounts.',
  siem: 'Privileged logins outside business hours or from new locations raise an alert to the security operations centre.',
  uar: 'Line managers re-certify every user’s access each quarter; leavers are removed within 24 hours.',
  dual: 'Payments above EUR 50,000 need a second, independent approver before release.',
  txmon: 'Rules flag unusual card and transfer activity for analyst review.',
  backup: 'Core databases are backed up daily and a restore is tested every quarter.',
  dr: 'Critical systems fail over to the secondary site within the 4-hour recovery objective.',
  vendor: 'Critical suppliers are assessed before onboarding and annually, including an exit plan.',
  cab: 'Every production change is reviewed and approved by the change advisory board.',
  sanctions: 'New customers and payees are screened against sanctions lists before onboarding.',
  dlp: 'Outbound email is scanned for customer and card data; matches are blocked or quarantined.',
  recon: 'Suspense accounts are reconciled at month end and unexplained items escalated.',
};

const CLOSED_RISK = ['Legacy fax payment instructions', 'OPERATIONAL', 3, 4, 'Fax instructions were withdrawn in Q1; kept for the audit record.'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(token, method, path, body) {
  await sleep(40); // stay well inside the gateway's per-user rate limit
  const response = await fetch(GATEWAY + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${json?.detail ?? text}`);
  }
  return json;
}

async function login(username) {
  const { accessToken } = await call(null, 'POST', '/api/auth/login', { username, password: PASSWORD });
  return accessToken;
}

async function main() {
  const tokens = {};
  try {
    for (const user of ['alice', 'bob', 'carol', 'erin']) tokens[user] = await login(user);
  } catch (e) {
    console.error(`Cannot log in through ${GATEWAY}. Are the gateway and services running?\n${e.message}`);
    process.exit(1);
  }

  const existing = await call(tokens.alice, 'GET', '/api/risks?size=1');
  if (existing.totalElements > 0 && !force) {
    console.log(`The register already has ${existing.totalElements} risk(s); nothing seeded.`);
    console.log('Start clean with: docker compose down -v && node scripts/start.mjs');
    console.log('or add --force to seed on top of the existing data.');
    return;
  }

  const controlIds = {};
  for (const [key, owner, name, type, frequency, assessment] of CONTROLS) {
    const control = await call(tokens[owner], 'POST', '/api/controls', {
      name,
      type,
      frequency,
      description: CONTROL_DESCRIPTIONS[key],
    });
    controlIds[key] = control.id;
    if (assessment) {
      const [tester, result, evidence] = assessment;
      await call(tokens[tester], 'POST', `/api/controls/${control.id}/assessments`, { result, evidence, comments: '' });
    }
  }
  console.log(`Created ${CONTROLS.length} controls and their first assessments.`);

  let linked = 0;
  for (const [title, category, likelihood, impact, controls, description] of RISKS) {
    const risk = await call(tokens.alice, 'POST', '/api/risks', { title, category, likelihood, impact, description });
    for (const key of controls) {
      await call(tokens.alice, 'POST', `/api/risks/${risk.id}/controls/${controlIds[key]}`);
      linked++;
    }
  }
  const [title, category, likelihood, impact, description] = CLOSED_RISK;
  const closed = await call(tokens.alice, 'POST', '/api/risks', { title, category, likelihood, impact, description });
  await call(tokens.alice, 'PATCH', `/api/risks/${closed.id}/status`, { status: 'CLOSED', version: closed.version });
  console.log(`Created ${RISKS.length + 1} risks (one closed) and ${linked} links.`);

  console.log(`
Demo: sign in as carol (password ${PASSWORD}), open Controls > "MFA on admin accounts" and record
INEFFECTIVE. "Account takeover of privileged users" moves from Medium 10 to Critical 20 on the residual
heat-map, and "SIEM alerting on privileged access" appears in the re-test queue.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
