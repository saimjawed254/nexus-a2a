'use client';

import Link from 'next/link';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';

export default function Nav({ active, cartCount }: { active?: 'dashboard' | 'monitor' | 'shop' | 'home' | 'docs'; cartCount?: number }) {
  const { user, isLoaded } = useUser();
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.toLowerCase();
  const userEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  const isAdmin = !!(userEmail && adminEmail && userEmail === adminEmail);

  return (
    <nav className="nav" style={{ justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <Link href="/" className="nav-brand" style={{ textDecoration: 'none' }}>⚡ Nexus</Link>
        <Link href="/dashboard" className={`nav-link ${active === 'dashboard' ? 'active' : ''}`} style={{ display: isAdmin ? 'block' : 'none' }}>
          Merchant Dashboard
        </Link>
        <Link href="/monitor" className={`nav-link ${active === 'monitor' ? 'active' : ''}`} style={{ display: isAdmin ? 'block' : 'none' }}>
          Live Monitor
        </Link>
        {/* Cart badge on nav */}
        <Link href="/shop" className={`nav-link ${active === 'shop' ? 'active' : ''}`} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          Customer Shop
          {cartCount && cartCount > 0 ? (
            <span style={{ background: 'var(--cobalt)', color: 'white', borderRadius: '50%', width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700 }}>
              {cartCount > 9 ? '9+' : cartCount}
            </span>
          ) : null}
        </Link>
        <Link href="/docs" className={`nav-link ${active === 'docs' ? 'active' : ''}`}>
          Docs
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Razorpay Buildathon 2026
        </span>
        {!user && (
          <SignInButton mode="modal">
            <button className="btn btn-primary btn-sm">Sign In</button>
          </SignInButton>
        )}
        {user && (
          <UserButton />
        )}
      </div>
    </nav>
  );
}
