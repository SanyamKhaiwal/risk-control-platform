// What the "How it works" page shows: which boxes talk, who acts, and the scenarios that walk through them.

export type NodeId = 'browser' | 'gateway' | 'redis' | 'risk' | 'kafka' | 'control' | 'postgres' | 'mongo';
export type ActorId = 'alice' | 'bob' | 'carol' | 'dave' | 'you' | 'system';
export type Rating = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const ACTORS: Record<ActorId, { name: string; role: string; person: boolean }> = {
  alice: { name: 'Alice', role: 'Risk owner', person: true },
  bob: { name: 'Bob', role: 'Control owner', person: true },
  carol: { name: 'Carol', role: 'Tester', person: true },
  dave: { name: 'Dave', role: 'Viewer', person: true },
  you: { name: 'You', role: 'Any signed-in user', person: true },
  system: { name: 'Automatic', role: 'Nobody clicks anything', person: false },
};

export const EDGE_NODES: Record<string, [NodeId, NodeId]> = {
  'browser-gateway': ['browser', 'gateway'],
  'gateway-redis': ['gateway', 'redis'],
  'gateway-risk': ['gateway', 'risk'],
  'gateway-control': ['gateway', 'control'],
  'risk-redis': ['risk', 'redis'],
  'risk-postgres': ['risk', 'postgres'],
  'control-mongo': ['control', 'mongo'],
  'control-kafka': ['control', 'kafka'],
  'kafka-risk': ['kafka', 'risk'],
  'risk-kafka': ['risk', 'kafka'],
  'kafka-control': ['kafka', 'control'],
  'risk-control': ['risk', 'control'],
};

const ALL: NodeId[] = ['browser', 'gateway', 'redis', 'risk', 'kafka', 'control', 'postgres', 'mongo'];
const FOUNDATIONS: NodeId[] = ['postgres', 'mongo', 'kafka', 'redis'];

export interface FlowStep {
  actor: ActorId;
  title: string;
  /** One or two plain sentences, shown on the diagram. */
  text: string;
  /** Edge ids in order; a leading "-" means the hop runs against the arrow (a reply). */
  path: string[];
  /** Extra boxes to light up when a step has no hops. */
  nodes?: NodeId[];
  /** Boxes shown as stopped. */
  down?: NodeId[];
  /** Containers not started yet (dimmed). */
  off?: NodeId[];
  /** Containers that have passed their health check. */
  healthy?: NodeId[];
  /** Light the Docker Compose frame around the whole diagram. */
  frame?: boolean;
  /** The example risk's score after this step, shown as a badge on the diagram. */
  score?: { now: number; was?: number; rating: Rating };
  /** The technical name for what happens, shown in "Under the hood". */
  tech?: string;
}

