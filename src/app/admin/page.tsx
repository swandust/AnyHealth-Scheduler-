'use client'
import { useCallback, useEffect, useState } from 'react'

/**
 * Internal bookings list — the answer to "I have no idea what I missed".
 * Every booking is here whether or not the emails went out, with the status of
 * each step so a silent failure is visible instead of invisible.
 */

interface Booking {
  booking_ref: string
  status: string
  client_name: string
  client_email: string
  client_phone: string | null
  role: string | null
  challenges: string[]
  slot_date: string
  slot_time: string
  start_utc: string
  meet_url: string | null
  calendar_status: string
  client_email_status: string
  practitioner_email_status: string
  source: string
  created_at: string
}

interface HealthCheck {
  ok: boolean
  checks: Record<string, { configured: boolean; ok: boolean; detail?: string }>
}

const STORAGE_KEY = 'anyhealth_admin_token'

function Pill({ value }: { value: string }) {
  const tone: Record<string, [string, string]> = {
    confirmed: ['#e3f5ec', '#00563d'],
    sent: ['#e3f5ec', '#00563d'],
    ok: ['#e3f5ec', '#00563d'],
    pending: ['#fff4e0', '#7a4b00'],
    skipped: ['#eef0ef', '#4a524e'],
    failed: ['#fde8e6', '#8c1d18'],
    cancelled: ['#eef0ef', '#4a524e'],
  }
  const [bg, fg] = tone[value] ?? ['#eef0ef', '#4a524e']
  return (
    <span style={{
      display: 'inline-block', background: bg, color: fg, borderRadius: 999,
      padding: '2px 10px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{value}</span>
  )
}

export default function AdminPage() {
  const [token, setToken] = useState('')
  const [input, setInput] = useState('')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [health, setHealth] = useState<HealthCheck | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) { setToken(saved); setInput(saved) }
    } catch { /* private browsing */ }
  }, [])

  const load = useCallback(async (t: string) => {
    if (!t) return
    setLoading(true); setError('')
    try {
      const [bRes, hRes] = await Promise.all([
        fetch('/api/admin/bookings?limit=500', { headers: { Authorization: `Bearer ${t}` } }),
        fetch('/api/admin/health', { headers: { Authorization: `Bearer ${t}` } }),
      ])
      const bJson = await bRes.json()
      if (!bRes.ok) throw new Error(bJson.error || 'Could not load bookings')
      setBookings(bJson.bookings ?? [])
      setHealth(await hRes.json().catch(() => null))
      try { localStorage.setItem(STORAGE_KEY, t) } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setBookings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (token) load(token) }, [token, load])

  const cell: React.CSSProperties = {
    padding: '12px 10px', borderBottom: '1px solid var(--outline-variant)',
    fontSize: 13, verticalAlign: 'top',
  }
  const head: React.CSSProperties = {
    ...cell, fontWeight: 700, fontSize: 12, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'var(--on-surface-variant)', whiteSpace: 'nowrap',
  }

  if (!token) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{
          width: '100%', maxWidth: 420, background: 'var(--surface-container-lowest)',
          border: '1px solid var(--outline-variant)', borderRadius: 20, padding: 32,
        }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: 'var(--primary)' }}>
            AnyHealth bookings
          </h1>
          <p style={{ fontSize: 14, color: 'var(--on-surface-variant)', margin: '0 0 20px' }}>
            Paste the admin token (the <code>ADMIN_TOKEN</code> value from your environment).
          </p>
          <input
            type="password" value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') setToken(input.trim()) }}
            placeholder="Admin token"
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 12, fontSize: 15,
              border: '2px solid var(--outline-variant)', background: 'transparent',
              color: 'var(--on-surface)', marginBottom: 12,
            }}
          />
          <button
            onClick={() => setToken(input.trim())} disabled={!input.trim()}
            style={{
              width: '100%', padding: '12px 14px', borderRadius: 999, border: 'none',
              background: 'var(--primary)', color: 'var(--on-primary)', fontWeight: 700,
              fontSize: 15, cursor: input.trim() ? 'pointer' : 'not-allowed',
              opacity: input.trim() ? 1 : 0.5,
            }}
          >
            Open
          </button>
          {error && <p style={{ color: '#b3261e', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </main>
    )
  }

  return (
    <main style={{ padding: '32px 24px 80px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, color: 'var(--primary)' }}>Bookings</h1>
        <span style={{ fontSize: 14, color: 'var(--on-surface-variant)' }}>
          {loading ? 'Loading…' : `${bookings.length} record${bookings.length === 1 ? '' : 's'}`}
        </span>
        <button
          onClick={() => load(token)}
          style={{
            marginLeft: 'auto', padding: '8px 16px', borderRadius: 999, fontSize: 14,
            fontWeight: 600, cursor: 'pointer', background: 'transparent',
            border: '1px solid var(--outline-variant)', color: 'var(--on-surface)',
          }}
        >
          Refresh
        </button>
        <button
          onClick={() => { try { localStorage.removeItem(STORAGE_KEY) } catch {} ; setToken('') }}
          style={{
            padding: '8px 16px', borderRadius: 999, fontSize: 14, cursor: 'pointer',
            background: 'transparent', border: '1px solid var(--outline-variant)',
            color: 'var(--on-surface-variant)',
          }}
        >
          Sign out
        </button>
      </div>

      {health && (
        <div style={{
          display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24,
          padding: 16, borderRadius: 16, background: 'var(--surface-container-lowest)',
          border: '1px solid var(--outline-variant)',
        }}>
          {Object.entries(health.checks ?? {}).map(([name, c]) => (
            <div key={name} style={{ fontSize: 13, minWidth: 200 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                {c.ok ? '🟢' : c.configured ? '🔴' : '⚪️'} {name}
              </div>
              <div style={{ color: 'var(--on-surface-variant)' }}>{c.detail}</div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p style={{
          color: '#8c1d18', background: '#fde8e6', padding: '12px 16px',
          borderRadius: 12, fontSize: 14,
        }}>{error}</p>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead>
            <tr>
              <th style={head}>When</th>
              <th style={head}>Client</th>
              <th style={head}>Role</th>
              <th style={head}>Challenges</th>
              <th style={head}>Status</th>
              <th style={head}>Calendar</th>
              <th style={head}>Client mail</th>
              <th style={head}>Our mail</th>
              <th style={head}>Meet</th>
              <th style={head}>Ref</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.booking_ref}>
                <td style={cell}>
                  <strong>{b.slot_date}</strong><br />
                  <span style={{ color: 'var(--on-surface-variant)' }}>{b.slot_time}</span>
                </td>
                <td style={cell}>
                  <strong>{b.client_name}</strong><br />
                  <a href={`mailto:${b.client_email}`} style={{ color: 'var(--primary)' }}>{b.client_email}</a>
                  {b.client_phone && <><br /><span style={{ color: 'var(--on-surface-variant)' }}>{b.client_phone}</span></>}
                </td>
                <td style={cell}>{b.role ?? '—'}</td>
                <td style={{ ...cell, maxWidth: 260 }}>
                  {b.challenges?.length ? b.challenges.join(', ') : '—'}
                </td>
                <td style={cell}><Pill value={b.status} /></td>
                <td style={cell}><Pill value={b.calendar_status} /></td>
                <td style={cell}><Pill value={b.client_email_status} /></td>
                <td style={cell}><Pill value={b.practitioner_email_status} /></td>
                <td style={cell}>
                  {b.meet_url
                    ? <a href={b.meet_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Join</a>
                    : '—'}
                </td>
                <td style={{ ...cell, fontFamily: 'monospace', fontSize: 12, color: 'var(--on-surface-variant)' }}>
                  {b.booking_ref}
                  {b.source !== 'web' && <><br /><em>{b.source}</em></>}
                </td>
              </tr>
            ))}
            {!loading && bookings.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...cell, textAlign: 'center', padding: 48, color: 'var(--on-surface-variant)' }}>
                  No bookings yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}
