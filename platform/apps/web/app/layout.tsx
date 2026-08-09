import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { logoutAction } from './actions';

export const metadata: Metadata = {
  title: 'AI Engineering OS',
  description: 'AI-native product and engineering operating system',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
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
          <nav className="topnav" aria-label="Primary navigation">
            <Link href="/">Projects</Link>
            <Link href="/admin/access">People & Access</Link>
            <span className="muted-link">Engineering</span>
            <span className="muted-link">Review & QA</span>
            <form action={logoutAction}><button className="link-button" type="submit">Sign out</button></form>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