export interface Scenario {
  id: string;
  name: string;
  intro: string;
  steps: FlowStep[];
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'story',
    name: 'The full story',
    intro: 'From a new risk to a failed control: Alice records a risk, Bob adds a safeguard, Carol tests it, and the score moves on its own.',
    steps: [
      { actor: 'alice', title: 'Alice records a risk', path: ['browser-gateway', 'gateway-risk', 'risk-postgres'], score: { now: 20, rating: 'CRITICAL' }, text: 'Alice writes down “Payment diverted by email impersonation”. Likely (4) × severe (5) = 20, Critical. It is saved in PostgreSQL.', tech: 'POST /api/risks · stored in the risk table with a history row' },
      { actor: 'bob', title: 'Bob adds a safeguard', path: ['browser-gateway', 'gateway-control', 'control-mongo'], score: { now: 20, rating: 'CRITICAL' }, text: 'Bob creates the control “Call-back check before changing bank details”. Nobody has tested it, so it lowers nothing yet.', tech: 'POST /api/controls · saved in MongoDB' },
      { actor: 'carol', title: 'Carol tests it: it works', path: ['browser-gateway', 'gateway-control', 'control-mongo'], score: { now: 20, rating: 'CRITICAL' }, text: 'Carol checks 20 recent bank-detail changes. All were confirmed by phone, so she records “Works”. The result is kept for good.', tech: 'POST /api/controls/{id}/assessments · hash-chained record' },
      { actor: 'alice', title: 'Alice links the control', path: ['browser-gateway', 'gateway-risk', 'risk-control', '-risk-control'], score: { now: 20, rating: 'CRITICAL' }, text: 'Alice adds the control to her risk. The Risk Service asks the Control Service whether it is real and how its last test went: “Works”.', tech: 'POST /api/risks/{id}/controls/{controlId} · REST check with Alice’s token' },
      { actor: 'system', title: 'The score comes down', path: ['risk-postgres', 'risk-redis'], score: { was: 20, now: 5, rating: 'LOW' }, text: 'A working control that stops the fraud makes it rare: likely (4) becomes rare (1). 1 × 5 = 5, Low. The old cached map is cleared.', tech: 'scoring engine · history row “Linked” · cache evicted' },
      { actor: 'carol', title: 'A month later, it fails', path: ['browser-gateway', 'gateway-control', 'control-mongo', 'control-kafka'], score: { now: 5, rating: 'LOW' }, text: 'Carol finds three changes approved by email reply. She records “Doesn’t work”, and a message goes out on Kafka.', tech: 'transactional outbox → topic control.assessed' },
      { actor: 'system', title: 'The risk goes straight back up', path: ['kafka-risk', 'risk-postgres', 'risk-redis'], score: { was: 5, now: 20, rating: 'CRITICAL' }, text: 'Within half a second the Risk Service hears it and rescores: the control counts for nothing, so it is 4 × 5 = 20, Critical again.', tech: 'idempotent consumer · history row names the control' },
      { actor: 'system', title: 'Other controls are flagged', path: ['risk-kafka', 'kafka-control', 'control-mongo'], score: { now: 20, rating: 'CRITICAL' }, text: 'The risk just got worse, so its other controls that have not been tested in 30 days are put on the “Needs re-test” list.', tech: 'topic risk.updated · re-test flag on stale controls' },
      { actor: 'dave', title: 'Everyone sees it', path: ['browser-gateway', 'gateway-risk', '-gateway-risk', '-browser-gateway'], score: { now: 20, rating: 'CRITICAL' }, text: 'Dave’s dashboard refreshes every 2 seconds. The risk jumps to the red corner of the map, with the old score struck through.', tech: 'GET /api/dashboard/heatmap · fresh from PostgreSQL, then cached' },
    ],
  },
  {
    id: 'assess',
    name: 'Inside a control test',
    intro: 'The same moment as step 6 of the full story, hop by hop: what each piece does in the second after Carol clicks.',
    steps: [
      { actor: 'carol', title: 'Carol records a test result', path: ['browser-gateway', 'gateway-control'], text: 'Carol marks the control “Doesn’t work”. The request carries her sign-in token through the Gateway to the Control Service.', tech: 'POST /api/controls/{id}/assessments' },
      { actor: 'system', title: 'Saved in one go', path: ['control-mongo', '-control-mongo'], text: 'The test, its fingerprint and a “this control was tested” message are saved in one transaction. All three are kept, or none is.', tech: 'MongoDB transaction · hash chain · transactional outbox' },
      { actor: 'system', title: 'The message goes out', path: ['control-kafka'], text: 'A background job sends the waiting message to Kafka, at most half a second later.', tech: 'outbox publisher, every 500 ms · topic control.assessed' },
      { actor: 'system', title: 'The Risk Service hears about it', path: ['kafka-risk'], text: 'If it has handled this message before it skips it, so a repeat can never change a score twice.', tech: 'idempotent consumer · processed_event table' },
      { actor: 'system', title: 'Risks are rescored', path: ['risk-postgres', '-risk-postgres'], text: 'Every risk using this control gets a new score and a history row naming the control, plus its own “risk updated” message.', tech: 'one transaction: link, score, history, outbox' },
      { actor: 'system', title: 'Old numbers are cleared', path: ['risk-redis'], text: 'The cached maps are removed from Redis, so nobody is shown the old score.', tech: 'cache evicted after the transaction commits' },
      { actor: 'system', title: 'The Control Service is told', path: ['risk-kafka', 'kafka-control'], text: 'The “risk updated” message travels back through Kafka.', tech: 'topic risk.updated, keyed by risk id' },
      { actor: 'system', title: 'Related controls are flagged', path: ['control-mongo'], text: 'If the risk rose to High or Critical, its controls not tested in 30 days are flagged for re-testing.', tech: 'flag only when the rating rose' },
      { actor: 'system', title: 'The screen catches up', path: ['browser-gateway', 'gateway-risk', 'risk-postgres', '-risk-postgres', '-gateway-risk', '-browser-gateway'], text: 'The next 2-second refresh reads the new numbers and the old score is struck through in red.', tech: 'GET /api/dashboard/heatmap · cache refilled' },
    ],
  },
  {
    id: 'login',
    name: 'Signing in',
    intro: 'How a person gets a pass that every later request carries.',
    steps: [
      { actor: 'you', title: 'Username and password', path: ['browser-gateway'], text: 'The dashboard sends your username and password to the Gateway, the single front door for every request.', tech: 'POST /api/auth/login' },
      { actor: 'system', title: 'Too many tries?', path: ['gateway-redis', '-gateway-redis'], text: 'The Gateway counts sign-in attempts for this username in Redis. More than 10 a minute is refused, which slows down password guessing.', tech: 'Redis counter that expires after 60 s' },
      { actor: 'system', title: 'A signed pass is made', path: [], nodes: ['gateway'], text: 'The password is checked against a scrambled copy. If it matches, the Gateway signs a pass naming you and your roles. Only it holds the key.', tech: 'bcrypt · RS256 JWT, valid 30 minutes' },
      { actor: 'system', title: 'The pass goes back', path: ['-browser-gateway'], text: 'The browser keeps the pass and sends it with every request, so the password never travels again.', tech: 'Authorization: Bearer …' },
    ],
  },
  {
    id: 'overview',
    name: 'Loading the maps',
    intro: 'What happens each time the heat-maps load. It runs every 2 seconds on live screens.',
    steps: [
      { actor: 'you', title: 'Ask for the heat-maps', path: ['browser-gateway'], text: 'The overview asks for the two 5×5 maps, sending your pass along.', tech: 'GET /api/dashboard/heatmap' },
      { actor: 'system', title: 'Pass and speed check', path: ['gateway-redis', '-gateway-redis'], text: 'The Gateway checks the pass is genuine and not expired, and that you haven’t sent more than about 20 requests a second.', tech: 'token bucket per user, stored in Redis' },
      { actor: 'system', title: 'Passed to the Risk Service', path: ['gateway-risk'], text: 'The Risk Service checks the pass again: services never trust a request just because it came through the front door.', tech: 'each service verifies the JWT itself' },
      { actor: 'system', title: 'Look in the cache first', path: ['risk-redis', '-risk-redis'], text: 'If the maps are already in Redis, the answer is ready in a few milliseconds.', tech: 'Redis key dashHeatmap::all' },
      { actor: 'system', title: 'Otherwise, count and remember', path: ['risk-postgres', '-risk-postgres', 'risk-redis'], text: 'If not, it counts the risks in each square in PostgreSQL and keeps the answer in Redis until a risk changes.', tech: 'SQL GROUP BY likelihood, impact' },
      { actor: 'system', title: 'Back to the screen', path: ['-gateway-risk', '-browser-gateway'], text: 'The counts return and the two maps are drawn.' },
    ],
  },
  {
    id: 'startup',
    name: 'Starting it up',
    intro: 'How one command brings up all eight containers in Docker, each waiting for the ones it needs to be healthy.',
    steps: [
      { actor: 'you', title: 'One command', path: [], frame: true, off: [...ALL], text: 'You run node scripts/start.mjs. It starts Docker if needed, then asks Docker Compose to bring up all eight containers.', tech: 'docker compose up -d --build --wait' },
      { actor: 'system', title: 'The foundations start first', path: [], frame: true, nodes: [...FOUNDATIONS], off: ['control', 'risk', 'gateway', 'browser'], text: 'The two databases, Kafka and Redis start together. Nothing else may start until each of them passes its health check.', tech: 'pg_isready · mongosh ping · TCP check on 9092 · redis-cli ping' },
      { actor: 'system', title: 'They report healthy', path: [], frame: true, healthy: [...FOUNDATIONS], off: ['control', 'risk', 'gateway', 'browser'], text: 'Every few seconds Docker asks each one “are you ready?”. Once all four say yes, the services are allowed to start.', tech: 'healthcheck: interval, timeout, retries' },
      { actor: 'system', title: 'The Control Service starts', path: ['control-mongo', 'control-kafka'], frame: true, healthy: [...FOUNDATIONS], off: ['risk', 'gateway', 'browser'], text: 'It needs MongoDB and Kafka. It reports healthy only when it can reach both.', tech: 'depends_on: service_healthy · /actuator/health/readiness' },
      { actor: 'system', title: 'The Risk Service starts', path: ['risk-postgres', 'risk-redis', 'risk-kafka'], frame: true, healthy: [...FOUNDATIONS, 'control'], off: ['gateway', 'browser'], text: 'It needs PostgreSQL, Kafka and Redis, plus the Control Service, which it asks about controls.', tech: 'database schema migrated by Flyway on start' },
      { actor: 'system', title: 'The Gateway starts', path: ['gateway-redis', 'gateway-risk', 'gateway-control'], frame: true, healthy: [...FOUNDATIONS, 'control', 'risk'], off: ['browser'], text: 'The front door opens after both services, so it never sends a request to one that isn’t ready.', tech: 'Java services run as a non-root user, with memory and CPU limits' },
      { actor: 'system', title: 'The dashboard starts', path: ['browser-gateway'], frame: true, healthy: [...FOUNDATIONS, 'control', 'risk', 'gateway'], text: 'A small web server hands the screens to the browser. When it answers, all eight containers are healthy.', tech: 'nginx (unprivileged) with security headers' },
      { actor: 'system', title: 'Ready to use', path: [], frame: true, healthy: [...ALL], text: 'The script checks the Gateway and the dashboard answer, loads demo data into an empty register, and opens your browser. About 40 seconds from a stopped Docker.', tech: 'restart: unless-stopped brings a crashed container back by itself' },
    ],
  },
  {
    id: 'failures',
    name: 'When something breaks',
    intro: 'Why one piece stopping doesn’t lose data.',
    steps: [
      { actor: 'carol', title: 'The Risk Service stops', path: ['browser-gateway', 'gateway-control', 'control-mongo', 'control-kafka'], down: ['risk'], text: 'Say the Risk Service crashes. Carol can still record tests: they are saved and the messages go to Kafka as usual.' },
      { actor: 'system', title: 'Kafka holds the messages', path: [], nodes: ['kafka'], down: ['risk'], text: 'Kafka keeps the messages safely on disk until someone reads them. Nothing is lost.', tech: 'consumer offsets track what was read' },
      { actor: 'system', title: 'It restarts and catches up', path: ['kafka-risk', 'risk-postgres'], text: 'Docker restarts the Risk Service, which carries on from the last message it handled. We tested it: back in 21 seconds, nothing lost.', tech: 'restart policy · resume from the committed offset' },
      { actor: 'system', title: 'A broken message', path: [], nodes: ['kafka', 'risk'], text: 'A message that can never be read is retried 3 times, then moved aside to a “dead letter” topic so it can’t block the ones behind it.', tech: 'control.assessed.DLT · risk.updated.DLT' },
      { actor: 'system', title: 'Redis stops', path: ['browser-gateway', 'gateway-risk', 'risk-postgres', '-risk-postgres', '-gateway-risk', '-browser-gateway'], down: ['redis'], text: 'If Redis is unavailable, the Risk Service reads straight from PostgreSQL. A little slower, still correct.', tech: 'cache errors are logged, never shown to users' },
    ],
  },
];

