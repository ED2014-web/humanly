'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'

type Mode = 'ask' | 'answer'
type Question = { id: number; author: string; text: string; time: string; image?: string; claimedBy?: string }

const starterQuestions: Question[] = [
  { id: 1, author: 'Camille', text: 'Quel est le meilleur conseil que tu aies reçu pour commencer un nouveau projet ?', time: 'il y a 2 min' },
  { id: 2, author: 'Noah', text: 'Je visite Lyon ce week-end : quel endroit calme et local me recommandez-vous ?', time: 'il y a 5 min' },
  { id: 3, author: 'Sarah', text: 'Comment retrouver la motivation quand on a l’impression de stagner ?', time: 'il y a 8 min' },
]

export default function Home() {
  const [mode, setMode] = useState<Mode>('ask')
  const [questions, setQuestions] = useState(starterQuestions)
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const [user, setUser] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [image, setImage] = useState<string>()
  const [claimedId, setClaimedId] = useState<number>()
  const [seconds, setSeconds] = useState(60)
  const [notice, setNotice] = useState('')

  const loggedIn = Boolean(user)

  useEffect(() => {
    if (!claimedId) return
    const timer = window.setInterval(() => setSeconds(value => value <= 1 ? 0 : value - 1), 1000)
    return () => window.clearInterval(timer)
  }, [claimedId])

  useEffect(() => {
    if (claimedId && seconds === 0) {
      setQuestions(items => items.map(item => item.id === claimedId ? { ...item, claimedBy: undefined } : item))
      setClaimedId(undefined)
      setNotice('Le délai est terminé : la question est de nouveau disponible.')
    }
  }, [claimedId, seconds])

  const availableCount = useMemo(() => questions.filter(question => !question.claimedBy).length, [questions])

  function requireLogin(action: () => void) {
    if (!loggedIn) { setAuthOpen(true); return }
    action()
  }

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setImage(URL.createObjectURL(file))
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault()
    requireLogin(() => {
      if (!draft.trim()) return
      setQuestions(items => [{ id: Date.now(), author: user, text: draft.trim(), time: 'à l’instant', image }, ...items])
      setDraft(''); setImage(undefined)
      setNotice('Question publiée dans la communauté.')
    })
  }

  function claimQuestion(id: number) {
    requireLogin(() => {
      if (claimedId) return
      setClaimedId(id); setSeconds(60)
      setQuestions(items => items.map(item => item.id === id ? { ...item, claimedBy: user } : item))
      setNotice('Question réservée pour vous pendant 1 minute.')
    })
  }

  function submitAnswer(event: FormEvent) {
    event.preventDefault()
    if (!answer.trim() || !claimedId) return
    setQuestions(items => items.map(item => item.id === claimedId ? { ...item, claimedBy: undefined } : item))
    setAnswer(''); setClaimedId(undefined)
    setNotice('Réponse humaine envoyée.')
  }

  function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    if (!name) return
    setUser(name); setAuthOpen(false); setNotice(`Bienvenue ${name} !`)
  }

  return <main className="chat-shell">
    <aside className="chat-sidebar">
      <div className="sidebar-top"><div className="human-logo">✦</div><button className="collapse" aria-label="Réduire le menu">◧</button></div>
      <button className="new-chat" onClick={() => { setMode('ask'); setDraft('') }}>✎ <span>Nouvelle question</span></button>
      <button className="sidebar-item">⌕ <span>Rechercher dans les questions</span></button>
      <button className="sidebar-item" onClick={() => setMode('answer')}>◌ <span>Répondre aux questions</span></button>
      <div className="sidebar-spacer" />
      <div className="sidebar-links"><button className="sidebar-item">◉ <span>Paramètres</span></button><button className="sidebar-item">? <span>Aide</span></button></div>
      <div className="sidebar-login"><strong>Obtenez des réponses humaines</strong><p>Connectez-vous pour poser des questions, répondre et partager des images.</p><button onClick={() => setAuthOpen(true)}>{loggedIn ? user : 'Se connecter'}</button></div>
    </aside>

    <section className="chat-main">
      <header className="chat-header"><button className="model-name" onClick={() => setMode('ask')}>Humanly <span>⌄</span></button><div className="header-actions"><span className="live-status"><i /> {availableCount} ouvertes</span><button className="login-button" onClick={() => setAuthOpen(true)}>{loggedIn ? user : 'Se connecter'}</button><button className="signup-button" onClick={() => setAuthOpen(true)}>Inscription gratuite</button></div></header>
      <div className="chat-body">
        {notice && <div className="toast">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        <div className="hero"><div className="hero-mark">✦</div><h1>{mode === 'ask' ? 'Par quoi commençons-nous ?' : 'Aidez quelqu’un aujourd’hui.'}</h1><p>Des réponses utiles, données par de vraies personnes.</p></div>
        <div className="mode-pills"><button className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}>Poser une question</button><button className={mode === 'answer' ? 'active' : ''} onClick={() => setMode('answer')}>Répondre aux questions</button></div>
        {mode === 'ask' ? <form className="chat-composer" onSubmit={submitQuestion}><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Demander à la communauté" /><div className="composer-actions"><label className="plus-button">＋<input type="file" accept="image/*" onChange={handleImage} /></label>{image && <span className="attached">Image ajoutée</span>}<span className="human-only">Réponses humaines uniquement</span><button className="send-button" disabled={!draft.trim()}>↑</button></div></form> : <div className="answer-panel"><strong>Choisissez une question en attente</strong><span>Vous aurez 60 secondes pour envoyer votre réponse.</span></div>}
        <button className="suggestion" onClick={() => setDraft('Comment apprendre une nouvelle compétence efficacement ?')}>Qu’est-ce que tu veux demander ?</button>
        {mode === 'answer' && <div className="question-list">{questions.map(question => <article className={`question-row ${question.id === claimedId ? 'selected' : ''}`} key={question.id}><div className="question-author"><span className="mini-avatar">{question.author[0]}</span><span><b>{question.author}</b><small>{question.time}</small></span></div><p>{question.text}</p>{question.id === claimedId ? <form className="answer-form" onSubmit={submitAnswer}><span className="countdown">{seconds}s</span><input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Votre réponse..." /><button disabled={!answer.trim()}>Envoyer</button></form> : <button className="answer-link" disabled={Boolean(question.claimedBy)} onClick={() => claimQuestion(question.id)}>{question.claimedBy ? 'Déjà réservée' : 'Répondre →'}</button>}</article>)}</div>}
      </div>
      <footer>Humanly n’est pas une IA. Les réponses sont écrites par des personnes. <span>Conditions</span> · <span>Confidentialité</span></footer>
    </section>
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><div className="hero-mark">✦</div><h2>Bienvenue sur Humanly</h2><p>Connectez-vous pour participer à la communauté.</p><form onSubmit={signIn}><label>Votre prénom<input name="name" autoFocus placeholder="Ex. Alex" /></label><button className="modal-submit">Continuer gratuitement</button></form><small>Aucune IA ne répond aux questions ici.</small></div></div>}
  </main>
}
