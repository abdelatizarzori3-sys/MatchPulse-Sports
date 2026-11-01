import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from '../server.mjs';

const fixture = {
  id: 'fixture-42',
  utcDate: '2026-11-01T20:30:00Z',
  home: 'FUS Rabat',
  away: 'Wydad AC',
  competition: 'Botola',
  source: 'football-data.org',
};

async function withServer(options, run) {
  const server = createServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('calendar entitlement and export fail closed when no verified subscription service is configured', async () => {
  await withServer({}, async (origin) => {
    const entitlement = await fetch(`${origin}/api/pro/entitlement`);
    assert.equal(entitlement.status, 503);
    assert.deepEqual(await entitlement.json(), {
      entitled: false,
      code: 'purchase_setup_required',
      message: 'إعداد شراء Pro والتحقق الخادمي من الاستحقاق غير متاحين بعد.',
    });

    const exportResponse = await fetch(`${origin}/api/pro/calendar/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matches: [fixture] }),
    });
    assert.equal(exportResponse.status, 503);
    assert.match(exportResponse.headers.get('content-type'), /application\/json/);
  });
});

test('test-only verified entitlement injection permits validated ICS export and rejects invalid fixtures', async () => {
  await withServer({ verifyEntitlement: async () => ({ entitled: true, status: 'active', subject: 'test-user-1' }) }, async (origin) => {
    const exportResponse = await fetch(`${origin}/api/pro/calendar/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matches: [fixture] }),
    });
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-type'), /text\/calendar/);
    assert.match(await exportResponse.text(), /DTSTART:20261101T203000Z/);

    const invalidResponse = await fetch(`${origin}/api/pro/calendar/export`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ matches: [{ ...fixture, source: '' }] }),
    });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), { error: 'invalid_export_request', message: 'بيانات تصدير التقويم غير صالحة.' });
  });
});
