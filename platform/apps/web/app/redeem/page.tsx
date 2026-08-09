import Link from 'next/link';
import { redeemInvitationAction } from '../actions';

export const dynamic = 'force-dynamic';

export default function RedeemInvitationPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">One-time invitation</span>
        <h1>Create your account</h1>
        <p className="lead">
          Enter the invitation key you received. The key can be used once and becomes invalid after its configured expiry time.
        </p>
        <form action={redeemInvitationAction} className="form-grid">
          <div className="field">
            <label htmlFor="key">Invitation key</label>
            <input className="input input-mono" id="key" name="key" autoComplete="off" required />
          </div>
          <div className="field">
            <label htmlFor="userId">Choose a User ID</label>
            <input className="input" id="userId" name="userId" autoComplete="username" minLength={3} required />
            <small>3–64 characters. Letters, numbers, dots, underscores and hyphens are allowed.</small>
          </div>
          <div className="field">
            <label htmlFor="password">Choose a password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
          </div>
          <button className="button" type="submit">Create account</button>
        </form>
        <p className="auth-help">Already registered? <Link href="/login">Sign in</Link>.</p>
      </section>
    </main>
  );
}
