import Link from 'next/link';
import { loginAction } from '../actions';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <span className="eyebrow">Secure access</span>
        <h1>Sign in to AI Engineering OS</h1>
        <p className="lead">Use the User ID and password you created when redeeming your invitation.</p>
        <form action={loginAction} className="form-grid">
          <div className="field">
            <label htmlFor="userId">User ID</label>
            <input className="input" id="userId" name="userId" autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={12} required />
          </div>
          <button className="button" type="submit">Sign in</button>
        </form>
        <p className="auth-help">Have a one-time invitation key? <Link href="/redeem">Create your account</Link>.</p>
      </section>
    </main>
  );
}
