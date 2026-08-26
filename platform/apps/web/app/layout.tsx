import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import './globals.css';
import { logoutAction } from './actions';
import { SESSION_COOKIE } from '../lib/api';

export const metadata: Metadata = {
  title: 'AI Engineering OS',
  description: 'AI-native product and engineering operating system',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const authenticated = Boolean(cookieStore.get(SESSION_COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="brand" href="/">
            <span className="brand-mark">AO</span>
            <span>
              <strong>AI Engineering OS</strong>
              <small>Product Studio</small>
            </span>
          </Link>
          {authenticated ? (
            <nav className="topnav" aria-label="Primary navigation">
              <Link href="/">Projects</Link>
              <Link href="/admin/access">People & Access</Link>
              <span className="muted-link">Engineering</span>
              <span className="muted-link">Review & QA</span>
              <form action={logoutAction}><button className="link-button" type="submit">Sign out</button></form>
            </nav>
          ) : null}
        </header>
        {children}
      </body>
    </html>
  );
}
