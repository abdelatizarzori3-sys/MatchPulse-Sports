import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
const script = readFileSync(resolve(root, 'public/app.js'), 'utf8');
const mobileHtml = readFileSync(resolve(root, 'mobile-web/index.html'), 'utf8');
const mobileScript = readFileSync(resolve(root, 'mobile-web/app.js'), 'utf8');

test('MatchPulse exposes source feed status and a server-gated calendar export in web and mobile assets', () => {
  assert.match(html, /id="feed-indicator"/);
  assert.match(html, /id="calendar-export"/);
  assert.match(html, /id="export-visible"/);
  assert.match(html, /id="export-selected"/);
  assert.match(script, /function setFeedState/);
  assert.match(script, /function isScheduledStatus/);
  assert.match(script, /function isCalendarEligible/);
  assert.match(script, /api\/pro\/entitlement/);
  assert.match(script, /api\/pro\/calendar\/export/);
  assert.match(script, /state\.entitlement\.allowed/);
  assert.doesNotMatch(script, /matchpulse.*entitlement.*localStorage/i);
  assert.doesNotMatch(script, /Math\.random\(\).*prediction/);
  assert.match(mobileHtml, /id="calendar-export"/);
  assert.match(mobileScript, /api\/pro\/calendar\/export/);
});
