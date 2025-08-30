import './globals.css'
import type { Metadata } from 'next'
import { Toaster } from 'react-hot-toast'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'AIVoiceCaller',
  description: 'Speech-to-speech AI calling powered by OpenAI Realtime and Twilio',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} min-h-screen bg-gradient-to-b from-neutral-950 to-black font-sans`}>
        <Toaster position="top-right" />
        {children}
      </body>
    </html>
  )
}
