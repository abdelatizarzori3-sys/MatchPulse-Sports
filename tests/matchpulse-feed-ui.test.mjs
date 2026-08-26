import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'public/index.html'), 'utf8');
const script = readFileSync(resolve(root, 'public/app.js'), 'utf8');
const mobileHtml = readFileSync(resolve(root, 'mobile-web/index.html'), 'utf8');
const mobileScript = readFileSync(resolve(root, 'mobile-web/app.js'), 'utf8');

test('MatchPulse exposes real source-feed state and keeps scheduled fixtures inclusive', () => {
  assert.match(html, /id="feed-indicator"/);
  assert.match(html, /id="feed-label"/);
  assert.match(script, /function setFeedState/);
  assert.match(script, /function isScheduledStatus/);
  assert.match(script, /value === 'SCHEDULED' \|\| value === 'TIMED'/);
  assert.match(script, /analysisUnavailable/);
  assert.doesNotMatch(script, /Math\.random\(\).*prediction/);
  assert.match(mobileHtml, /id="feed-indicator"/);
  assert.match(mobileScript, /function setFeedState/);
});
