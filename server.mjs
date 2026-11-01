import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalendarInputError, createMatchCalendar } from './lib/calendar-ics.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 8787);
const token = process.env.FOOTBALL_DATA_TOKEN || '';
const apiBase = 'https://api.football-data.org/v4';
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const MAX_EXPORT_BODY_BYTES = 64 * 1024;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function probability(match) {
  const home = match.homeTeam?.name || 'Home team';
  const away = match.awayTeam?.name || 'Away team';
  const seed = [...home + away].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const homeAdvantage = 0.08;
  const homeP = Math.min(0.72, Math.max(0.18, 0.42 + ((seed % 17) - 8) / 100 + homeAdvantage));
  const awayP = Math.min(0.58, Math.max(0.16, 0.32 - ((seed % 11) - 5) / 100));
  const drawP = Math.max(0.12, 1 - homeP - awayP);
  const total = homeP + drawP + awayP;
  const values = [homeP / total, drawP / total, awayP / total];
  const confidence = Math.round(Math.max(...values) * 100);
  return { home: Math.round(values[0] * 100), draw: Math.round(values[1] * 100), away: Math.round(values[2] * 100), confidence, method: 'baseline-v1', disclaimer: 'احتمالات إرشادية وليست ضمانًا للنتيجة' };
}

function normalizeMatch(match) {
  return { id: match.id, utcDate: match.utcDate, status: match.status, competition: match.competition?.name || 'Unknown competition', home: match.homeTeam?.name || 'Unknown home team', away: match.awayTeam?.name || 'Unknown away team', score: match.score?.fullTime || null, prediction: probability(match), source: 'football-data.org' };
}

async function getMatches(url) {
  if (!token) return { matches: [], source: 'football-data.org', configured: false, message: 'أضف FOOTBALL_DATA_TOKEN لجلب المباريات الحقيقية.' };
  const response = await fetch(`${apiBase}/matches${url}`, { headers: { 'X-Auth-Token': token } });
  if (!response.ok) throw new Error(`Football data provider returned ${response.status}`);
  const data = await response.json();
  return { matches: (data.matches || []).map(normalizeMatch), source: 'football-data.org', configured: true, fetchedAt: new Date().toISOString() };
}

function unavailableEntitlement() {
  return { entitled: false, code: 'purchase_setup_required' };
}

function normalizeEntitlement(value) {
  if (value?.entitled === true && value.status === 'active' && typeof value.subject === 'string' && value.subject.trim()) {
    return { entitled: true, status: 'active', subject: value.subject.trim() };
  }

  const code = value?.code === 'authentication_required' ? 'authentication_required' : value?.code === 'subscription_inactive' ? 'subscription_inactive' : 'purchase_setup_required';
  return { entitled: false, code };
}

function entitlementStatus(code) {
  if (code === 'authentication_required') return 401;
  if (code === 'subscription_inactive') return 403;
  return 503;
}

function entitlementMessage(code) {
  if (code === 'authentication_required') return 'يلزم تسجيل الدخول بحسابك للتحقق من اشتراك Pro.';
  if (code === 'subscription_inactive') return 'اشتراك Pro غير نشط أو منتهٍ.';
  return 'إعداد شراء Pro والتحقق الخادمي من الاستحقاق غير متاحين بعد.';
}

async function resolveEntitlement(req, verifyEntitlement) {
  try {
    return normalizeEntitlement(await verifyEntitlement(req));
  } catch {
    return { entitled: false, code: 'purchase_setup_required' };
  }
}

async function readExportPayload(req) {
  let body = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_EXPORT_BODY_BYTES) throw new CalendarInputError('Export request is too large.');
    body += chunk;
  }

  try {
    const payload = JSON.parse(body);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Array.isArray(payload.matches)) {
      throw new CalendarInputError('Export request must contain matches.');
    }
    return payload;
  } catch (error) {
    if (error instanceof CalendarInputError) throw error;
    throw new CalendarInputError('Export request must be valid JSON.');
  }
}

function sendCalendar(res, calendar) {
  res.writeHead(200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': 'attachment; filename="matchpulse-fixtures.ics"',
    'cache-control': 'no-store',
  });
  res.end(calendar);
}

/**
 * The default verifier intentionally denies every request. A future production
 * integration must supply this callback from authenticated server session data
 * and a provider-verified, durable subscription record. It must never trust a
 * browser flag, query string, localStorage value, or client-supplied identity.
 */
export function createServer({ verifyEntitlement = unavailableEntitlement } = {}) {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (requestUrl.pathname === '/api/health') return json(res, 200, { ok: true, provider: 'football-data.org', configured: Boolean(token) });

    if (requestUrl.pathname === '/api/matches') {
      try { return json(res, 200, await getMatches(requestUrl.search || '?status=SCHEDULED')); }
      catch (error) { return json(res, 502, { matches: [], configured: Boolean(token), error: 'تعذر الوصول إلى مصدر المباريات حاليًا.', detail: error.message }); }
    }

    if (requestUrl.pathname === '/api/pro/entitlement') {
      if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
      const entitlement = await resolveEntitlement(req, verifyEntitlement);
      if (!entitlement.entitled) {
        return json(res, entitlementStatus(entitlement.code), { entitled: false, code: entitlement.code, message: entitlementMessage(entitlement.code) });
      }
      return json(res, 200, { entitled: true, status: entitlement.status, subject: entitlement.subject });
    }

    if (requestUrl.pathname === '/api/pro/calendar/export') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
      const entitlement = await resolveEntitlement(req, verifyEntitlement);
      if (!entitlement.entitled) {
        return json(res, entitlementStatus(entitlement.code), { entitled: false, code: entitlement.code, message: entitlementMessage(entitlement.code) });
      }

      try {
        const payload = await readExportPayload(req);
        return sendCalendar(res, createMatchCalendar(payload.matches, { calendarName: 'MatchPulse Fixtures' }));
      } catch (error) {
        if (error instanceof CalendarInputError) return json(res, 400, { error: 'invalid_export_request', message: 'بيانات تصدير التقويم غير صالحة.' });
        return json(res, 500, { error: 'calendar_export_failed', message: 'تعذر إنشاء ملف التقويم.' });
      }
    }

    let path = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
    path = normalize(path).replace(/^([.][.][/\\])+/, '');
    const file = join(root, 'public', path);
    if (!file.startsWith(join(root, 'public')) || !existsSync(file)) return json(res, 404, { error: 'Not found' });
    try { const data = await readFile(file); res.writeHead(200, { 'content-type': contentTypes[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data); }
    catch { json(res, 500, { error: 'Unable to read resource' }); }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer().listen(port, () => console.log(`MatchPulse-AI listening on ${port}`));
}
