import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AnyHealth Smart Intake Scheduler',
  description: 'Book your free AnyHealth consultation — we bridge the gap between patient conversations and your calendar.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="gradient-mesh">
        {children}
      </body>
    </html>
  )
}
