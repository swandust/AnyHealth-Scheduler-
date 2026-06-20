'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

/* ─── Data ─────────────────────────────────────────────────────────────────── */
interface BookingState {
  role: string; challenges: string[]; date: string; time: string
  name: string; email: string; phone: string
}

const TIME_SLOTS = [
  { label: '8:00 AM', value: '08:00' }, { label: '8:45 AM', value: '08:45' },
  { label: '9:30 AM', value: '09:30' }, { label: '10:15 AM', value: '10:15' },
  { label: '11:00 AM', value: '11:00' },
  { label: '2:00 PM', value: '14:00' }, { label: '2:45 PM', value: '14:45' },
  { label: '3:30 PM', value: '15:30' }, { label: '4:15 PM', value: '16:15' },
  { label: '5:00 PM', value: '17:00' },
  { label: '9:00 PM', value: '21:00' }, { label: '9:45 PM', value: '21:45' },
  { label: '10:30 PM', value: '22:30' }, { label: '11:15 PM', value: '23:15' },
]

const ROLES = [
  'GP', 'Dentist', 'Specialist', 'Pharmacist',
  'Aesthetician', 'Physician', 'Therapist', 'Ambulance Crew',
  'HealthTech Enthusiast!',
]

const CHALLENGES = [
  'Frontdesk missing messages',
  'Manual logging of patient bookings',
  'No visibility on Social Media Leads',
  'Manual reminder system',
  'Hard-to-use or No CMS system',
  'High No-show Rate',
  'Unsatisfactory WhatsApp automation',
]

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

