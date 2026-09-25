'use client'
import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function ConfirmedContent() {
  const params = useSearchParams()
  const name = params.get('name') || 'there'
  const date = params.get('date') || ''
  const time = params.get('time') || ''
  const meetUrl = params.get('meetUrl') || ''
  const bookingRef = params.get('ref') || ''
  const startIso = params.get('start') || (date && time ? `${date}T${time}:00` : '')

  // Derived from the value rather than a lookup table, so changing the slot
  // schedule on the server never leaves this page showing a raw "14:30".
  const fmtTime = (v: string) => {
    const [h, m] = v.split(':').map(Number)
    if (Number.isNaN(h) || Number.isNaN(m)) return v
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
  }

  const friendlyDate = date
    ? new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : ''

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ width: '100%', position: 'sticky', top: 0, background: 'var(--background)', zIndex: 50 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 64px', maxWidth: 1440, margin: '0 auto', width: '100%' }}>
          <div style={{ fontFamily: 'Manrope', fontSize: 32, fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em' }}>AnyHealth</div>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '48px 16px 96px', position: 'relative' }}>

        {/* Glow */}
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 640, height: 400,
          background: 'radial-gradient(circle, rgba(0,108,78,0.06) 0%, transparent 70%)',
          filter: 'blur(80px)', pointerEvents: 'none',
        }} />

        <div style={{ width: '100%', maxWidth: 640, position: 'relative', zIndex: 1 }}>

          {/* Card Stack */}
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-container-low)', border: '1px solid var(--outline-variant)', borderRadius: 24 }} className="card-stack-1" />
            <div style={{ position: 'absolute', inset: 0, background: 'var(--surface-container)', border: '1px solid var(--outline-variant)', borderRadius: 24 }} className="card-stack-2" />

            <div className="card-main" style={{
              position: 'relative',
              background: 'var(--surface-container-lowest)',
              border: '1px solid var(--outline-variant)',
              borderRadius: 24,
              padding: 40,
              textAlign: 'center',
            }}>

              {/* Checkmark */}
              <div style={{
                width: 80, height: 80,
                background: 'rgba(0,108,78,0.1)',
                borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 24px',
              }}>
                <span className="material-symbols-outlined material-symbols-filled" style={{ color: 'var(--primary)', fontSize: 48 }}>check_circle</span>
              </div>

              {/* Title */}
              <h1 style={{ fontFamily: 'Manrope', fontSize: 32, fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em', marginBottom: 8 }}>
                You&apos;re all set, {name}!
              </h1>
              <p style={{ fontFamily: 'Manrope', fontSize: 16, color: 'var(--on-surface-variant)', marginBottom: 40 }}>
                Your AnyHealth consultation is confirmed. Check your email for details.
              </p>

              {/* Appointment card */}
              <div style={{
                background: 'var(--surface-container-low)', borderRadius: 16,
                padding: '24px', marginBottom: 24, textAlign: 'left',
              }}>
                {[
                  { icon: 'calendar_today', label: 'Date', value: friendlyDate },
                  { icon: 'schedule', label: 'Time', value: fmtTime(time) },
                  { icon: 'timer', label: 'Duration', value: '30 minutes' },
                  { icon: 'videocam', label: 'Format', value: 'Google Meet video call' },
                ].map(row => (
                  <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--outline-variant)' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 20 }}>{row.icon}</span>
                    <div>
                      <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: 2 }}>
                        {row.label}
                      </div>
                      <div style={{ fontFamily: 'Manrope', fontSize: 16, fontWeight: 600, color: 'var(--on-surface)' }}>
                        {row.value}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Google Meet join button */}
              {meetUrl && (
                <a href={meetUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', textDecoration: 'none', marginBottom: 12 }}>
                  <button style={{
                    width: '100%', padding: '16px 24px',
                    background: 'var(--primary)', color: 'var(--on-primary)',
                    border: 'none', borderRadius: 12,
                    fontFamily: 'Manrope', fontSize: 16, fontWeight: 700,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                    transition: 'transform 0.15s, box-shadow 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,108,78,0.3)' }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 20 }}>videocam</span>
                    Join Google Meet
                  </button>
                </a>
              )}

              {/* Add to Calendar */}
              <a href={`/api/download-ics?${new URLSearchParams({ name, start: startIso, meet: meetUrl, ref: bookingRef })}`}
                style={{ display: 'block', textDecoration: 'none', marginBottom: 32 }}>
                <button style={{
                  width: '100%', padding: '14px 24px',
                  background: 'transparent', color: 'var(--primary)',
                  border: '2px solid var(--primary)', borderRadius: 12,
                  fontFamily: 'Manrope', fontSize: 15, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>calendar_add_on</span>
                  Add to Calendar (.ics)
                </button>
              </a>

              {/* What to expect */}
              <div style={{ textAlign: 'left', padding: 20, background: 'rgba(66,188,145,0.08)', borderRadius: 12, marginBottom: 24 }}>
                <p style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: 12 }}>
                  WHAT TO EXPECT
                </p>
                {[
                  'A friendly 30-minute demo call to understand your goals.',
                  'Find out how we can better support your patient outcomes.',
                  'Discuss plans and product lines for your company.',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 18, flexShrink: 0, marginTop: 1 }}>check</span>
                    <p style={{ fontFamily: 'Manrope', fontSize: 14, color: 'var(--on-surface-variant)', lineHeight: 1.5 }}>{item}</p>
                  </div>
                ))}
              </div>

              <p style={{ fontFamily: 'Manrope', fontSize: 13, color: 'var(--secondary)', marginBottom: 8 }}>
                📧 A confirmation email and a Google Calendar invite are on their way to you.
              </p>
              {bookingRef && (
                <p style={{ fontFamily: 'IBM Plex Sans', fontSize: 12, color: 'var(--on-surface-variant)', marginBottom: 24 }}>
                  Booking reference <strong>{bookingRef}</strong>
                </p>
              )}

              <Link href="/" style={{ color: 'var(--primary)', fontFamily: 'Manrope', fontSize: 14, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>home</span>
                Back to Home
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ width: '100%', padding: '32px 16px', background: 'var(--surface-container)', borderTop: '1px solid var(--outline-variant)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--secondary)' }}>AnyHealth</div>
          <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 12, color: 'var(--on-surface-variant)' }}>© 2026 AnyHealth. All rights reserved.</div>
        </div>
      </footer>
    </div>
  )
}

export default function ConfirmedPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>}>
      <ConfirmedContent />
    </Suspense>
  )
}
