import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore';
import { pitwallApi } from '../lib/api';
import { BrandMark } from './BrandMark';

function detectElectron(): boolean {
  if (typeof window === 'undefined') return false;
  return window.pitwall?.isElectron === true || navigator.userAgent.includes('Electron');
}

export function LoginScreen() {
  const [inElectron, setInElectron] = useState(false);
  const [step, setStep] = useState<'idle' | 'f1tv-open' | 'finishing'>('idle');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const setAuthenticated = useAppStore((s) => s.setAuthenticated);
  const setError = useAppStore((s) => s.setError);
  const error = useAppStore((s) => s.error);

  useEffect(() => {
    setInElectron(detectElectron());
    const t = setTimeout(() => setInElectron(detectElectron()), 400);
    return () => clearTimeout(t);
  }, []);

  const handleOpenF1TV = async () => {
    if (!window.pitwall?.openF1TV) {
      setError('Launch PitWall XR from the desktop app — double-click scripts/start-pitwall.command');
      return;
    }
    setError(null);
    setStep('f1tv-open');
    await window.pitwall.openF1TV();
  };

  const handleFinishLogin = async () => {
    if (!window.pitwall?.finishF1TVLogin || !window.pitwall?.completeLogin) {
      setError('Desktop app required. Double-click scripts/start-pitwall.command in Finder.');
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
      const msg = String(err).replace(/^Error: /, '').replace(/^Error invoking remote method 'pitwall:f1tv-finish': /, '');
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
          ? 'Direct login is blocked by F1 TV. Use Open F1 TV instead.'
          : msg.replace(/^Error: /, ''),
      );
      setStep('idle');
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <aside className="auth-brand">
          <div className="auth-kicker">F1 TV command wall</div>
          <div className="auth-title-row">
            <BrandMark className="auth-mark" />
            <div>
              <h1>PitWall XR</h1>
              <span className="auth-subtitle">Desktop now. Spatial next.</span>
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
          {!inElectron && (
            <div className="auth-notice">
              <strong>Desktop app for sign-in</strong>
              <span>Launch PitWall XR from the Desktop shortcut or run <code>pnpm start</code> in the project folder.</span>
              <span>After auth, the web UI works at localhost or your hosted URL (see docs/web-hosting.md).</span>
            </div>
          )}
        </aside>

        <section className="auth-panel">
          <header className="auth-panel-head">
            <span className="auth-eyebrow">{inElectron ? 'Desktop app ready' : 'Desktop app required'}</span>
            <h2>Connect your F1 TV session</h2>
            <p>Use the official sign-in window so cookies, subscription checks, and DRM stay inside the local app.</p>
          </header>

          {error && <div className="auth-alert">{error}</div>}

          {inElectron ? (
            <ol className="auth-steps">
              <li className={`auth-step${step === 'idle' ? ' active' : ' done'}`}>
                <span className="auth-step-index">01</span>
                <div className="auth-step-body">
                  <strong>Open F1 TV</strong>
                  <p>Use your normal F1 TV account, including Apple-linked login or security checks.</p>
                </div>
                <button type="button" className="btn btn-primary btn-block" onClick={handleOpenF1TV} disabled={step === 'finishing'}>
                  Open F1 TV
                </button>
              </li>
              <li className={`auth-step${step !== 'idle' ? ' active' : ''}`}>
                <span className="auth-step-index">02</span>
                <div className="auth-step-body">
                  <strong>Import session</strong>
                  <p>When the F1 TV home screen loads, continue into PitWall XR.</p>
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
            <div className="auth-blocked">
              <strong>Open the Mac app</strong>
              <p>DRM playback and F1 TV login require the local Electron app, not Safari or Chrome.</p>
            </div>
          )}

          <button type="button" className="auth-link" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide' : 'Show'} direct login (usually blocked)
          </button>

          {showAdvanced && (
            <form className="auth-advanced" onSubmit={handleDirectLogin}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
              <label htmlFor="password">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
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
