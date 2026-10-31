// mongosh script: the reviewer's attack on the hash chain. Edits the latest assessment of one control that "works",
// recomputes its hash the way the service used to (plain SHA-256, no key) and moves the control's chain head to it.
const crypto = require('crypto');
const field = (v) => (v === null || v === undefined ? '-:;' : `${Buffer.byteLength(String(v), 'utf8')}:${v};`);
const dbl = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const c = db.getSiblingDB('controldb');
const a = c.assessments.find({ result: 'EFFECTIVE' }).sort({ sequence: -1 }).limit(1).next();
const control = c.controls.findOne({ _id: a.controlId });
if (control.lastAssessmentHash !== a.hash) { print('not the latest; pick another'); quit(1); }
const canonical = field(a.controlId) + field(String(a.sequence)) + field('INEFFECTIVE') + field(dbl(0.0)) + field(a.tester)
  + field(a.evidence) + field(a.comments) + field(a.assessedAt.toISOString()) + field(a.prevHash);
const forged = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
c.assessments.updateOne({ _id: a._id }, { $set: { result: 'INEFFECTIVE', effectiveness: 0.0, hash: forged } });
c.controls.updateOne({ _id: a.controlId }, { $set: { lastAssessmentHash: forged, latestResult: 'INEFFECTIVE', latestEffectiveness: 0.0 } });
print(`tampered control ${a.controlId}, assessment ${a._id}`);