export interface Piece {
  node: NodeId;
  kind: string;
  name: string;
  port: string;
  tech: string;
  does: string;
  why: string;
  down: string;
}

export const PIECES: Piece[] = [
  { node: 'browser', kind: 'Screens', name: 'Dashboard', port: ':5173', tech: 'React 19 · TypeScript · Vite', does: 'The screens people use: maps, risks, controls, tests. Live screens ask for fresh data every 2 seconds.', why: 'React is the most common way to build interactive web apps; TypeScript catches mistakes before the code runs.', down: 'Nobody can see the screens. Everything behind it keeps running.' },
  { node: 'gateway', kind: 'Front door', name: 'Gateway', port: ':8080', tech: 'Spring Cloud Gateway', does: 'Signs people in, checks every pass, limits how many requests each user can send, and routes each request to the right service.', why: 'Security rules live in one place instead of being copied into every service.', down: 'The platform can’t be reached from the browser.' },
  { node: 'risk', kind: 'Service', name: 'Risk Service', port: ':8081', tech: 'Java 21 · Spring Boot', does: 'Owns risks, their scores and history, the links to controls, and the numbers behind the heat-maps.', why: 'Scores must always add up, so it keeps its data in a strict relational database.', down: 'Tests are still recorded; risk scores catch up as soon as it restarts.' },
  { node: 'control', kind: 'Service', name: 'Control Service', port: ':8082', tech: 'Java 21 · Spring Boot', does: 'Owns controls and their test results, keeps the tamper-evident test history, and flags controls that need re-testing.', why: 'Test evidence varies in shape and is only ever added to, which suits a document database.', down: 'No new tests can be recorded; risks stay readable.' },
  { node: 'postgres', kind: 'Database', name: 'PostgreSQL', port: ':5432', tech: 'PostgreSQL 17', does: 'Stores the Risk Service’s data: risks, links, score history, and its outbox of messages to send.', why: 'Transactions keep a score and its history in step; SQL counts risks per square in one query.', down: 'The Risk Service can’t read or save risks.' },
  { node: 'mongo', kind: 'Database', name: 'MongoDB', port: ':27017', tech: 'MongoDB 8 · replica set', does: 'Stores the Control Service’s data: controls, test records, and its outbox.', why: 'Flexible documents; running as a replica set lets several writes be saved together in one transaction.', down: 'The Control Service can’t read or save controls.' },
  { node: 'kafka', kind: 'Message bus', name: 'Kafka', port: ':9092', tech: 'Apache Kafka 4 (KRaft)', does: 'Carries messages between the two services: control.assessed one way, risk.updated the other, plus “dead letter” topics for broken messages.', why: 'The services never wait on each other, one can be down without losing anything, and messages can be replayed.', down: 'Updates between the services pause; outboxes hold them until Kafka is back.' },
  { node: 'redis', kind: 'Cache', name: 'Redis', port: ':6379', tech: 'Redis 7', does: 'Keeps the heat-maps and top-risks list ready in memory, and counts requests and sign-in attempts for rate limits.', why: 'Answers in well under a millisecond; entries are cleared the moment a risk changes.', down: 'Pages load from PostgreSQL instead, a little slower.' },
];

export const PROMISES = [
  { title: 'Nothing gets lost', text: 'A change and the message announcing it are saved in the same database transaction (an “outbox”), then sent to Kafka. If a service crashes in between, the message is still waiting and goes out on restart.' },
  { title: 'Nothing counts twice', text: 'Every message has an id. A service records the ids it has handled, in the same transaction as the change, so a message delivered twice is skipped and an old one arriving late is ignored.' },
  { title: 'Nobody can fake it', text: 'Only the Gateway can sign a pass, and every service checks it again. Owners can’t test their own controls, and every test record carries a fingerprint of the one before, so edits show up.' },
];