/* ─── Progress Bar ──────────────────────────────────────────────────────────── */
function ProgressBar({ step, total }: { step: number; total: number }) {
  const labels = ['WELCOME','YOUR ROLE','CHALLENGES','SCHEDULE','CONTACT']
  const pct = Math.round((step / total) * 100)
  return (
    <div style={{ marginBottom: 20, flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--primary)' }}>
          Step {step} of {total}: {labels[step - 1]}
        </span>
        <span style={{ fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--secondary)' }}>
          {pct}%
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, height: 5 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{ flex: 1, borderRadius: 99, background: 'var(--surface-container)', overflow: 'hidden' }}>
            {i < step && (
              <div style={{
                height: '100%', borderRadius: 99,
                background: i === 0 ? '#FF7E5F' : i === 1 ? 'linear-gradient(to right,#FF7E5F,#D26EB3)' : i === 2 ? 'linear-gradient(to right,#D26EB3,#A55EE7)' : i === 3 ? 'linear-gradient(to right,#A55EE7,#8E44AD)' : '#8E44AD'
              }} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── Calendar ───────────────────────────────────────────────────────────────  */
function CalendarPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = new Date()
  const [vy, setVy] = useState(today.getFullYear())
  const [vm, setVm] = useState(today.getMonth())
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const firstDay = new Date(vy, vm, 1).getDay()
  const daysInMonth = new Date(vy, vm + 1, 0).getDate()
  const daysInPrev = new Date(vy, vm, 0).getDate()

  const cells: { day: number; own: boolean; date: string }[] = []
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrev - i, pm = vm === 0 ? 11 : vm - 1, py = vm === 0 ? vy - 1 : vy
    cells.push({ day: d, own: false, date: `${py}-${String(pm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` })
  }
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ day: d, own: true, date: `${vy}-${String(vm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` })
  while (cells.length < 35) {
    const d = cells.length - firstDay - daysInMonth + 1
    const nm = vm === 11 ? 0 : vm + 1, ny = vm === 11 ? vy + 1 : vy
    cells.push({ day: d, own: false, date: `${ny}-${String(nm+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` })
  }

  const prev = () => vm === 0 ? (setVm(11), setVy(y => y-1)) : setVm(m => m-1)
  const next = () => vm === 11 ? (setVm(0), setVy(y => y+1)) : setVm(m => m+1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--on-surface)' }}>{MONTHS[vm]} {vy}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {([] as Array<[string, () => void]>).concat([['chevron_left', prev], ['chevron_right', next]]).map(([icon, fn]) => (
            <button key={icon} onClick={fn}
              style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--on-surface-variant)' }}>{icon}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', textAlign: 'center', marginBottom: 4 }}>
        {['S','M','T','W','T','F','S'].map((d,i) => (
          <div key={i} style={{ fontFamily: 'IBM Plex Sans', fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', color: 'var(--secondary)', padding: '3px 0' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1 }}>
        {cells.map((cell, i) => {
          const dow = new Date(cell.date + 'T00:00:00').getDay()
          const disabled = !cell.own || cell.date < todayStr || dow === 0
          const sel = cell.date === value
          const isToday = cell.date === todayStr
          return (
            <div key={i} onClick={() => !disabled && onChange(cell.date)}
              style={{
                height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, borderRadius: 6, cursor: disabled ? 'default' : 'pointer',
                opacity: !cell.own ? 0.2 : disabled ? 0.35 : 1,
                background: sel ? 'var(--primary)' : 'transparent',
                color: sel ? 'white' : isToday && !sel ? 'var(--primary)' : 'var(--on-surface)',
                fontWeight: sel || isToday ? 700 : 400,
                border: isToday && !sel ? '1.5px solid var(--primary)' : 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!disabled && !sel) e.currentTarget.style.background = 'var(--surface-container)' }}
              onMouseLeave={e => { if (!sel) e.currentTarget.style.background = 'transparent' }}
            >
              {cell.day}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Main Component ─────────────────────────────────────────────────────────  */
export default function BookPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [state, setState] = useState<BookingState>({ role:'', challenges:[], date:'', time:'', name:'', email:'', phone:'' })

  const set = useCallback((u: Partial<BookingState>) => setState(p => ({ ...p, ...u })), [])
  const toggleC = useCallback((c: string) => setState(p => ({
    ...p, challenges: p.challenges.includes(c) ? p.challenges.filter(x=>x!==c) : [...p.challenges, c]
  })), [])

  const handleSubmit = async () => {
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientName: state.name, clientEmail: state.email, clientPhone: state.phone, goal: state.role, challenges: state.challenges, date: state.date, time: state.time }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Booking failed')
      router.push('/confirmed?' + new URLSearchParams({ name: state.name, date: state.date, time: state.time, zoomUrl: data.zoomJoinUrl || '', bookingId: data.bookingId || '' }))
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    finally { setSubmitting(false) }
  }

  const fmtDate = (d: string) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) : ''
  const fmtSlot = (v: string) => TIME_SLOTS.find(s=>s.value===v)?.label || v

  const cardStyle: React.CSSProperties = {
    position: 'relative', background: 'var(--surface-container-lowest)',
    border: '1px solid var(--outline-variant)', borderRadius: 20,
    padding: 0, zIndex: 30,
    boxShadow: '0px 20px 50px rgba(0,0,0,0.04)',
    display: 'flex', flexDirection: 'column',
    maxHeight: '100%', overflow: 'hidden',
  }

  const scrollBody: React.CSSProperties = {
    overflowY: 'auto', flex: 1,
    padding: '20px 24px 0',
  }

  const navBar: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '16px 24px', borderTop: '1px solid var(--outline-variant)',
    flexShrink: 0,
  }

  return (
    <>
      <style>{`
        html, body { height: 100%; overflow: hidden; }
        .book-page { height: 100svh; display: flex; flex-direction: column; overflow: hidden; }
        .book-header { flex-shrink: 0; }
        .book-main {
          flex: 1; min-height: 0;
          display: flex; flex-direction: column; align-items: center;
          padding: 20px 16px 16px; overflow: hidden; position: relative;
        }
        .book-inner { width: 100%; max-width: 600px; display: flex; flex-direction: column; min-height: 0; flex: 1; }
        .card-wrap { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
        .card-bg { position: absolute; width: 100%; height: 100%; background: var(--surface-container-low); border: 1px solid var(--outline-variant); border-radius: 20px; }
        .card-bg2 { position: absolute; width: 100%; height: 100%; background: var(--surface-container); border: 1px solid var(--outline-variant); border-radius: 20px; }
        .radio-tile { display: flex; align-items: center; padding: 11px 14px; border: 1.5px solid var(--outline-variant); border-radius: 10px; cursor: pointer; transition: all 0.15s; background: white; }
        .radio-tile:hover { border-color: var(--primary); }
        .radio-tile.sel { border-color: var(--primary); background: rgba(0,108,78,0.04); box-shadow: 0 0 0 2px rgba(0,108,78,0.1); }
        .radio-dot { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--outline-variant); margin-right: 10px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .radio-tile.sel .radio-dot { border-color: var(--primary); background: var(--primary); }
        .radio-inner { width: 6px; height: 6px; background: white; border-radius: 50%; display: none; }
        .radio-tile.sel .radio-inner { display: block; }
        .pain-item { display: flex; align-items: center; justify-content: space-between; padding: 13px 14px; border: 1px solid var(--outline-variant); border-radius: 10px; cursor: pointer; transition: all 0.2s; background: white; }
        .pain-item:hover:not(.sel) { background: var(--surface-variant); }
        .pain-item.sel { background: var(--primary); color: white; border-color: transparent; box-shadow: 0 4px 14px rgba(0,108,78,0.25); }
        .time-btn { width: 100%; text-align: left; padding: 11px 12px; border-radius: 10px; border: 1.5px solid var(--outline-variant); background: white; cursor: pointer; transition: all 0.15s; display: flex; justify-content: space-between; align-items: center; }
        .time-btn:hover:not(.sel) { border-color: var(--primary); background: rgba(0,108,78,0.03); }
        .time-btn.sel { border-color: var(--primary); background: rgba(0,108,78,0.05); box-shadow: 0 0 0 2px rgba(0,108,78,0.15); }
        .form-input { width: 100%; background: var(--surface-container-low); border: none; border-bottom: 2px solid var(--outline-variant); padding: 10px 4px; font-family: 'Manrope',sans-serif; font-size: 16px; color: var(--on-surface); outline: none; transition: border-color 0.15s; }
        .form-input:focus { border-bottom-color: var(--primary); }
        .form-input::placeholder { color: rgba(109,122,115,0.5); }
        .btn-p { background: #1c1b1b; color: white; border: 2px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 12px 28px; font-family: 'Manrope',sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: transform 0.15s, box-shadow 0.15s; }
        .btn-p:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.2); }
        .btn-p:disabled { opacity: 0.45; cursor: not-allowed; }
        .btn-ghost { background: transparent; border: none; color: var(--secondary); font-family: 'IBM Plex Sans',sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 8px 0; }
        .btn-ghost:hover { color: var(--on-surface); }
        .scrollable { overflow-y: auto; }
        .scrollable::-webkit-scrollbar { width: 5px; }
        .scrollable::-webkit-scrollbar-thumb { background: var(--outline-variant); border-radius: 99px; }

        @media (max-width: 600px) {
          .book-main { padding: 12px 12px 10px; }
          .radio-tile { padding: 10px 12px; }
          .pain-item { padding: 11px 12px; }
          .book-header .header-inner { padding: 12px 16px !important; }
          .sched-grid { grid-template-columns: 1fr !important; gap: 16px !important; }
          .time-panel { max-height: 180px !important; }
        }
      `}</style>

      <div className="book-page gradient-mesh">
        {/* Header */}
        <header className="book-header" style={{ background: 'var(--background)', zIndex: 50, flexShrink: 0 }}>
          <div className="header-inner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 48px', maxWidth: 1440, margin: '0 auto' }}>
            <div style={{ fontFamily: 'Manrope', fontSize: 24, fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em' }}>AnyHealth</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--on-surface-variant)', cursor: 'pointer', fontSize: 20 }}>help</span>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-container-high)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 22, fontVariationSettings: "'FILL' 1" }}>account_circle</span>
              </div>
            </div>
          </div>
        </header>

        <main className="book-main">
          <div className="book-inner">
            <ProgressBar step={step} total={5} />

            {/* ── STEP 1: Role ── */}
            {step === 1 && (
              <div className="card-wrap">
                <div className="card-bg" style={{ transform: 'translateY(18px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
                <div className="card-bg2" style={{ transform: 'translateY(9px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />
                <div style={cardStyle}>
                  <div className="scrollable" style={scrollBody}>
                    <h1 style={{ fontFamily: 'Manrope', fontSize: 18, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 4, lineHeight: 1.3 }}>Help us understand what you need:</h1>
                    <p style={{ fontFamily: 'Manrope', fontSize: 13, color: 'var(--on-surface-variant)', marginBottom: 16 }}>We&apos;ll tailor your experience based on your background.</p>
                    <p style={{ fontFamily: 'Manrope', fontSize: 15, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 12 }}>I am a...</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingBottom: 16 }}>
                      {ROLES.map(r => (
                        <div key={r} className={`radio-tile${state.role===r?' sel':''}`}
                          style={r==='HealthTech Enthusiast!'?{gridColumn:'1/-1'}:{}}
                          onClick={() => set({ role: r })}>
                          <div className="radio-dot"><div className="radio-inner" /></div>
                          <span style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 600, color: state.role===r?'inherit':'var(--on-surface)' }}>{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={navBar}>
                    <div />
                    <button className="btn-p" onClick={() => state.role && setStep(2)} disabled={!state.role}>
                      Next <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 2: Challenges ── */}
            {step === 2 && (
              <div className="card-wrap">
                <div className="card-bg" style={{ transform: 'translateY(18px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
                <div className="card-bg2" style={{ transform: 'translateY(9px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />
                <div style={cardStyle}>
                  <div className="scrollable" style={scrollBody}>
                    <h1 style={{ fontFamily: 'Manrope', fontSize: 18, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 4 }}>Tap what relates to you</h1>
                    <p style={{ fontFamily: 'Manrope', fontSize: 13, color: 'var(--on-surface-variant)', marginBottom: 16 }}>Select all that apply.</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16 }}>
                      {CHALLENGES.map(c => (
                        <div key={c} className={`pain-item${state.challenges.includes(c)?' sel':''}`} onClick={() => toggleC(c)}>
                          <span style={{ fontFamily: 'Manrope', fontSize: 13 }}>{c}</span>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, opacity: state.challenges.includes(c) ? 1 : 0.2, color: state.challenges.includes(c) ? 'white' : 'inherit', fontVariationSettings: state.challenges.includes(c) ? "'FILL' 1" : "'FILL' 0" }}>check_circle</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={navBar}>
                    <button className="btn-ghost" onClick={() => setStep(1)}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span> Back</button>
                    <button className="btn-p" onClick={() => state.challenges.length > 0 && setStep(3)} disabled={state.challenges.length === 0}>
                      Next <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 3: Schedule ── */}
            {step === 3 && (
              <div className="card-wrap">
                <div className="card-bg" style={{ transform: 'translateY(18px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
                <div className="card-bg2" style={{ transform: 'translateY(9px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />
                <div style={cardStyle}>
                  <div style={{ ...scrollBody, overflowY: 'auto' }}>
                    <h1 style={{ fontFamily: 'Manrope', fontSize: 16, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 16, lineHeight: 1.4 }}>
                      Pick a date and time that works for you.
                    </h1>
                    <div className="sched-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, paddingBottom: 16 }}>
                      {/* Calendar */}
                      <div>
                        <CalendarPicker value={state.date} onChange={d => set({ date: d, time: '' })} />
                        {/* Provider */}
                        <div style={{ marginTop: 14, padding: '10px 12px', background: 'var(--surface-container-low)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'linear-gradient(135deg,#42bc91,#006c4e)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span className="material-symbols-outlined" style={{ color: 'white', fontSize: 20, fontVariationSettings: "'FILL' 1" }}>person</span>
                          </div>
                          <div>
                            <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>Consultation with</div>
                            <div style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>AnyHealth Specialist</div>
                          </div>
                        </div>
                      </div>
                      {/* Time slots */}
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ marginBottom: 10 }}>
                          <p style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 700, color: 'var(--on-surface)' }}>Available Times</p>
                          <p style={{ fontFamily: 'Manrope', fontSize: 11, color: 'var(--secondary)' }}>{state.date ? fmtDate(state.date) : 'Select a date'}</p>
                        </div>
                        {state.date ? (
                          <div className="time-panel scrollable" style={{ flex: 1, maxHeight: 220, display: 'flex', flexDirection: 'column', gap: 5, paddingRight: 4 }}>
                            {[
                              { label: 'Morning', slots: TIME_SLOTS.filter(s => parseInt(s.value) < 12) },
                              { label: 'Afternoon', slots: TIME_SLOTS.filter(s => parseInt(s.value) >= 12 && parseInt(s.value) < 18) },
                              { label: 'Evening', slots: TIME_SLOTS.filter(s => parseInt(s.value) >= 18) },
                            ].map(({ label, slots }) => (
                              <div key={label}>
                                <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: 5, marginTop: 6 }}>{label}</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {slots.map(s => (
                                    <button key={s.value} className={`time-btn${state.time===s.value?' sel':''}`} onClick={() => set({ time: s.value })}>
                                      <span style={{ fontFamily: 'Manrope', fontSize: 12, fontWeight: 700, color: state.time===s.value?'var(--primary)':'var(--on-surface)' }}>{s.label}</span>
                                      {state.time===s.value
                                        ? <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--primary)', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                                        : <span style={{ fontSize: 10, color: 'var(--secondary)', fontFamily: 'IBM Plex Sans' }}>30 min</span>}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--outline)', textAlign: 'center' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 32, marginBottom: 6 }}>calendar_today</span>
                            <p style={{ fontFamily: 'Manrope', fontSize: 12 }}>Select a date</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={navBar}>
                    <button className="btn-ghost" onClick={() => setStep(2)}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span> Back</button>
                    <button className="btn-p" onClick={() => setStep(4)} disabled={!state.date || !state.time}>
                      Next <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 4: Contact ── */}
            {step === 4 && (
              <div className="card-wrap">
                <div className="card-bg" style={{ transform: 'translateY(18px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
                <div className="card-bg2" style={{ transform: 'translateY(9px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />
                <div style={cardStyle}>
                  <div className="scrollable" style={scrollBody}>
                    <div style={{ textAlign: 'center', marginBottom: 24 }}>
                      <h1 style={{ fontFamily: 'Manrope', fontSize: 18, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 6 }}>
                        Thanks! Could you leave a name and email?
                      </h1>
                      <p style={{ fontFamily: 'Manrope', fontSize: 13, color: 'var(--on-surface-variant)' }}>We&apos;ll use this to confirm your upcoming consultation.</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 16 }}>
                      {[
                        { id: 'name', label: 'Full Name *', type: 'text', placeholder: 'John Doe', required: true },
                        { id: 'email', label: 'Email Address *', type: 'email', placeholder: 'john@example.com', required: true },
                        { id: 'phone', label: 'Phone Number (Optional)', type: 'tel', placeholder: '+60 12 345 6789', required: false },
                      ].map(f => (
                        <div key={f.id}>
                          <label style={{ display: 'block', fontFamily: 'IBM Plex Sans', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--on-surface-variant)', marginBottom: 8, marginLeft: 4 }}>{f.label}</label>
                          <input className="form-input" id={f.id} type={f.type} placeholder={f.placeholder}
                            value={state[f.id as keyof BookingState] as string}
                            onChange={e => set({ [f.id]: e.target.value })} />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={navBar}>
                    <button className="btn-ghost" onClick={() => setStep(3)}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span> Back</button>
                    <button className="btn-p" onClick={() => state.name && state.email && setStep(5)} disabled={!state.name || !state.email}>
                      Next <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── STEP 5: Confirm ── */}
            {step === 5 && (
              <div className="card-wrap">
                <div className="card-bg" style={{ transform: 'translateY(18px) scale(0.92)', zIndex: 10, opacity: 0.4 }} />
                <div className="card-bg2" style={{ transform: 'translateY(9px) scale(0.96)', zIndex: 20, opacity: 0.7 }} />
                <div style={cardStyle}>
                  <div className="scrollable" style={scrollBody}>
                    <h1 style={{ fontFamily: 'Manrope', fontSize: 18, fontWeight: 600, color: 'var(--on-surface)', marginBottom: 4 }}>Review your booking</h1>
                    <p style={{ fontFamily: 'Manrope', fontSize: 13, color: 'var(--on-surface-variant)', marginBottom: 16 }}>Everything looks good? Hit confirm!</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 16 }}>
                      {[
                        { icon: 'person', label: 'Name', value: state.name },
                        { icon: 'mail', label: 'Email', value: state.email },
                        ...(state.phone ? [{ icon: 'phone', label: 'Phone', value: state.phone }] : []),
                        { icon: 'badge', label: 'Role', value: state.role },
                        { icon: 'calendar_today', label: 'Date', value: fmtDate(state.date) },
                        { icon: 'schedule', label: 'Time', value: fmtSlot(state.time) },
                        { icon: 'videocam', label: 'Format', value: 'Zoom · 30 min' },
                      ].map(r => (
                        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--outline-variant)' }}>
                          <span className="material-symbols-outlined" style={{ color: 'var(--primary)', fontSize: 18 }}>{r.icon}</span>
                          <div>
                            <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)' }}>{r.label}</div>
                            <div style={{ fontFamily: 'Manrope', fontSize: 13, fontWeight: 600, color: 'var(--on-surface)' }}>{r.value}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {state.challenges.length > 0 && (
                      <div style={{ padding: '10px 12px', background: 'var(--surface-container-low)', borderRadius: 10, marginBottom: 12 }}>
                        <div style={{ fontFamily: 'IBM Plex Sans', fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--secondary)', marginBottom: 6 }}>Challenges</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {state.challenges.map(c => (
                            <span key={c} style={{ background: 'var(--secondary-container)', color: 'var(--on-primary-container)', borderRadius: 99, padding: '3px 8px', fontSize: 11, fontWeight: 600 }}>{c}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {error && (
                      <div style={{ padding: 12, background: '#ffdad6', borderRadius: 10, color: '#ba1a1a', fontSize: 13, marginBottom: 8 }}>
                        <strong>Error:</strong> {error}
                      </div>
                    )}
                    <div style={{ paddingBottom: 16 }} />
                  </div>
                  <div style={navBar}>
                    <button className="btn-ghost" onClick={() => setStep(4)}><span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span> Back</button>
                    <button className="btn-p" onClick={handleSubmit} disabled={submitting} style={{ borderRadius: 10 }}>
                      {submitting ? 'Booking...' : 'Confirm Booking'}
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>event_available</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  )
}
