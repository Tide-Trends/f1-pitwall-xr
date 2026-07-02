#!/usr/bin/env node
/**
 * Debug F1 TV replay catalog — reads tokens from apps/data/tokens.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensPath = path.join(__dirname, '../apps/data/tokens.json');

if (!fs.existsSync(tokensPath)) {
  console.error('No tokens at', tokensPath, '— sign in via the app first');
  process.exit(1);
}

const all = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
const tokens = all.default ?? Object.values(all)[0];
if (!tokens?.entitlementToken) {
  console.error('Invalid tokens');
  process.exit(1);
}

const F1_BASE = 'https://f1tv.formula1.com';
const year = process.argv[2] ?? '2025';
const entitlement = tokens.entitlement;
const groupId = tokens.groupId;

async function f1get(path) {
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    Origin: 'https://f1tv.formula1.com',
    Referer: 'https://f1tv.formula1.com/',
    ascendontoken: tokens.subscriptionToken,
    entitlementtoken: tokens.entitlementToken,
  };
  if (tokens.cookieHeader) headers.Cookie = tokens.cookieHeader;
  const res = await fetch(`${F1_BASE}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 500), json: tryParse(text) };
}

function tryParse(t) {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function countContainers(json) {
  if (!json?.resultObj?.containers) return 0;
  let n = 0;
  const walk = (c) => {
    n++;
    for (const ch of c.retrieveItems?.resultObj?.containers ?? []) walk(ch);
  };
  for (const c of json.resultObj.containers) walk(c);
  return n;
}

function sampleTitles(json, limit = 15) {
  const titles = [];
  const walk = (c) => {
    const t = c.metadata?.title ?? c.metadata?.label;
    if (t && titles.length < limit) titles.push(String(t));
    for (const ch of c.retrieveItems?.resultObj?.containers ?? []) walk(ch);
  };
  for (const c of json?.resultObj?.containers ?? []) walk(c);
  return titles;
}

console.log('Tokens:', { entitlement, groupId, hasSub: !!tokens.subscriptionToken });

const searches = [
  `/2.0/R/ENG/WEB_DASH/ALL/PAGE/SEARCH/VOD/${entitlement}/${groupId}?filter_season=${year}&orderBy=meeting_End_Date&sortOrder=desc`,
  `/2.0/R/ENG/WEB_DASH/ALL/PAGE/SEARCH/VOD/${entitlement}/${groupId}?filter_season=${year}&filter_objectSubtype=Meeting&orderBy=meeting_End_Date&sortOrder=desc`,
  `/2.0/R/ENG/WEB_DASH/ALL/PAGE/493/${entitlement}/${groupId}`,
  `/2.0/R/ENG/WEB_DASH/ALL/PAGE/SEARCH/VOD/F1_TV_Pro_Annual/2?filter_season=${year}&orderBy=meeting_End_Date&sortOrder=desc`,
];

for (const p of searches) {
  console.log('\n---', p.slice(0, 100), '...');
  const r = await f1get(p);
  console.log('status:', r.status);
  if (r.json) {
    console.log('containers top-level:', r.json.resultObj?.containers?.length ?? 0);
    console.log('nested count:', countContainers(r.json));
    console.log('sample titles:', sampleTitles(r.json));
  } else {
    console.log('body:', r.body);
  }
}
