const textEncoder = new TextEncoder();
const MAX_CALENDAR_EVENTS = 100;

export class CalendarInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CalendarInputError';
  }
}

function requiredText(value, field, maxLength = 240) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new CalendarInputError(`${field} is required.`);
  }

  const text = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text || text.length > maxLength) {
    throw new CalendarInputError(`${field} is invalid.`);
  }
  return text;
}

function formatUtc(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CalendarInputError(`${field} must be a valid date.`);
  }
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function foldContentLine(line) {
  const folded = [];
  let current = '';
  let currentBytes = 0;

  for (const character of line) {
    const characterBytes = textEncoder.encode(character).length;
    if (current && currentBytes + characterBytes > 75) {
      folded.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }

  folded.push(current);
  return folded;
}

function normalizeMatch(match) {
  if (!match || typeof match !== 'object' || Array.isArray(match)) {
    throw new CalendarInputError('Each fixture must be an object.');
  }

  return {
    id: requiredText(match.id, 'Fixture id', 160),
    utcDate: formatUtc(match.utcDate, 'Fixture date'),
    home: requiredText(match.home, 'Home team'),
    away: requiredText(match.away, 'Away team'),
    competition: requiredText(match.competition, 'Competition'),
    source: requiredText(match.source, 'Fixture source', 160),
  };
}

/**
 * Creates an RFC 5545 calendar for real fixtures. No score, probability, odds,
 * or betting information is included in the exported events.
 */
export function createMatchCalendar(matches, { calendarName = 'MatchPulse Fixtures', generatedAt = new Date() } = {}) {
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new CalendarInputError('At least one fixture is required.');
  }
  if (matches.length > MAX_CALENDAR_EVENTS) {
    throw new CalendarInputError(`A calendar can include at most ${MAX_CALENDAR_EVENTS} fixtures.`);
  }

  const fixtures = matches.map(normalizeMatch);
  const identifiers = new Set();
  fixtures.forEach((fixture) => {
    const identifier = `${fixture.source}\u0000${fixture.id}`;
    if (identifiers.has(identifier)) {
      throw new CalendarInputError('Fixtures must have unique source and id values.');
    }
    identifiers.add(identifier);
  });

  const timestamp = formatUtc(generatedAt, 'Calendar generation time');
  const safeCalendarName = requiredText(calendarName, 'Calendar name');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MatchPulse Sports//Fixture Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(safeCalendarName)}`,
  ];

  fixtures.forEach((fixture) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(`matchpulse-${fixture.source}-${fixture.id}@matchpulse.local`)}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART:${fixture.utcDate}`,
      `SUMMARY:${escapeIcsText(`${fixture.home} vs ${fixture.away}`)}`,
      `DESCRIPTION:${escapeIcsText(`Competition: ${fixture.competition}\nSource: ${fixture.source}`)}`,
      `CATEGORIES:${escapeIcsText(fixture.competition)}`,
      `X-MATCHPULSE-SOURCE:${escapeIcsText(fixture.source)}`,
      'END:VEVENT',
    );
  });

  lines.push('END:VCALENDAR');
  return lines.flatMap(foldContentLine).join('\r\n') + '\r\n';
}
