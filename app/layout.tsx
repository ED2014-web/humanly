import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Réponses humaines',
  description: 'Posez une question, obtenez une réponse humaine.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>
}
