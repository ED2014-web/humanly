'use client'

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'ask' | 'answer' | 'history'
type Answer = { id: string; text: string; author: string; authorId: string; time: string; image?: string }
type Question = { id: string; author: string; authorId: string; text: string; time: string; status: 'open' | 'answered' | 'hidden'; image?: string; claimedBy?: string; claimedUntil?: string; answers: Answer[] }

type DrawingPadProps = { onSave: (file: File) => void; onClose: () => void }

function DrawingPad({ onSave, onClose }: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState('#202123')
  const [size, setSize] = useState(4)
  const drawing = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  function position(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) }
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    drawing.current = true
    canvas.setPointerCapture(event.pointerId)
    const point = position(event)
    context.beginPath()
    context.moveTo(point.x, point.y)
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    const point = position(event)
    context.strokeStyle = color
    context.lineWidth = size
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.lineTo(point.x, point.y)
    context.stroke()
  }

  function stop() {
    drawing.current = false
    canvasRef.current?.getContext('2d')?.closePath()
  }

  function clear() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  function save() {
    canvasRef.current?.toBlob(blob => {
      if (blob) onSave(new File([blob], `dessin-${Date.now()}.png`, { type: 'image/png' }))
    }, 'image/png')
  }

  return <div className="drawing-modal modal-backdrop" onClick={onClose}>
    <div className="drawing-card" onClick={event => event.stopPropagation()}>
      <div className="drawing-heading"><div><span className="eyebrow">Atelier créatif</span><h2>Dessiner une réponse</h2></div><button className="modal-close" onClick={onClose} aria-label="Fermer">×</button></div>
      <p className="drawing-help">Dessine avec ta souris ou ton doigt, puis envoie ton croquis avec ta réponse.</p>
      <canvas ref={canvasRef} width={900} height={500} className="drawing-canvas" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
      <div className="drawing-tools"><div className="color-palette">{['#202123', '#695de5', '#e45757', '#29a875', '#ef9b35', '#3478db'].map(item => <button key={item} className={`color-choice ${color === item ? 'selected' : ''}`} style={{ backgroundColor: item }} onClick={() => setColor(item)} aria-label={`Couleur ${item}`} />)}</div><label className="brush-size">Épaisseur <input type="range" min="2" max="18" value={size} onChange={event => setSize(Number(event.target.value))} /></label><button className="clear-button" onClick={clear}>Effacer</button><button className="primary-button" onClick={save}>Utiliser ce dessin</button></div>
    </div>
  </div>
}

