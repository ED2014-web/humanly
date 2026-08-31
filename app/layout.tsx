import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HumainGPT — Des réponses humaines',
  description: 'Pose une question, partage une image et échange avec de vraies personnes.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>
}
