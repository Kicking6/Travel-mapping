import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { env as makeEnv, signedIn } from './_d1.js';
import { storageVerdict, STORAGE_HARD_STOP_BYTES, decodeDataUrl } from '../worker/feedback.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ctx = { where: { pathname: '/', hash: '#/map', map: { center: [6.7, 60.1], zoom: 12 } }, what: { label: 'Trolltunga', subjectType: 'route', subjectId: '42' } };

test('feedback: file with a screenshot, read it back, reply, mark read, withdraw', async () => {
  const e = makeEnv({ OPERATOR_EMAILS: 'rory@x.nz,eva@x.nz' });
  const rory = await signedIn(worker, e, 'rory@x.nz');
  const eva = await signedIn(worker, e, 'eva@x.nz');

  const made = await eva('POST', '/api/feedback', { body: 'Walk looks jagged', kind: 'bug', criticality: 'high', context: ctx, screenshot: PNG });
  assert.equal(made.status, 200);
  assert.equal(made.body.code, 'TA-' + made.body.id);
  assert.equal(made.body.screenshotError, null);
  assert.ok(e.ORIGINALS.objects.has(`feedback/${made.body.id}.png`));

  // Rory sees it as new (badge), with its context; Eva's own count doesn't include it.
  const boot = await rory('GET', '/api/bootstrap');
  assert.equal(boot.body.feedback.adminNewFeedback, 1);
  const all = await rory('GET', '/api/feedback/all');
  assert.equal(all.body.reports[0].subject_type, 'route');
  assert.equal(all.body.reports[0].context.where.map.zoom, 12);

  // Reply + status; Eva has one unread reply until she opens her list.
  assert.equal((await rory('PUT', `/api/feedback/${made.body.id}/status`, { status: 'triaged', note: 'Fixed the detail setting' })).status, 200);
  assert.equal((await eva('GET', '/api/feedback/counts')).body.unreadReplies, 1);
  const mine = await eva('GET', '/api/feedback');
  assert.equal(mine.body.reports[0].resolution_note, 'Fixed the detail setting');
  assert.equal(mine.body.reports[0].context, undefined); // the author list leaves the evidence out
  assert.equal((await eva('GET', '/api/feedback/counts')).body.unreadReplies, 0);

  // An edit after triage is flagged, not silently reopened.
  await eva('PATCH', `/api/feedback/${made.body.id}`, { body: 'Walk looks jagged at zoom 12' });
  assert.equal((await rory('GET', '/api/feedback/all')).body.reports[0].edited_since_triage, 1);

  // Only the author can withdraw; the screenshot goes with it.
  assert.equal((await rory('DELETE', `/api/feedback/${made.body.id}`)).status, 400);
  assert.equal((await eva('DELETE', `/api/feedback/${made.body.id}`)).status, 200);
  assert.ok(!e.ORIGINALS.objects.has(`feedback/${made.body.id}.png`));
  assert.equal((await rory('GET', '/api/feedback/all')).body.reports.length, 0);
});

test('feedback: empty text refused; storage guard refuses the upload that would cross the line', () => {
  assert.equal(decodeDataUrl('data:text/html;base64,AAAA'), null);
  assert.equal(storageVerdict(STORAGE_HARD_STOP_BYTES - 10, 5).allowed, true);
  assert.equal(storageVerdict(STORAGE_HARD_STOP_BYTES - 10, 50).reason, 'would_cross');
  assert.equal(storageVerdict(STORAGE_HARD_STOP_BYTES, 1).reason, 'hard_stop');
});

test('feedback: an empty report is refused', async () => {
  const e = makeEnv();
  const api = await signedIn(worker, e);
  assert.equal((await api('POST', '/api/feedback', { body: '  ' })).status, 400);
});
