'use client'

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'ask' | 'answer'
type Question = { id: string | number; author: string; text: string; time: string; image?: string; claimedBy?: string; claimedUntil?: string }

export default function Home() {
  const [mode, setMode] = useState<Mode>('ask')
  const [questions, setQuestions] = useState<Question[]>([])
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const [user, setUser] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [configMissing, setConfigMissing] = useState(false)
  const [image, setImage] = useState<string>()
  const [claimedId, setClaimedId] = useState<string | number>()
  const [seconds, setSeconds] = useState(60)
  const [notice, setNotice] = useState('')

  const loggedIn = Boolean(user)

  useEffect(() => {
    if (!supabase) { setConfigMissing(true); return }
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser(data.user.user_metadata?.display_name || data.user.email?.split('@')[0] || 'Membre')
    })
    const client = supabase
    const channel = client.channel('questions-live').on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => loadQuestions()).subscribe()
    loadQuestions()
    return () => { void client.removeChannel(channel) }
  }, [])

  async function loadQuestions() {
    const client = supabase
    if (!client) return
    const { data } = await client.from('questions').select('id,text,image_path,claimed_by,claimed_until,created_at,profiles(display_name)').eq('status', 'open').order('created_at', { ascending: false })
    if (data) setQuestions(data.map((item: any) => ({ id: item.id, text: item.text, author: item.profiles?.display_name || 'Membre', time: new Date(item.created_at).toLocaleString('fr-FR'), claimedBy: item.claimed_by, claimedUntil: item.claimed_until, image: item.image_path ? client.storage.from('question-images').getPublicUrl(item.image_path).data.publicUrl : undefined })))
  }

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


  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setImage(URL.createObjectURL(file))
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !loggedIn) { setAuthOpen(true); return }
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user || !draft.trim()) return
    let imagePath: string | undefined
    if (image) setNotice('Pour joindre une image, sélectionnez-la de nouveau après la connexion.')
    const { error } = await supabase.from('questions').insert({ author_id: auth.user.id, text: draft.trim(), image_path: imagePath })
    if (error) setNotice(error.message); else { setDraft(''); setImage(undefined); setNotice('Question publiée dans la communauté.') }
  }

  async function claimQuestion(id: string | number) {
    if (!supabase || !loggedIn) { setAuthOpen(true); return }
    if (claimedId) return
    const { data, error } = await supabase.rpc('claim_question', { question_uuid: id })
    if (error) { setNotice('Cette question vient probablement d’être réservée par quelqu’un.'); return }
    setClaimedId(id); setSeconds(60)
    setQuestions(items => items.map(item => item.id === id ? { ...item, claimedBy: user } : item))
    setNotice('Question réservée pour vous pendant 1 minute.')
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !answer.trim() || !claimedId) return
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return
    const { error } = await supabase.from('answers').insert({ question_id: claimedId, author_id: auth.user.id, text: answer.trim() })
    if (error) { setNotice(error.message); return }
    await supabase.from('questions').update({ status: 'answered', claimed_by: null, claimed_until: null }).eq('id', claimedId)
    setAnswer(''); setClaimedId(undefined); setNotice('Réponse humaine envoyée.'); await loadQuestions()
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) { setNotice('Configurez Supabase dans .env.local ou Vercel.'); return }
    const form = new FormData(event.currentTarget)
    const emailValue = String(form.get('email') || '')
    const passwordValue = String(form.get('password') || '')
    const result = authMode === 'signup' ? await supabase.auth.signUp({ email: emailValue, password: passwordValue, options: { data: { display_name: emailValue.split('@')[0] } } }) : await supabase.auth.signInWithPassword({ email: emailValue, password: passwordValue })
    if (result.error) { setNotice(result.error.message); return }
    if (result.data.user) { setUser(result.data.user.user_metadata?.display_name || emailValue.split('@')[0]); setAuthOpen(false); setNotice(authMode === 'signup' ? 'Compte créé. Vérifiez votre email si demandé.' : 'Connexion réussie.') }
  }

  async function signOut() { await supabase?.auth.signOut(); setUser(''); setNotice('Vous êtes déconnecté.') }

  return <main className="chat-shell">
    <aside className="chat-sidebar">
      <div className="sidebar-top"><div className="human-logo">✦</div><button className="collapse" aria-label="Réduire le menu">◧</button></div>
      <button className="new-chat" onClick={() => { setMode('ask'); setDraft('') }}>✎ <span>Nouvelle question</span></button>
      <button className="sidebar-item">⌕ <span>Rechercher dans les questions</span></button>
      <button className="sidebar-item" onClick={() => setMode('answer')}>◌ <span>Répondre aux questions</span></button>
      <div className="sidebar-spacer" />
      <div className="sidebar-links"><button className="sidebar-item" onClick={() => setSettingsOpen(true)}>◉ <span>Paramètres</span></button><button className="sidebar-item">? <span>Aide</span></button></div>
      {!loggedIn && <div className="sidebar-login"><strong>Obtenez des réponses humaines</strong><p>Connectez-vous pour poser des questions, répondre et partager des images.</p><button onClick={() => { setAuthMode('signin'); setAuthOpen(true) }}>Se connecter</button></div>}
      {loggedIn && <button className="account-sidebar" onClick={signOut}><span className="mini-avatar">{user[0]}</span><span>{user}</span><small>Se déconnecter</small></button>}
    </aside>

    <section className="chat-main">
      <header className="chat-header"><button className="model-name" onClick={() => setMode('ask')}>Humanly <span>⌄</span></button><div className="header-actions"><span className="live-status"><i /> {availableCount} ouvertes</span>{!loggedIn && <><button className="login-button" onClick={() => { setAuthMode('signin'); setAuthOpen(true) }}>Se connecter</button><button className="signup-button" onClick={() => { setAuthMode('signup'); setAuthOpen(true) }}>Inscription gratuite</button></>}{loggedIn && <button className="account-button" onClick={signOut}><span className="mini-avatar">{user[0]}</span>{user}</button>}</div></header>
      <div className="chat-body">
        {notice && <div className="toast">{notice}<button onClick={() => setNotice('')}>×</button></div>}
        <div className="context-row"><span className="context-dot" /> Communauté Humanly <span className="context-separator">/</span> {mode === 'ask' ? 'Nouvelle question' : 'Réponses en attente'}</div>
        <div className="hero"><div className="hero-mark">✦</div><h1>{mode === 'ask' ? 'Par quoi commençons-nous ?' : 'Aidez quelqu’un aujourd’hui.'}</h1><p>Des réponses utiles, données par de vraies personnes.</p></div>
        {mode === 'ask' ? <form className="chat-composer" onSubmit={submitQuestion}><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Écrivez votre question à la communauté..." /><div className="composer-actions"><label className="plus-button">＋<input type="file" accept="image/*" onChange={handleImage} /></label>{image && <span className="attached">Image ajoutée</span>}<span className="human-only">Réponses humaines uniquement</span><button className="send-button" disabled={!draft.trim()}>↑</button></div></form> : <div className="answer-panel"><div className="answer-icon">◌</div><div><strong>Choisissez une question en attente</strong><span>Vous aurez 60 secondes pour envoyer votre réponse.</span></div></div>}
        {mode === 'answer' && questions.length > 0 && <div className="question-list">{questions.map(question => <article className={`question-row ${question.id === claimedId ? 'selected' : ''}`} key={question.id}><div className="question-author"><span className="mini-avatar">{question.author[0]}</span><span><b>{question.author}</b><small>{question.time}</small></span></div><p>{question.text}</p>{question.id === claimedId ? <form className="answer-form" onSubmit={submitAnswer}><span className="countdown">{seconds}s</span><input value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Votre réponse..." /><button disabled={!answer.trim()}>Envoyer</button></form> : <button className="answer-link" disabled={Boolean(question.claimedBy)} onClick={() => claimQuestion(question.id)}>{question.claimedBy ? 'Déjà réservée' : 'Répondre →'}</button>}</article>)}</div>}
        {mode === 'answer' && questions.length === 0 && <div className="empty-state"><div className="empty-icon">✓</div><strong>Tout est calme pour le moment</strong><span>Les nouvelles questions apparaîtront ici dès leur publication.</span></div>}
      </div>
      <footer>Humanly n’est pas une IA. Les réponses sont écrites par des personnes. <span>Conditions</span> · <span>Confidentialité</span></footer>
    </section>
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><h2>Paramètres</h2><p>Choisissez ce que vous souhaitez faire par défaut.</p><button className={mode === 'ask' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('ask'); setSettingsOpen(false) }}>✎ Poser des questions <span>{mode === 'ask' ? '✓' : ''}</span></button><button className={mode === 'answer' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('answer'); setSettingsOpen(false) }}>◌ Répondre aux questions <span>{mode === 'answer' ? '✓' : ''}</span></button></div></div>}{configMissing && <div className="config-warning">Connectez Supabase avec vos variables d’environnement pour partager les questions avec tout le monde.</div>}{authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><div className="hero-mark">✦</div><h2>{authMode === 'signup' ? 'Créer un compte' : 'Se connecter'}</h2><p>Un compte est nécessaire pour participer.</p><form onSubmit={authenticate}><label>Email<input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="vous@exemple.com" /></label><label className="password-label">Mot de passe<input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="6 caractères minimum" /></label><button className="modal-submit">{authMode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button></form><button className="auth-switch" onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}>{authMode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte gratuitement'}</button><small>Aucune IA ne répond aux questions ici.</small></div></div>}
  </main>
}
