import assert from 'node:assert/strict';
import test from 'node:test';
import { CalendarInputError, createMatchCalendar } from '../lib/calendar-ics.mjs';

const fixture = {
  id: 55,
  utcDate: '2026-11-02T02:30:45+03:00',
  home: 'Atlas; Club',
  away: 'Raja, City',
  competition: 'CAF Champions League',
  source: 'football-data.org',
};

test('creates a standards-compliant UTC ICS calendar with known source and escaped fixture text', () => {
  const calendar = createMatchCalendar([fixture], { generatedAt: '2026-10-31T08:00:00.000Z' });

  assert.match(calendar, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(calendar, /DTSTAMP:20261031T080000Z/);
  assert.match(calendar, /DTSTART:20261101T233045Z/);
  assert.match(calendar, /SUMMARY:Atlas\\; Club vs Raja\\, City/);
  assert.match(calendar, /DESCRIPTION:Competition: CAF Champions League\\nSource: football-data\.org/);
  assert.match(calendar, /X-MATCHPULSE-SOURCE:football-data\.org/);
  assert.ok(calendar.endsWith('\r\n'));
  assert.equal(calendar.replace(/\r\n/g, '').includes('\n'), false, 'calendar only uses CRLF line breaks');
  assert.doesNotMatch(calendar, /odds|betting|probability/i);
});

test('folds long UTF-8 ICS content lines to RFC-friendly 75-byte segments', () => {
  const calendar = createMatchCalendar([{ ...fixture, home: 'الوداد الرياضي '.repeat(12) }], { generatedAt: '2026-10-31T08:00:00Z' });
  const lines = calendar.split('\r\n').filter(Boolean);

  assert.ok(lines.some((line) => line.startsWith(' ')), 'at least one continuation line is present');
  lines.forEach((line) => assert.ok(Buffer.byteLength(line, 'utf8') <= 75, `line exceeds 75 bytes: ${line}`));
});

test('rejects calendar entries with invalid dates or unknown sources', () => {
  assert.throws(() => createMatchCalendar([{ ...fixture, utcDate: 'not-a-date' }]), CalendarInputError);
  assert.throws(() => createMatchCalendar([{ ...fixture, source: '   ' }]), CalendarInputError);
  assert.throws(() => createMatchCalendar([]), CalendarInputError);
});