export default function Home() {
  const [mode, setMode] = useState<Mode>('ask')
  const [questions, setQuestions] = useState<Question[]>([])
  const [draft, setDraft] = useState('')
  const [answer, setAnswer] = useState('')
  const [user, setUser] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [configMissing, setConfigMissing] = useState(false)
  const [questionImage, setQuestionImage] = useState<File>()
  const [questionPreview, setQuestionPreview] = useState('')
  const [answerImage, setAnswerImage] = useState<File>()
  const [answerPreview, setAnswerPreview] = useState('')
  const [drawingOpen, setDrawingOpen] = useState(false)
  const [claimedId, setClaimedId] = useState('')
  const [seconds, setSeconds] = useState(60)
  const [notice, setNotice] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const loggedIn = Boolean(user && currentUserId)
  const availableQuestions = useMemo(() => questions.filter(question => question.status === 'open'), [questions])
  const historyQuestions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return questions.filter(question => (question.authorId === currentUserId || question.answers.some(item => item.authorId === currentUserId)) && (!query || `${question.text} ${question.answers.map(item => item.text).join(' ')}`.toLowerCase().includes(query)))
  }, [questions, currentUserId, searchQuery])

  useEffect(() => {
    const client = supabase
    if (!client) { setConfigMissing(true); return }
    let active = true
    client.auth.getUser().then(({ data }) => {
      if (!active) return
      const member = data.user
      setCurrentUserId(member?.id || '')
      setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || '')
      void loadQuestions(member?.id || '')
    })
    const channel = client.channel('humain-gpt-live').on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => { void loadQuestions() }).on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => { void loadQuestions() }).subscribe()
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      const member = session?.user
      setCurrentUserId(member?.id || '')
      setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || '')
      void loadQuestions(member?.id || '')
    })
    return () => { active = false; listener.subscription.unsubscribe(); void client.removeChannel(channel) }
  }, [])

  async function loadQuestions(userId = currentUserId) {
    const client = supabase
    if (!client) return
    let answerQuestionIds: string[] = []
    if (userId) {
      const ownAnswers = await client.from('answers').select('question_id').eq('author_id', userId)
      answerQuestionIds = (ownAnswers.data || []).map((item: any) => item.question_id).filter((id: string, index: number, ids: string[]) => ids.indexOf(id) === index)
    }
    const filters = userId && answerQuestionIds.length ? `status.eq.open,author_id.eq.${userId},id.in.(${answerQuestionIds.join(',')})` : userId ? `status.eq.open,author_id.eq.${userId}` : 'status.eq.open'
    const { data, error } = await client.from('questions').select('id,text,image_path,claimed_by,claimed_until,status,created_at,author_id,profiles(display_name)').or(filters).order('created_at', { ascending: false })
    if (error || !data) return
    const ids = data.map((item: any) => item.id)
    const answersByQuestion: Record<string, Answer[]> = {}
    if (ids.length) {
      const result = await client.from('answers').select('id,question_id,text,image_path,created_at,author_id,profiles(display_name)').in('question_id', ids).order('created_at', { ascending: true })
      ;(result.data || []).forEach((item: any) => {
        const answerItem: Answer = { id: item.id, text: item.text, authorId: item.author_id, author: item.profiles?.display_name || 'Membre', time: new Date(item.created_at).toLocaleString('fr-FR'), image: item.image_path ? client.storage.from('question-images').getPublicUrl(item.image_path).data.publicUrl : undefined }
        answersByQuestion[item.question_id] = [...(answersByQuestion[item.question_id] || []), answerItem]
      })
    }
    setQuestions(data.map((item: any) => ({ id: item.id, text: item.text, authorId: item.author_id, author: item.profiles?.display_name || 'Membre', time: new Date(item.created_at).toLocaleString('fr-FR'), status: item.status, claimedBy: item.claimed_by || undefined, claimedUntil: item.claimed_until || undefined, image: item.image_path ? client.storage.from('question-images').getPublicUrl(item.image_path).data.publicUrl : undefined, answers: answersByQuestion[item.id] || [] })))
  }

  useEffect(() => {
    if (!claimedId) return
    const timer = window.setInterval(() => setSeconds(value => value <= 1 ? 0 : value - 1), 1000)
    return () => window.clearInterval(timer)
  }, [claimedId])

  useEffect(() => {
    if (claimedId && seconds === 0) {
      setQuestions(items => items.map(item => item.id === claimedId ? { ...item, claimedBy: undefined } : item))
      setClaimedId('')
      setNotice('Le délai est terminé : la question est de nouveau disponible.')
    }
  }, [claimedId, seconds])

  function chooseFile(event: ChangeEvent<HTMLInputElement>, target: 'question' | 'answer') {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setNotice('Choisis une image au format PNG, JPG ou similaire.'); return }
    const preview = URL.createObjectURL(file)
    if (target === 'question') { setQuestionImage(file); setQuestionPreview(preview) } else { setAnswerImage(file); setAnswerPreview(preview) }
  }

  function setDrawing(file: File) {
    setAnswerImage(file)
    setAnswerPreview(URL.createObjectURL(file))
    setDrawingOpen(false)
    setNotice('Dessin ajouté à ta réponse.')
  }

  function removeAttachment(target: 'question' | 'answer') {
    if (target === 'question') { if (questionPreview) URL.revokeObjectURL(questionPreview); setQuestionImage(undefined); setQuestionPreview('') } else { if (answerPreview) URL.revokeObjectURL(answerPreview); setAnswerImage(undefined); setAnswerPreview('') }
  }

  async function uploadImage(file: File, userId: string, folder: string) {
    const client = supabase
    if (!client) return { path: '', error: new Error('Supabase non configuré') }
    const cleanName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')
    const path = `${folder}/${userId}/${Date.now()}-${cleanName}`
    const result = await client.storage.from('question-images').upload(path, file, { contentType: file.type, upsert: false })
    return { path, error: result.error }
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault()
    const client = supabase
    if (!client || !loggedIn) { setAuthOpen(true); return }
    if (!draft.trim() || draft.trim().length < 3) { setNotice('Écris au moins trois caractères pour poser ta question.'); return }
    let imagePath: string | undefined
    if (questionImage) {
      const upload = await uploadImage(questionImage, currentUserId, 'questions')
      if (upload.error) { setNotice(`L’image n’a pas pu être envoyée : ${upload.error.message}`); return }
      imagePath = upload.path
    }
    const { error } = await client.from('questions').insert({ author_id: currentUserId, text: draft.trim(), image_path: imagePath })
    if (error) setNotice(error.message); else { setDraft(''); removeAttachment('question'); setNotice('Question publiée dans la communauté.'); await loadQuestions() }
  }

  async function claimQuestion(question: Question) {
    const client = supabase
    if (!client || !loggedIn) { setAuthOpen(true); return }
    if (claimedId) return
    const { error } = await client.rpc('claim_question', { question_uuid: question.id })
    if (error) { setNotice('Cette question vient probablement d’être réservée par quelqu’un.'); await loadQuestions(); return }
    setClaimedId(question.id); setSeconds(60)
    setQuestions(items => items.map(item => item.id === question.id ? { ...item, claimedBy: currentUserId } : item))
    setNotice(question.authorId === currentUserId ? 'Tu peux maintenant répondre à ta propre question.' : 'Question réservée pour toi pendant 1 minute.')
  }

  async function submitAnswer(event: FormEvent) {
    event.preventDefault()
    const client = supabase
    if (!client || !loggedIn || !claimedId || (!answer.trim() && !answerImage)) return
    let imagePath: string | undefined
    if (answerImage) {
      const upload = await uploadImage(answerImage, currentUserId, 'answers')
      if (upload.error) { setNotice(`Le fichier n’a pas pu être envoyé : ${upload.error.message}`); return }
      imagePath = upload.path
    }
    const { error } = await client.from('answers').insert({ question_id: claimedId, author_id: currentUserId, text: answer.trim() || 'Réponse en image', image_path: imagePath })
    if (error) { setNotice(error.message); return }
    const update = await client.from('questions').update({ status: 'answered', claimed_by: null, claimed_until: null }).eq('id', claimedId)
    if (update.error) { setNotice(update.error.message); return }
    setAnswer(''); removeAttachment('answer'); setClaimedId(''); setNotice('Réponse envoyée, même à ta propre question.'); await loadQuestions()
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = supabase
    if (!client) { setNotice('Configure Supabase dans .env.local ou Vercel.'); return }
    const form = new FormData(event.currentTarget)
    const emailValue = String(form.get('email') || '')
    const passwordValue = String(form.get('password') || '')
    const result = authMode === 'signup' ? await client.auth.signUp({ email: emailValue, password: passwordValue, options: { data: { display_name: emailValue.split('@')[0] } } }) : await client.auth.signInWithPassword({ email: emailValue, password: passwordValue })
    if (result.error) { setNotice(result.error.message); return }
    if (result.data.user) { setCurrentUserId(result.data.user.id); setUser(result.data.user.user_metadata?.display_name || emailValue.split('@')[0]); setAuthOpen(false); setNotice(authMode === 'signup' ? 'Compte créé. Vérifie ton email si demandé.' : 'Connexion réussie.') }
  }

  async function signOut() { await supabase?.auth.signOut(); setUser(''); setCurrentUserId(''); setMode('ask'); setNotice('Tu es déconnecté.') }
  function openAuth(kind: 'signin' | 'signup') { setAuthMode(kind); setAuthOpen(true) }

  return <main className={`chat-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="chat-sidebar">
      <div className="sidebar-top"><button className="brand" onClick={() => setMode('ask')}><span className="brand-mark">✦</span><span>HumainGPT</span></button><button className="collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Réduire le menu">‹</button></div>
      <button className="new-chat" onClick={() => { setMode('ask'); setDraft(''); setSearchQuery('') }}>＋ <span>Nouvelle question</span></button>
      <button className="sidebar-item" onClick={() => { setMode('history'); setSearchOpen(value => !value) }}>⌕ <span>Rechercher dans l’historique</span></button>
      {searchOpen && <div className="search-box"><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Rechercher..." /><button onClick={() => { setSearchQuery(''); setSearchOpen(false) }}>×</button></div>}
      <button className={`sidebar-item ${mode === 'answer' ? 'active' : ''}`} onClick={() => setMode('answer')}>◌ <span>Répondre aux questions</span><b>{availableQuestions.length || ''}</b></button>
      <button className={`sidebar-item ${mode === 'history' ? 'active' : ''}`} onClick={() => setMode('history')}>▤ <span>Mes conversations</span></button>
      <div className="sidebar-spacer" />
      <div className="sidebar-links"><button className="sidebar-item" onClick={() => setSettingsOpen(true)}>⚙ <span>Paramètres</span></button><button className="sidebar-item" onClick={() => setHelpOpen(true)}>?</button></div>
      {!loggedIn && <div className="sidebar-login"><strong>Participe à la communauté</strong><p>Connecte-toi pour poser des questions, répondre et partager des images.</p><button onClick={() => openAuth('signin')}>Se connecter</button></div>}
      {loggedIn && <button className="account-sidebar" onClick={signOut}><span className="mini-avatar">{user[0]}</span><span>{user}</span><small>Se déconnecter</small></button>}
    </aside>

    {sidebarCollapsed && <button className="expand-sidebar" onClick={() => setSidebarCollapsed(false)} aria-label="Afficher le menu">›</button>}
    <section className="chat-main">
      <header className="chat-header"><button className="model-name" onClick={() => setMode('ask')}><span className="header-mark">✦</span> HumainGPT <span className="chevron">⌄</span></button><div className="header-actions"><span className="live-status"><i /> {availableQuestions.length} question{availableQuestions.length > 1 ? 's' : ''} ouverte{availableQuestions.length > 1 ? 's' : ''}</span>{!loggedIn && <><button className="login-button" onClick={() => openAuth('signin')}>Se connecter</button><button className="signup-button" onClick={() => openAuth('signup')}>Inscription gratuite</button></>}{loggedIn && <button className="account-button" onClick={signOut}><span className="mini-avatar">{user[0]}</span>{user}</button>}</div></header>
      <div className="chat-body">
        {notice && <div className="toast">{notice}<button onClick={() => setNotice('')} aria-label="Fermer la notification">×</button></div>}
        <div className="context-row"><span className="context-dot" /> Espace HumainGPT <span className="context-separator">/</span> {mode === 'ask' ? 'Nouvelle question' : mode === 'answer' ? 'Questions en attente' : 'Historique'}</div>
        {mode === 'ask' && <><div className="hero"><div className="hero-mark">✦</div><h1>Qu’est-ce qui te ferait avancer ?</h1><p>Des réponses utiles, données par de vraies personnes.</p></div><form className="chat-composer" onSubmit={submitQuestion}><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Écris ta question à la communauté..." /><div className="composer-actions"><label className="plus-button" title="Ajouter une image">＋<input type="file" accept="image/*" onChange={event => chooseFile(event, 'question')} /></label>{questionPreview && <AttachmentPreview src={questionPreview} onRemove={() => removeAttachment('question')} />}{!questionPreview && <span className="human-only">Réponses humaines uniquement</span>}<button className={`send-button ${draft.trim().length >= 3 ? 'ready' : ''}`} disabled={draft.trim().length < 3} aria-label="Envoyer la question">↑</button></div></form><p className="composer-note">Tu pourras retrouver cette conversation dans <button onClick={() => setMode('history')}>Mes conversations</button>.</p></>}
        {mode === 'answer' && <><div className="section-heading"><div><span className="eyebrow">Entraide en direct</span><h1>Aide quelqu’un aujourd’hui.</h1><p>Choisis une question, écris une réponse, ou dessine une idée.</p></div><span className="count-pill">{availableQuestions.length} disponible{availableQuestions.length > 1 ? 's' : ''}</span></div><div className="question-list">{availableQuestions.map(question => <QuestionCard key={question.id} question={question} selected={question.id === claimedId} seconds={seconds} answer={answer} answerPreview={answerPreview} currentUserId={currentUserId} onClaim={() => claimQuestion(question)} onAnswerChange={setAnswer} onSubmit={submitAnswer} onFile={event => chooseFile(event, 'answer')} onDraw={() => setDrawingOpen(true)} onRemoveImage={() => removeAttachment('answer')} />)}</div>{availableQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
        {mode === 'history' && <><div className="section-heading"><div><span className="eyebrow">Ton espace personnel</span><h1>Historique des conversations.</h1><p>Retrouve tes questions, tes réponses et tes images au même endroit.</p></div><span className="count-pill">{historyQuestions.length} conversation{historyQuestions.length > 1 ? 's' : ''}</span></div>{!loggedIn ? <EmptyState login={() => openAuth('signin')} /> : <div className="history-list">{historyQuestions.map(question => <HistoryCard key={question.id} question={question} currentUserId={currentUserId} />)}</div>}{loggedIn && historyQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
      </div>
      <footer>HumainGPT n’est pas une IA. Les réponses sont écrites par des personnes. <button onClick={() => setHelpOpen(true)}>Conditions</button> · <button onClick={() => setHelpOpen(true)}>Confidentialité</button></footer>
    </section>
    {drawingOpen && <DrawingPad onSave={setDrawing} onClose={() => setDrawingOpen(false)} />}
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><span className="eyebrow">Préférences</span><h2>Paramètres</h2><p>Choisis l’espace à ouvrir par défaut.</p><button className={mode === 'ask' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('ask'); setSettingsOpen(false) }}>✎ Poser une question <span>{mode === 'ask' ? '✓' : ''}</span></button><button className={mode === 'answer' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('answer'); setSettingsOpen(false) }}>◌ Répondre aux questions <span>{mode === 'answer' ? '✓' : ''}</span></button><button className={mode === 'history' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('history'); setSettingsOpen(false) }}>▤ Ouvrir l’historique <span>{mode === 'history' ? '✓' : ''}</span></button></div></div>}
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><div className="help-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setHelpOpen(false)}>×</button><span className="hero-mark small-mark">✦</span><h2>Bienvenue sur HumainGPT</h2><p>Pose une question, ajoute une image, ou aide quelqu’un avec un message et un dessin. Tout est conservé dans ton historique quand tu es connecté.</p><button className="primary-button full-button" onClick={() => setHelpOpen(false)}>J’ai compris</button></div></div>}
    {configMissing && <div className="config-warning">Connecte Supabase avec tes variables d’environnement pour partager les conversations.</div>}
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><div className="hero-mark">✦</div><span className="eyebrow">HumainGPT</span><h2>{authMode === 'signup' ? 'Créer ton compte' : 'Se connecter'}</h2><p>Un compte est nécessaire pour participer et retrouver ton historique.</p><form onSubmit={authenticate}><label>Email<input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="vous@exemple.com" /></label><label className="password-label">Mot de passe<input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="6 caractères minimum" /></label><button className="modal-submit">{authMode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button></form><button className="auth-switch" onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}>{authMode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte gratuitement'}</button><small>Aucune IA ne répond aux questions ici.</small></div></div>}
  </main>
}

function AttachmentPreview({ src, onRemove }: { src: string; onRemove: () => void }) {
  return <span className="attachment-preview"><img src={src} alt="Aperçu de la pièce jointe" /><button type="button" onClick={onRemove} aria-label="Retirer l’image">×</button></span>
}

function QuestionCard({ question, selected, seconds, answer, answerPreview, currentUserId, onClaim, onAnswerChange, onSubmit, onFile, onDraw, onRemoveImage }: { question: Question; selected: boolean; seconds: number; answer: string; answerPreview: string; currentUserId: string; onClaim: () => void; onAnswerChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onDraw: () => void; onRemoveImage: () => void }) {
  return <article className={`question-row ${selected ? 'selected' : ''}`}><div className="question-author"><span className="mini-avatar">{question.author[0]}</span><span><b>{question.author}{question.authorId === currentUserId ? ' · vous' : ''}</b><small>{question.time}</small></span></div><p>{question.text}</p>{question.image && <img className="content-image" src={question.image} alt="Image jointe à la question" />}{selected ? <form className="answer-form" onSubmit={onSubmit}><div className="answer-toolbar"><span className="countdown">{seconds}s</span><label className="tool-button" title="Ajouter une image">＋<input type="file" accept="image/*" onChange={onFile} /></label><button type="button" className="tool-button" onClick={onDraw} title="Dessiner">✎</button>{answerPreview && <AttachmentPreview src={answerPreview} onRemove={onRemoveImage} />}<span className="toolbar-hint">Répondre avec du texte ou un dessin</span></div><textarea value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="Écris ta réponse..." /><button className="answer-submit" disabled={!answer.trim() && !answerPreview}>Envoyer la réponse</button></form> : <button className="answer-link" disabled={Boolean(question.claimedBy)} onClick={onClaim}>{question.claimedBy === currentUserId ? 'Réservée par vous' : question.claimedBy ? 'Déjà réservée' : question.authorId === currentUserId ? 'Répondre à ma question →' : 'Répondre →'}</button>}</article>
}

function HistoryCard({ question, currentUserId }: { question: Question; currentUserId: string }) {
  return <article className="history-card"><div className="history-top"><span className={`status-dot ${question.status}`} /><span>{question.status === 'answered' ? 'Répondue' : 'En attente'}</span><time>{question.time}</time></div><div className="history-question"><span className="mini-avatar">{question.author[0]}</span><div><strong>{question.authorId === currentUserId ? 'Votre question' : `Question de ${question.author}`}</strong><p>{question.text}</p></div></div>{question.image && <img className="content-image" src={question.image} alt="Image de la conversation" />}{question.answers.map(item => <div className="history-answer" key={item.id}><span className="mini-avatar answer-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Votre réponse' : item.author}</strong><small>{item.time}</small><p>{item.text}</p>{item.image && <img className="content-image" src={item.image} alt="Dessin ou image de la réponse" />}</div></div>)}</article>
}

function EmptyState({ onClick, login }: { onClick?: () => void; login?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">✓</div><strong>{login ? 'Connecte-toi pour retrouver ton historique' : 'Tout est calme pour le moment'}</strong><span>{login ? 'Tes conversations et tes réponses seront conservées ici.' : 'Les nouvelles questions apparaîtront ici dès leur publication.'}</span>{(onClick || login) && <button className="primary-button" onClick={login || onClick}>{login ? 'Se connecter' : 'Poser une question'}</button>}</div>
}
