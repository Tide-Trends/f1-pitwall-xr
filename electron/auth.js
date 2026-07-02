const { BrowserWindow, session, ipcMain } = require('electron');

const F1TV_ORIGIN = 'https://f1tv.formula1.com';
const AUTH_PARTITION = 'persist:pitwall-f1tv';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let authWindow = null;

function registerAuthHandlers() {
  ipcMain.handle('pitwall:f1tv-open', () => openAuthWindow());
  ipcMain.handle('pitwall:f1tv-finish', () => finishAuthFromSession());
  ipcMain.handle('pitwall:f1tv-login', () => finishAuthFromSession());
}

function openAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return { opened: true };
  }

  authWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'F1 TV — sign in, then return to PitWall XR',
    autoHideMenuBar: true,
    webPreferences: {
      partition: AUTH_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  authWindow.on('closed', () => {
    authWindow = null;
  });

  // Land on the account page so "Sign in" is visible even if home page is public
  authWindow.loadURL(`${F1TV_ORIGIN}/`);
  return { opened: true };
}

/**
 * F1 TV persists login in a `login-session` cookie on .formula1.com:
 * URL-encoded JSON { data: { subscriptionToken: "eyJ..." } }.
 * The F1 TV API requires that token as the `ascendontoken` header —
 * cookies alone are not enough (401).
 */
async function finishAuthFromSession() {
  const authSession = session.fromPartition(AUTH_PARTITION);
  const cookies = await exportCookiesFromSession(authSession);

  const subscriptionToken = extractSubscriptionToken(cookies.list);
  if (!subscriptionToken) {
    throw new Error(
      'No F1 TV login found. In the F1 TV window, click the profile icon (top right) and sign in, then press Continue again.',
    );
  }

  const result = await fetchEntitlement(subscriptionToken, cookies.cookieHeader);
  if (!result.entitlementToken) {
    throw new Error(
      `F1 TV session found but entitlement failed (${result.status}). Your subscription may need re-login — sign out and back in on the F1 TV window.`,
    );
  }

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }

  return {
    subscriptionToken,
    entitlementToken: result.entitlementToken,
    entitlement: result.entitlement,
    groupId: result.groupId,
    cookies,
  };
}

function extractSubscriptionToken(cookieList) {
  const loginCookie = cookieList.find((c) => c.name === 'login-session');
  if (loginCookie) {
    try {
      const parsed = JSON.parse(decodeURIComponent(loginCookie.value));
      const token = parsed?.data?.subscriptionToken;
      if (token && token.startsWith('eyJ')) return token;
    } catch {}
  }
  // Fallbacks: any JWT-looking cookie in the auth namespace
  for (const c of cookieList) {
    if (/session|token|ascendon/i.test(c.name) && c.value.startsWith('eyJ') && c.value.length > 80) {
      return c.value;
    }
    try {
      const parsed = JSON.parse(decodeURIComponent(c.value));
      const token = parsed?.data?.subscriptionToken || parsed?.subscriptionToken;
      if (token && token.startsWith('eyJ')) return token;
    } catch {}
  }
  return null;
}

async function fetchEntitlement(subscriptionToken, cookieHeader) {
  const headers = {
    ascendontoken: subscriptionToken,
    Accept: 'application/json',
    'User-Agent': UA,
    Origin: F1TV_ORIGIN,
    Referer: `${F1TV_ORIGIN}/`,
  };
  if (cookieHeader) headers.Cookie = cookieHeader;

  let entitlementToken = null;
  let status = 0;
  try {
    const entRes = await fetch(`${F1TV_ORIGIN}/2.0/R/ENG/WEB_DASH/ALL/USER/ENTITLEMENT`, { headers });
    status = entRes.status;
    const body = await entRes.text();
    try {
      entitlementToken = JSON.parse(body)?.resultObj?.entitlementToken ?? null;
    } catch {}
  } catch (err) {
    throw new Error(`Could not reach F1 TV API: ${err.message}`);
  }

  let entitlement = 'F1_TV_Pro_Annual';
  let groupId = 2;
  if (entitlementToken) {
    try {
      const locRes = await fetch(`${F1TV_ORIGIN}/1.0/R/ENG/WEB_DASH/ALL/USER/LOCATION`, {
        headers: { ...headers, entitlementtoken: entitlementToken },
      });
      const u = JSON.parse(await locRes.text())?.resultObj?.userLocation?.[0];
      if (u) {
        entitlement = u.entitlement;
        groupId = u.groupId;
      }
    } catch {}
  }

  return { entitlementToken, entitlement, groupId, status };
}

async function exportCookiesFromSession(sess) {
  const urls = ['https://f1tv.formula1.com', 'https://www.formula1.com', 'https://formula1.com', 'https://account.formula1.com', 'https://api.formula1.com'];
  const all = [];
  for (const url of urls) {
    try {
      all.push(...(await sess.cookies.get({ url })));
    } catch {}
  }
  // Also grab everything on the partition (login-session lives on .formula1.com)
  try {
    all.push(...(await sess.cookies.get({})));
  } catch {}

  const seen = new Set();
  const unique = all.filter((c) => {
    const k = `${c.name}@${c.domain}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    cookieHeader: unique
      .filter((c) => c.domain.includes('formula1'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; '),
    list: unique,
    cookies: unique.map((c) => ({ name: c.name, value: c.value, domain: c.domain })),
  };
}

module.exports = { registerAuthHandlers, AUTH_PARTITION };
