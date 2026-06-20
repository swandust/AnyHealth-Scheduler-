'use client'
import Link from 'next/link'

export default function HomePage() {
  return (
    <>
      <style>{`
        html, body { height: 100%; overflow: hidden; }
        .home-page { height: 100svh; display: flex; flex-direction: column; overflow: hidden; }
        .home-header { flex-shrink: 0; }
        .home-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          position: relative;
          overflow: hidden;
        }
        .home-card-wrap {
          width: 100%;
          max-width: 520px;
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .home-card {
          background: var(--surface-container-lowest);
          border: 1px solid var(--outline-variant);
          border-radius: 24px;
          padding: 40px 40px 48px;
          width: 100%;
          text-align: center;
          position: relative;
          box-shadow: 0px 20px 50px rgba(0,0,0,0.04);
          z-index: 30;
        }
        .home-card-title {
          font-family: 'Manrope', sans-serif;
          font-size: 26px;
          font-weight: 700;
          line-height: 1.3;
          letter-spacing: -0.02em;
          color: var(--on-surface);
          margin-bottom: 12px;
        }
        .home-card-sub {
          font-family: 'Manrope', sans-serif;
          font-size: 15px;
          line-height: 1.6;
          color: var(--on-surface-variant);
          margin-bottom: 36px;
          max-width: 380px;
        }
        .home-icon-wrap {
          width: 56px; height: 56px;
          background: rgba(66,188,145,0.15);
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
        }
        .home-stack-bg {
          position: absolute;
          width: 100%; height: 100%;
          background: var(--surface-container-lowest);
          border: 1px solid var(--outline-variant);
          border-radius: 24px;
        }
        .home-footer {
          flex-shrink: 0;
          padding: 14px 16px;
          background: var(--surface-container);
          border-top: 1px solid var(--outline-variant);
          text-align: center;
        }
        .home-trust-row {
          display: flex;
          gap: 40px;
          justify-content: center;
          margin-top: 20px;
          opacity: 0.4;
        }

        /* Mobile */
        @media (max-width: 600px) {
          html, body { overflow: hidden; }
          .home-card { padding: 28px 24px 40px; border-radius: 20px; }
          .home-card-title { font-size: 20px; }
          .home-card-sub { font-size: 14px; margin-bottom: 28px; }
          .home-icon-wrap { width: 48px; height: 48px; margin-bottom: 16px; }
          .home-header .logo-text { font-size: 22px !important; }
          .home-header .header-inner { padding: 14px 20px !important; }
          .home-trust-row { gap: 28px; margin-top: 16px; }
          .btn-primary { padding: 13px 28px !important; font-size: 15px !important; }
        }
      `}</style>

      <div className="home-page gradient-mesh">
        {/* Header */}
        <header className="home-header" style={{ background: 'var(--background)', zIndex: 50, boxShadow: 'none' }}>
          <div className="header-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 48px', maxWidth: 1440, margin: '0 auto', width: '100%' }}>
            <div className="logo-text" style={{ fontFamily: 'Manrope', fontSize: 28, fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em' }}>
              AnyHealth
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--on-surface-variant)', cursor: 'pointer', fontSize: 22 }}>help</span>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 24, fontVariationSettings: "'FILL' 1" }}>account_circle</span>
              </div>
            </div>
          </div>
        </header>

        {/* Main */}
        <main className="home-main">
          {/* Background glow */}
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, rgba(0,108,78,0.05) 0%, transparent 65%)', pointerEvents: 'none' }} />

          <div className="home-card-wrap">
            {/* Stack layers */}
            <div className="home-stack-bg" style={{ transform: 'translateY(20px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
            <div className="home-stack-bg" style={{ transform: 'translateY(10px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />

            {/* Main card */}
            <div className="home-card">
              <div className="home-icon-wrap">
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 30, fontVariationSettings: "'FILL' 1" }}>chat_bubble</span>
              </div>

              <h1 className="home-card-title">
                Hi there! Ready to turn WhatsApp Texts into Patient Bookings?
              </h1>
              <p className="home-card-sub" style={{ margin: '0 auto 36px' }}>
                Automate your clinic&apos;s scheduling with AnyHealth. We bridge the gap between patient conversations and your calendar.
              </p>

              <Link href="/book">
                <button className="btn-primary" style={{ borderRadius: 9999, padding: '14px 36px', fontSize: 16, fontWeight: 600 }}>
                  Let&apos;s Go
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                </button>
              </Link>

              {/* Decorative dots */}
              <div style={{ position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)' }} />
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--outline-variant)' }} />
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--outline-variant)' }} />
              </div>
            </div>
          </div>

          {/* Trust icons */}
          <div className="home-trust-row">
            {['medical_services', 'health_and_safety', 'clinical_notes', 'vaccines'].map(icon => (
              <span key={icon} className="material-symbols-outlined" style={{ fontSize: 28 }}>{icon}</span>
            ))}
          </div>
        </main>

        {/* Footer */}
        <footer className="home-footer">
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px 24px' }}>
            {['Privacy Policy', 'Terms of Service', 'Contact Support'].map(link => (
              <a key={link} href="#" style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--on-surface-variant)', textDecoration: 'none' }}>
                {link}
              </a>
            ))}
          </div>
          <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, color: 'var(--on-surface-variant)', marginTop: 6 }}>
            © 2026 AnyHealth. All rights reserved.
          </div>
        </footer>
      </div>
    </>
  )
}
