import Nav from './components/Nav';
import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column' }}>
      <Nav active="home" />
      
      <main style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'center', 
        alignItems: 'center', 
        padding: '60px 24px',
        textAlign: 'center',
        background: 'radial-gradient(circle at center, var(--bg-card) 0%, var(--bg-primary) 100%)'
      }}>
        
        <div style={{ maxWidth: '800px' }}>
          <div style={{ 
            display: 'inline-block', 
            padding: '8px 16px', 
            background: 'var(--cobalt-light)', 
            color: 'var(--cobalt)',
            borderRadius: '100px',
            fontSize: '0.85rem',
            fontWeight: 700,
            letterSpacing: '0.05em',
            marginBottom: '24px'
          }}>
            WELCOME TO THE FUTURE OF COMMERCE
          </div>
          
          <h1 style={{ 
            fontSize: 'clamp(3rem, 6vw, 5rem)', 
            fontWeight: 800, 
            letterSpacing: '-0.02em', 
            lineHeight: 1.1,
            marginBottom: '24px',
            background: 'linear-gradient(to right, #FFFFFF, #A0A0A0)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            The End of the Shopping Cart.
          </h1>
          
          <p style={{ 
            fontSize: '1.25rem', 
            color: 'var(--text-secondary)', 
            lineHeight: 1.6,
            marginBottom: '40px',
            maxWidth: '600px',
            margin: '0 auto 40px auto'
          }}>
            Nexus is an intelligent, dynamic pricing engine designed for B2C, B2B, and Agent-to-Agent (A2A) commerce. No static catalogs. No fixed prices. Just intelligent negotiation.
          </p>
          
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
            <Link href="/shop" style={{ textDecoration: 'none' }}>
              <button className="btn btn-primary btn-lg" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                Experience B2C Demo
              </button>
            </Link>
            <a href="https://github.com/nexus" target="_blank" style={{ textDecoration: 'none' }}>
              <button className="btn btn-secondary btn-lg" style={{ padding: '16px 32px', fontSize: '1.1rem' }}>
                View A2A Docs ↗
              </button>
            </a>
          </div>
        </div>

      </main>
    </div>
  );
}
