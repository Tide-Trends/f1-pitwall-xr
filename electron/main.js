const { app, BrowserWindow, shell, components, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { registerAuthHandlers } = require('./auth');

const isDev = !app.isPackaged;
const certDir = path.join(__dirname, '../certs');
const hasCerts = fs.existsSync(path.join(certDir, 'cert.pem'));
const CLIENT_URL =
  process.env.CLIENT_URL ??
  (hasCerts ? 'https://localhost:5173' : 'http://localhost:5173');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('enable-widevine-cdm');
app.commandLine.appendSwitch('enable-features', 'EncryptedMediaExtensions');

let mainWindow = null;

const iconPngPath = path.join(__dirname, 'icon.png');
const iconIcnsPath = path.join(__dirname, 'icon.icns');
/** PNG for dock/window at runtime; .icns is used by electron-builder for the .app bundle. */
const appIcon = fs.existsSync(iconPngPath)
  ? iconPngPath
  : fs.existsSync(iconIcnsPath)
    ? iconIcnsPath
    : undefined;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0d0d0f',
    title: 'PitWall XR',
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
  });

  if (isDev) {
    mainWindow.webContents.session.setCertificateVerifyProc((_request, callback) => {
      callback(0);
    });
  }

  mainWindow.loadURL(CLIENT_URL);

  if (isDev && process.env.PITWALL_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/** Complete browser login: tokens + cookies → server session */
ipcMain.handle('pitwall:complete-login', async (_event, payload) => {
  const apiBase = hasCerts ? 'https://localhost:8787' : 'http://localhost:8787';

  const fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };

  // Dev HTTPS uses mkcert — Node fetch rejects unless we skip verify for localhost
  if (isDev && hasCerts) {
    const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const res = await fetch(`${apiBase}/api/auth/browser-session`, fetchOpts);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Session setup failed (${res.status})`);
      }
      return res.json();
    } finally {
      if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev;
    }
  }

  const res = await fetch(`${apiBase}/api/auth/browser-session`, fetchOpts);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Session setup failed (${res.status})`);
  }
  return res.json();
});

app.whenReady().then(async () => {
  registerAuthHandlers();

  if (process.platform === 'darwin' && appIcon) {
    app.dock.setIcon(appIcon);
  }

  try {
    if (components?.whenReady) {
      console.log('Installing Widevine CDM (castLabs ECS)…');
      await components.whenReady();
      console.log('Widevine CDM ready.');
    }
  } catch (err) {
    console.warn('Widevine CDM setup:', err.message);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
