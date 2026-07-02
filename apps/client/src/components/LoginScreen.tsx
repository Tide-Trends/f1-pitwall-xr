import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { pitwallApi } from '../lib/api';
import { BrandMark } from './BrandMark';

const HOSTED_URL = 'https://f1.lukaah.com';
const LOCAL_URL = 'https://localhost:5173';

function detectElectron(): boolean {
  if (typeof window === 'undefined') return false;
  return window.pitwall?.isElectron === true || navigator.userAgent.includes('Electron');
}

type ServerAuth = {
  checked: boolean;
  authenticated: boolean;
  hasSubscriptionToken: boolean;
};

export function LoginScreen() {
  const [inElectron, setInElectron] = useState(false);
  const [step, setStep] = useState<'idle' | 'f1tv-open' | 'finishing'>('idle');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverAuth, setServerAuth] = useState<ServerAuth>({
    checked: false,
    authenticated: false,
    hasSubscriptionToken: false,
  });
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const setError = useAppStore((s) => s.setError);
  const error = useAppStore((s) => s.error);

  const checkServerAuth = async () => {
    try {
      const status = await pitwallApi.authStatus();
      setServerAuth({
        checked: true,
        authenticated: status.authenticated,
        hasSubscriptionToken: status.hasSubscriptionToken,
      });
      return status.authenticated;
    } catch {
      setServerAuth({ checked: true, authenticated: false, hasSubscriptionToken: false });
      return false;
    }
  };

  useEffect(() => {
    setInElectron(detectElectron());
    const t = setTimeout(() => setInElectron(detectElectron()), 400);
    void checkServerAuth();
    return () => clearTimeout(t);
  }, []);

  // Auto-skip when the local server already has a valid session (browser path).
  useEffect(() => {
    if (!inElectron && serverAuth.checked && serverAuth.authenticated) {
      useAppStore.setState({ authenticated: true, tokens: null });
    }
  }, [inElectron, serverAuth.checked, serverAuth.authenticated]);

  const handleContinueInBrowser = async () => {
    setStep('finishing');
    setError(null);
    try {
      const ok = serverAuth.authenticated || (await checkServerAuth());
      if (!ok) {
        setError(
          'No active session on this server yet. Sign in once from the Mac app, then return here.',
        );
        setStep('idle');
        return;
      }
      useAppStore.setState({ authenticated: true, tokens: null });
    } catch (err) {
      setError(String(err).replace(/^Error: /, ''));
      setStep('idle');
    }
  };

  const handleOpenF1TV = async () => {
    if (!window.pitwall?.openF1TV) {
      setError('F1 TV sign-in only works inside the Mac app. See “First time on Mac?” below.');
      return;
    }
    setError(null);
    setStep('f1tv-open');
    await window.pitwall.openF1TV();
  };

  const handleFinishLogin = async () => {
    if (!window.pitwall?.finishF1TVLogin || !window.pitwall?.completeLogin) {
      setError('F1 TV sign-in only works inside the Mac app.');
      return;
    }
    setStep('finishing');
    setError(null);
    try {
      const session = await window.pitwall.finishF1TVLogin();
      const { tokens } = await window.pitwall.completeLogin({
        ...session,
        userId: 'default',
      });
      await pitwallApi.syncTokens(tokens);
      setAuthenticated(tokens);
    } catch (err) {
      const msg = String(err)
        .replace(/^Error: /, '')
        .replace(/^Error invoking remote method 'pitwall:f1tv-finish': /, '');
      setError(msg);
      setStep('f1tv-open');
    }
  };

  const handleDirectLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStep('finishing');
    setError(null);
    try {
      const { tokens } = await pitwallApi.login(email, password);
      setAuthenticated(tokens);
    } catch (err) {
      const msg = String(err);
      setError(
        msg.includes('403') || msg.includes('Interruption')
          ? 'Direct login is blocked by F1 TV. Use Open F1 TV in the Mac app instead.'
          : msg.replace(/^Error: /, ''),
      );
      setStep('idle');
    }
  };

  const canContinueInBrowser = serverAuth.authenticated;

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <aside className="auth-brand">
          <div className="auth-kicker">F1 TV command wall</div>
          <div className="auth-title-row">
            <BrandMark className="auth-mark" />
            <div>
              <h1>PitWall XR</h1>
              <span className="auth-subtitle">Mac app + browser</span>
            </div>
          </div>
          <p className="auth-tagline">
            Multi-feed race control for broadcast, onboard, tracker, timing, and replay context.
          </p>

          <div className="auth-preview" aria-hidden>
            <div className="auth-preview-main">
              <span>INTL</span>
            </div>
            <div className="auth-preview-side">
              <span>DATA</span>
              <span>TRACKER</span>
              <span>VER</span>
              <span>NOR</span>
            </div>
            <div className="auth-preview-rail">
              <span>01 VER</span>
              <span>02 NOR</span>
              <span>03 PIA</span>
              <span>04 RUS</span>
            </div>
          </div>

          <section className="auth-compare" aria-label="Mac app vs browser">
            <h3 className="auth-compare-title">What works where</h3>
            <dl className="auth-compare-grid">
              <div>
                <dt>Mac app only</dt>
                <dd>F1 TV sign-in, live DRM streams, full multi-feed pit wall</dd>
              </div>
              <div>
                <dt>Web browser</dt>
                <dd>Replay archive, UI, 3D track, spatial preview, Quest VR</dd>
              </div>
            </dl>
            <p className="auth-compare-note">
              Sign in once from the Mac app. After that, Safari, Chrome, and Quest can reuse the
              same local session.
            </p>
          </section>
        </aside>

        <section className="auth-panel">
          <header className="auth-panel-head">
            <span className="auth-eyebrow">
              {inElectron
                ? 'Mac app'
                : canContinueInBrowser
                  ? 'Server session found'
                  : 'Web browser'}
            </span>
            <h2>
              {inElectron
                ? 'Sign in with F1 TV'
                : canContinueInBrowser
                  ? 'Continue in browser'
                  : 'Connect to PitWall XR'}
            </h2>
            <p>
              {inElectron
                ? 'Use the official F1 TV window so cookies, subscription checks, and DRM stay on your Mac.'
                : canContinueInBrowser
                  ? 'This server already has your F1 TV session. Jump straight into replay and spatial mode.'
                  : 'You need the Mac app once to sign in. After that, the browser works for replay and spatial mode.'}
            </p>
          </header>

          {error && <div className="auth-alert">{error}</div>}

          {inElectron ? (
            <ol className="auth-steps">
              <li className={`auth-step${step === 'idle' ? ' active' : ' done'}`}>
                <span className="auth-step-index">1</span>
                <div className="auth-step-body">
                  <strong>Open F1 TV</strong>
                  <p>Sign in with your F1 TV account — Apple ID, 2FA, and all.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={handleOpenF1TV}
                  disabled={step === 'finishing'}
                >
                  Open F1 TV
                </button>
              </li>
              <li className={`auth-step${step !== 'idle' ? ' active' : ''}`}>
                <span className="auth-step-index">2</span>
                <div className="auth-step-body">
                  <strong>Import session</strong>
                  <p>When the F1 TV home screen loads, bring your session into PitWall XR.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block"
                  onClick={handleFinishLogin}
                  disabled={step === 'finishing'}
                >
                  {step === 'finishing' ? 'Connecting…' : 'Continue to Pit Wall'}
                </button>
              </li>
            </ol>
          ) : (
            <>
              {canContinueInBrowser ? (
                <div className="auth-browser-ready">
                  <p>
                    Session ready
                    {serverAuth.hasSubscriptionToken ? ' with subscription access' : ''}. Open{' '}
                    <a href={LOCAL_URL}>{LOCAL_URL.replace('https://', '')}</a> or{' '}
                    <a href={HOSTED_URL} target="_blank" rel="noreferrer">
                      f1.lukaah.com
                    </a>{' '}
                    on any device on this network.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-block"
                    onClick={handleContinueInBrowser}
                    disabled={step === 'finishing'}
                  >
                    {step === 'finishing' ? 'Connecting…' : 'Continue in browser'}
                  </button>
                </div>
              ) : (
                <div className="auth-browser-waiting">
                  <p>
                    No server session yet. Complete the Mac steps below, then click{' '}
                    <em>Check for server session</em>.
                  </p>
                </div>
              )}

              <section className="auth-first-time open" aria-label="First time on Mac">
                <h3 className="auth-first-time-title">First time on Mac?</h3>
                <p className="auth-first-time-lead">
                  The Mac app handles F1 TV sign-in and live DRM. Do this once — then the browser
                  works for replay and spatial mode.
                </p>

                <ol className="auth-mac-steps">
                  <li className="auth-mac-step">
                    <span className="auth-step-index">1</span>
                    <div className="auth-step-body">
                      <strong>Start PitWall XR</strong>
                      <p>Pick one:</p>
                      <ul className="auth-mac-options">
                        <li>
                          <strong>Desktop launcher</strong> — run{' '}
                          <code className="auth-code-inline">./scripts/install-desktop-launcher.sh</code>
                          , then double-click <code className="auth-code-inline">Start PitWall XR</code>{' '}
                          on your Desktop
                        </li>
                        <li>
                          <strong>Terminal</strong> — from the project folder:
                          <code className="auth-code-block">cd f1-pitwall-xr && pnpm install && pnpm start</code>
                        </li>
                      </ul>
                    </div>
                  </li>
                  <li className="auth-mac-step">
                    <span className="auth-step-index">2</span>
                    <div className="auth-step-body">
                      <strong>Sign in via F1 TV</strong>
                      <p>
                        In the Electron window: <em>Open F1 TV</em> → sign in →{' '}
                        <em>Continue to Pit Wall</em>.
                      </p>
                    </div>
                  </li>
                  <li className="auth-mac-step">
                    <span className="auth-step-index">3</span>
                    <div className="auth-step-body">
                      <strong>Return to this browser</strong>
                      <p>
                        Open{' '}
                        <a href={LOCAL_URL}>{LOCAL_URL.replace('https://', '')}</a> or{' '}
                        <a href={HOSTED_URL} target="_blank" rel="noreferrer">
                          f1.lukaah.com
                        </a>{' '}
                        and click <em>Continue in browser</em>.
                      </p>
                    </div>
                  </li>
                </ol>

                {!canContinueInBrowser && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-block auth-recheck"
                    onClick={() => void checkServerAuth()}
                    disabled={!serverAuth.checked && step === 'finishing'}
                  >
                    {serverAuth.checked ? 'Check for server session' : 'Checking…'}
                  </button>
                )}
              </section>
            </>
          )}

          <button type="button" className="auth-link" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide' : 'Show'} direct login (usually blocked)
          </button>

          {showAdvanced && (
            <form className="auth-advanced" onSubmit={handleDirectLogin}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button type="submit" className="btn btn-secondary btn-block" disabled={step === 'finishing'}>
                Try direct login
              </button>
            </form>
          )}

          <footer className="auth-footer">
            Unofficial fan project. Personal use only. Not affiliated with Formula One.
          </footer>
        </section>
      </div>
    </div>
  );
}
