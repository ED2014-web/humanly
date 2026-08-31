'use client'

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadActiveConversation, saveActiveConversation } from '../lib/conversation-state'

type Mode = 'ask' | 'answer' | 'history'
type Answer = { id: string; text: string; author: string; authorId: string; time: string; createdAt: string; image?: string }
type Message = Answer
type Question = { id: string; author: string; authorId: string; text: string; time: string; createdAt: string; status: 'open' | 'answered' | 'hidden'; image?: string; claimedBy?: string; claimedUntil?: string; answers: Answer[]; messages: Message[] }

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
  const [deleteQuestion, setDeleteQuestion] = useState<Question>()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeQuestionId, setActiveQuestionId] = useState('')
  const [questionsLoaded, setQuestionsLoaded] = useState(false)
  const currentUserIdRef = useRef('')
  const activeQuestionIdRef = useRef('')
  const questionsLoadedRef = useRef(false)
  const loadRequestRef = useRef(0)

  function setActiveConversation(questionId: string) {
    activeQuestionIdRef.current = questionId
    setActiveQuestionId(questionId)
    saveActiveConversation(window.localStorage, questionId)
  }

  function cacheQuestion(question: Question) {
    window.localStorage.setItem(`humain-gpt-question-${question.id}`, JSON.stringify({ ...question, image: undefined, answers: (question.answers || []).map(item => ({ ...item, image: undefined })), messages: (question.messages || []).map(item => ({ ...item, image: undefined })) }))
  }

  function readCachedActiveQuestion(userId: string) {
    if (!activeQuestionIdRef.current || !userId) return undefined
    try {
      const raw = window.localStorage.getItem(`humain-gpt-question-${activeQuestionIdRef.current}`)
      const cached = raw ? JSON.parse(raw) as Question : undefined
      if (cached?.authorId !== userId) return undefined
      return { ...cached, answers: cached.answers || [], messages: cached.messages || [] }
    } catch {
      return undefined
    }
  }

  useEffect(() => {
    const savedQuestionId = loadActiveConversation(window.localStorage)
    if (savedQuestionId) {
      activeQuestionIdRef.current = savedQuestionId
      setActiveQuestionId(savedQuestionId)
    }
  }, [])

  const loggedIn = Boolean(user && currentUserId)
  const availableQuestions = useMemo(() => questions.filter(question => question.status === 'open'), [questions])
  const historyQuestions = useMemo(() => [...questions.filter(question => question.authorId === currentUserId || question.answers.some(item => item.authorId === currentUserId))].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), [questions, currentUserId])
  const activeQuestion = useMemo(() => questions.find(question => question.id === activeQuestionId), [questions, activeQuestionId])

  useEffect(() => {
    const client = supabase
    if (!client) { setConfigMissing(true); return }
    let active = true
    client.auth.getUser().then(({ data }) => {
      if (!active) return
      const member = data.user
      const memberId = member?.id || ''
      currentUserIdRef.current = memberId
      setCurrentUserId(memberId)
      setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || '')
      void loadQuestions(memberId)
    })
    const channel = client.channel('humain-gpt-live').on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => { void loadQuestions(currentUserIdRef.current) }).on('postgres_changes', { event: '*', schema: 'public', table: 'answers' }, () => { void loadQuestions(currentUserIdRef.current) }).on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => { void loadQuestions(currentUserIdRef.current) }).subscribe()
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') return
      const member = session?.user
      const memberId = member?.id || ''
      // INITIAL_SESSION peut arriver en même temps que getUser(). Évite une
      // seconde requête anonyme qui pourrait écraser l’historique utilisateur.
      if (memberId === currentUserIdRef.current && questionsLoadedRef.current) return
      currentUserIdRef.current = memberId
      setCurrentUserId(memberId)
      setUser(member?.user_metadata?.display_name || member?.email?.split('@')[0] || '')
      void loadQuestions(memberId)
    })
    return () => { active = false; listener.subscription.unsubscribe(); void client.removeChannel(channel) }
  }, [])

  useEffect(() => {
    if (!currentUserId || !supabase) return
    const refresh = () => { void loadQuestions(currentUserIdRef.current) }
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const timer = window.setInterval(refresh, 10000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(timer)
    }
  }, [currentUserId])

  async function getImageUrl(client: NonNullable<typeof supabase>, path?: string) {
    if (!path) return undefined
    const result = await client.storage.from('question-images').createSignedUrl(path, 60 * 60)
    return result.data?.signedUrl
  }

  async function loadQuestions(userId = currentUserIdRef.current) {
    const client = supabase
    if (!client) return
    const requestId = ++loadRequestRef.current
    setQuestionsLoaded(false)
    questionsLoadedRef.current = false
    const questionSelect = 'id,text,image_path,claimed_by,claimed_until,status,created_at,author_id'
    const openResult = await client.from('questions').select(questionSelect).eq('status', 'open').order('created_at', { ascending: false })
    if (openResult.error || !openResult.data) {
      const cachedActiveQuestion = readCachedActiveQuestion(userId)
      if (requestId === loadRequestRef.current) {
        if (cachedActiveQuestion) setQuestions(items => items.some(item => item.id === cachedActiveQuestion.id) ? items : [cachedActiveQuestion, ...items])
        setQuestionsLoaded(true)
        questionsLoadedRef.current = true
      }
      return
    }

    // Les questions ouvertes sont publiques. On ajoute toutes les conversations
    // de l’utilisateur, y compris celles qui sont encore en attente, pour que
    // le chat actif et l’historique restent réouvrables après un rechargement.
    let data = openResult.data as any[]
    if (userId) {
      const ownQuestions = await client.from('questions').select(questionSelect).eq('author_id', userId).neq('status', 'hidden')
      const ownAnswers = await client.from('answers').select('question_id').eq('author_id', userId)
      const answerQuestionIds = (ownAnswers.data || []).map((item: any) => item.question_id).filter((id: string, index: number, ids: string[]) => ids.indexOf(id) === index)
      const answeredQuestions = answerQuestionIds.length
        ? await client.from('questions').select(questionSelect).in('id', answerQuestionIds).neq('status', 'hidden')
        : { data: [], error: null }
      const combined = [...data, ...(ownQuestions.data || []), ...(answeredQuestions.data || [])]
      data = combined.filter((item: any, index: number, items: any[]) => items.findIndex(candidate => candidate.id === item.id) === index)
    }

    const ids = data.map((item: any) => item.id)
    const answersByQuestion: Record<string, Answer[]> = {}
    const messagesByQuestion: Record<string, Message[]> = {}
    const answerRows: any[] = []
    const messageRows: any[] = []
    if (ids.length) {
      const result = await client.from('answers').select('id,question_id,text,image_path,created_at,author_id').in('question_id', ids).order('created_at', { ascending: true })
      answerRows.push(...(result.data || []))
      const messagesResult = await client.from('messages').select('id,question_id,text,image_path,created_at,author_id').in('question_id', ids).order('created_at', { ascending: true })
      messageRows.push(...(messagesResult.data || []))
    }
    const authorIds = Array.from(new Set([...data.map((item: any) => item.author_id), ...answerRows.map(item => item.author_id), ...messageRows.map(item => item.author_id)].filter(Boolean)))
    const profileMap: Record<string, string> = {}
    if (authorIds.length) {
      const profilesResult = await client.from('profiles').select('id,display_name').in('id', authorIds)
      ;(profilesResult.data || []).forEach((profile: any) => { profileMap[profile.id] = profile.display_name })
    }
    const displayName = (authorId: string) => profileMap[authorId] || (authorId === userId ? user || 'Vous' : 'Membre')
    const answerItems = await Promise.all(answerRows.map(async (item: any): Promise<Answer & { questionId: string }> => ({ id: item.id, questionId: item.question_id, text: item.text, authorId: item.author_id, author: displayName(item.author_id), time: new Date(item.created_at).toLocaleString('fr-FR'), createdAt: item.created_at, image: await getImageUrl(client, item.image_path) })))
    answerItems.forEach(item => { answersByQuestion[item.questionId] = [...(answersByQuestion[item.questionId] || []), item] })
    const messageItems = await Promise.all(messageRows.map(async (item: any): Promise<Message & { questionId: string }> => ({ id: item.id, questionId: item.question_id, text: item.text, authorId: item.author_id, author: displayName(item.author_id), time: new Date(item.created_at).toLocaleString('fr-FR'), createdAt: item.created_at, image: await getImageUrl(client, item.image_path) })))
    messageItems.forEach(item => { messagesByQuestion[item.questionId] = [...(messagesByQuestion[item.questionId] || []), item] })
    let questionItems = await Promise.all(data.map(async (item: any): Promise<Question> => ({ id: item.id, text: item.text, authorId: item.author_id, author: displayName(item.author_id), time: new Date(item.created_at).toLocaleString('fr-FR'), createdAt: item.created_at, status: item.status, claimedBy: item.claimed_by || undefined, claimedUntil: item.claimed_until || undefined, image: await getImageUrl(client, item.image_path), answers: answersByQuestion[item.id] || [], messages: messagesByQuestion[item.id] || [] })))
    if (requestId !== loadRequestRef.current) return
    const cachedActiveQuestion = readCachedActiveQuestion(userId)
    if (cachedActiveQuestion && !questionItems.some(item => item.id === cachedActiveQuestion.id)) {
      questionItems = [cachedActiveQuestion, ...questionItems]
    }
    setQuestions(questionItems)
    const loadedActiveQuestion = questionItems.find(item => item.id === activeQuestionIdRef.current)
    if (loadedActiveQuestion) cacheQuestion(loadedActiveQuestion)
    setQuestionsLoaded(true)
    questionsLoadedRef.current = true
    // Ne pas effacer le chat sauvegardé pendant le chargement anonyme initial.
    // Si Supabase répond momentanément sans la ligne, le cache local permet de
    // garder le chat réouvrable ; on efface seulement un identifiant invalide.
    if (userId && activeQuestionIdRef.current && !questionItems.some(item => item.id === activeQuestionIdRef.current)) {
      setActiveConversation('')
    }
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
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    if (!allowedTypes.includes(file.type)) { setNotice('Choisis une image PNG, JPG, WEBP ou GIF.'); return }
    if (file.size > 5 * 1024 * 1024) { setNotice('L’image doit faire 5 Mo maximum.'); return }
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

  async function submitMessage(questionId: string, event: FormEvent) {
    event.preventDefault()
    const client = supabase
    if (!client) { setAuthOpen(true); return }
    if (!draft.trim() && !questionImage) return
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setAuthOpen(true); return }
    let imagePath: string | undefined
    if (questionImage) {
      const upload = await uploadImage(questionImage, auth.user.id, 'messages')
      if (upload.error) { setNotice(`L’image n’a pas pu être envoyée : ${upload.error.message}`); return }
      imagePath = upload.path
    }
    const { data: createdMessage, error } = await client.rpc('submit_message', { question_uuid: questionId, message_text: draft.trim(), message_image_path: imagePath || null })
    if (error) { setNotice(error.message); return }
    const created = Array.isArray(createdMessage) ? createdMessage[0] : createdMessage
    const messageCreatedAt = created?.created_at || new Date().toISOString()
    const localMessage: Message = { id: created?.id || `local-${Date.now()}`, text: created?.text || draft.trim() || 'Message en image', authorId: auth.user.id, author: auth.user.user_metadata?.display_name || user || 'Membre', time: new Date(messageCreatedAt).toLocaleString('fr-FR'), createdAt: messageCreatedAt, image: questionPreview || undefined }
    setQuestions(items => items.map(item => item.id === questionId ? { ...item, messages: [...item.messages, localMessage] } : item))
    setDraft('')
    removeAttachment('question')
    setNotice('Message ajouté à cette conversation.')
    await loadQuestions(currentUserIdRef.current)
  }

  async function permanentlyDeleteQuestion(question: Question) {
    const client = supabase
    if (!client) { setAuthOpen(true); return }
    const { data: auth } = await client.auth.getUser()
    if (!auth.user || auth.user.id !== question.authorId) { setNotice('Seule la personne qui a posé la question peut la supprimer.'); return }
    const { error } = await client.rpc('delete_question', { question_uuid: question.id })
    if (error) { setNotice(error.message); return }
    window.localStorage.removeItem(`humain-gpt-question-${question.id}`)
    if (activeQuestionIdRef.current === question.id) setActiveConversation('')
    setQuestions(items => items.filter(item => item.id !== question.id))
    setDeleteQuestion(undefined)
    setNotice('Conversation supprimée définitivement pour tout le monde.')
  }

  async function submitQuestion(event: FormEvent) {
    event.preventDefault()
    const client = supabase
    if (!client) { setAuthOpen(true); return }
    if (!draft.trim() || draft.trim().length < 3) { setNotice('Écris au moins trois caractères pour poser ta question.'); return }
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setAuthOpen(true); return }
    const authorId = auth.user.id
    let imagePath: string | undefined
    if (questionImage) {
      const upload = await uploadImage(questionImage, authorId, 'questions')
      if (upload.error) { setNotice(`L’image n’a pas pu être envoyée : ${upload.error.message}`); return }
      imagePath = upload.path
    }
    const { data: createdQuestion, error } = await client.rpc('create_question', { question_text: draft.trim(), question_image_path: imagePath || null })
    const created = Array.isArray(createdQuestion) ? createdQuestion[0] : createdQuestion
    if (error) setNotice(error.message); else if (created?.id) {
      const createdAt = created.created_at || new Date().toISOString()
      const newQuestion: Question = { id: created.id, author: auth.user.user_metadata?.display_name || user || 'Vous', authorId, text: draft.trim(), time: new Date(createdAt).toLocaleString('fr-FR'), createdAt, image: questionPreview || undefined, status: 'open', answers: [], messages: [] }
      cacheQuestion(newQuestion)
      setQuestions(items => [newQuestion, ...items.filter(item => item.id !== newQuestion.id)])
      setActiveConversation(newQuestion.id)
      setDraft('')
      removeAttachment('question')
      setMode('ask')
      setNotice('Question envoyée. Une personne va pouvoir te répondre.')
      await loadQuestions(authorId)
    }
  }

  async function claimQuestion(question: Question) {
    const client = supabase
    if (!client) { setAuthOpen(true); return }
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setAuthOpen(true); return }
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
    if (!client || !claimedId || (!answer.trim() && !answerImage)) return
    const { data: auth } = await client.auth.getUser()
    if (!auth.user) { setAuthOpen(true); return }
    const answerAuthorId = auth.user.id
    let imagePath: string | undefined
    if (answerImage) {
      const upload = await uploadImage(answerImage, answerAuthorId, 'answers')
      if (upload.error) { setNotice(`Le fichier n’a pas pu être envoyé : ${upload.error.message}`); return }
      imagePath = upload.path
    }
    const questionId = claimedId
    const { data: submittedAnswer, error } = await client.rpc('submit_answer', { question_uuid: questionId, answer_text: answer.trim(), answer_image_path: imagePath || null })
    if (error) { setNotice(error.message); return }
    const submitted = Array.isArray(submittedAnswer) ? submittedAnswer[0] : submittedAnswer
    if (submitted?.id) {
      const answerCreatedAt = submitted.created_at || new Date().toISOString()
      const localAnswer: Answer = { id: submitted.id, text: submitted.text || answer.trim() || 'Réponse en image', authorId: answerAuthorId, author: auth.user.user_metadata?.display_name || user || 'Membre', time: new Date(answerCreatedAt).toLocaleString('fr-FR'), createdAt: answerCreatedAt, image: answerPreview || undefined }
      setQuestions(items => items.map(item => {
        if (item.id !== questionId) return item
        const updatedQuestion = { ...item, status: 'answered' as const, claimedBy: undefined, claimedUntil: undefined, answers: [...item.answers.filter(existing => existing.id !== localAnswer.id), localAnswer] }
        cacheQuestion(updatedQuestion)
        return updatedQuestion
      }))
    }
    setAnswer(''); removeAttachment('answer'); setClaimedId(''); setNotice('Réponse envoyée. Elle est maintenant visible dans la conversation.'); await loadQuestions(currentUserIdRef.current)
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

  async function signOut() { await supabase?.auth.signOut(); setUser(''); setCurrentUserId(''); setMode('ask'); setActiveConversation(''); setNotice('Tu es déconnecté.') }
  function openAuth(kind: 'signin' | 'signup') { setAuthMode(kind); setAuthOpen(true) }

  return <main className={`chat-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="chat-sidebar">
      <div className="sidebar-top"><button className="brand" onClick={() => setMode('ask')}><span className="brand-mark">✦</span><span>HumainGPT</span></button><button className="collapse" onClick={() => setSidebarCollapsed(true)} aria-label="Réduire le menu">‹</button></div>
      <button className="new-chat" onClick={() => {      setMode('ask'); setDraft(''); setActiveConversation('') }}>＋ <span>Nouvelle question</span></button>
      <button className={`sidebar-item ${mode === 'history' ? 'active' : ''}`} onClick={() => setMode('history')}>▤ <span>Mes conversations</span></button>
      {loggedIn && historyQuestions.length > 0 && <nav className="conversation-nav" aria-label="Conversations récentes">{historyQuestions.map(question => <div key={question.id} className={`conversation-nav-row ${question.id === activeQuestionId ? 'active' : ''}`}><button className="conversation-nav-item" title={question.text} onClick={() => { setActiveConversation(question.id); setMode('ask') }}><span className={`status-dot ${question.status}`} /><span>{shortTitle(question.text)}</span></button>{question.authorId === currentUserId && <button type="button" className="delete-conversation" aria-label={`Supprimer ${shortTitle(question.text)}`} title="Supprimer définitivement" onClick={() => setDeleteQuestion(question)}>🗑️</button>}</div>)}</nav>}
      <div className="sidebar-spacer" />
      <div className="sidebar-links">      <button className="sidebar-item" onClick={() => setSettingsOpen(true)}>⚙ <span>Paramètres</span></button></div>
      {!loggedIn && <div className="sidebar-login"><strong>Participe à la communauté</strong><p>Connecte-toi pour poser des questions, répondre et partager des images.</p><button onClick={() => openAuth('signin')}>Se connecter</button></div>}
      {loggedIn && <button className="account-sidebar" onClick={signOut}><span className="mini-avatar">{user[0]}</span><span>{user}</span><small>Se déconnecter</small></button>}
    </aside>

    {sidebarCollapsed && <button className="expand-sidebar" onClick={() => setSidebarCollapsed(false)} aria-label="Afficher le menu">›</button>}
    <section className="chat-main">
      <header className="chat-header"><button className="model-name" onClick={() => { setMode('ask'); setActiveConversation('') }}><span className="header-mark">✦</span> HumainGPT</button><div className="header-actions">{!loggedIn && <><button className="login-button" onClick={() => openAuth('signin')}>Se connecter</button><button className="signup-button" onClick={() => openAuth('signup')}>Inscription gratuite</button></> }</div></header>
      <div className="chat-body">
        {notice && <div className="toast">{notice}<button onClick={() => setNotice('')} aria-label="Fermer la notification">×</button></div>}
        {mode === 'ask' && activeQuestion ? <ActiveConversation question={activeQuestion} currentUserId={currentUserId} draft={draft} questionPreview={questionPreview} onDraftChange={setDraft} onSubmit={event => submitMessage(activeQuestion.id, event)} onFile={event => chooseFile(event, 'question')} onRemoveImage={() => removeAttachment('question')} onNewQuestion={() => { setActiveConversation(''); setDraft('') }} /> : mode === 'ask' && !questionsLoaded && activeQuestionId ? <div className="conversation-loading"><span className="waiting-orb"><i /><i /><i /></span><strong>Ouverture de ta conversation…</strong></div> : mode === 'ask' && <><div className="hero"><div className="hero-mark">✦</div><h1>Qu’est-ce qui te ferait avancer ?</h1><p>Des réponses utiles, données par de vraies personnes.</p></div><form className="chat-composer" onSubmit={submitQuestion}><textarea value={draft} onChange={event => setDraft(event.target.value)} placeholder="Écris ta question à la communauté..." /><div className="composer-actions"><label className="plus-button" title="Ajouter une image">＋<input type="file" accept="image/*" onChange={event => chooseFile(event, 'question')} /></label>{questionPreview && <AttachmentPreview src={questionPreview} onRemove={() => removeAttachment('question')} />}{!questionPreview && <span className="human-only">Réponses humaines uniquement</span>}<button className={`send-button ${draft.trim().length >= 3 ? 'ready' : ''}`} disabled={draft.trim().length < 3} aria-label="Envoyer la question">↑</button></div></form><p className="composer-note">Tu pourras retrouver cette conversation dans <button onClick={() => setMode('history')}>Mes conversations</button>.</p></>}
        {mode === 'answer' && <><div className="section-heading"><div><span className="eyebrow">Entraide en direct</span><h1>Aide quelqu’un aujourd’hui.</h1><p>Choisis une question, lis tout le chat, puis écris une réponse.</p></div><span className="count-pill">{availableQuestions.length} disponible{availableQuestions.length > 1 ? 's' : ''}</span></div><div className="question-list">{availableQuestions.map(question => <QuestionCard key={question.id} question={question} selected={question.id === claimedId} seconds={seconds} answer={answer} answerPreview={answerPreview} currentUserId={currentUserId} onClaim={() => claimQuestion(question)} onAnswerChange={setAnswer} onSubmit={submitAnswer} onFile={event => chooseFile(event, 'answer')} onDraw={() => setDrawingOpen(true)} onRemoveImage={() => removeAttachment('answer')} />)}</div>{availableQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
        {mode === 'history' && <><div className="section-heading"><div><span className="eyebrow">Ton espace personnel</span><h1>Historique des conversations.</h1><p>Retrouve tes questions, tes réponses et tes images au même endroit.</p></div><span className="count-pill">{historyQuestions.length} conversation{historyQuestions.length > 1 ? 's' : ''}</span></div>{!loggedIn ? <EmptyState login={() => openAuth('signin')} /> : <div className="history-list">{historyQuestions.map(question => <HistoryCard key={question.id} question={question} currentUserId={currentUserId} onOpen={() => { setActiveConversation(question.id); setMode('ask') }} onDelete={() => setDeleteQuestion(question)} />)}</div>}{loggedIn && historyQuestions.length === 0 && <EmptyState onClick={() => setMode('ask')} />}</>}
      </div>
      <footer>HumainGPT n’est pas une IA. Les réponses sont écrites par des personnes. <span>Conditions</span> · <span>Confidentialité</span></footer>
    </section>
    {drawingOpen && <DrawingPad onSave={setDrawing} onClose={() => setDrawingOpen(false)} />}
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><div className="settings-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSettingsOpen(false)}>×</button><span className="eyebrow">Préférences</span><h2>Paramètres</h2><p>Choisis l’espace à ouvrir par défaut.</p><button className={mode === 'ask' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('ask'); setActiveConversation(''); setSettingsOpen(false) }}>✎ Poser une question <span>{mode === 'ask' ? '✓' : ''}</span></button><button className={mode === 'answer' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('answer'); setSettingsOpen(false) }}>◌ Questions ouvertes <span>{mode === 'answer' ? `${availableQuestions.length} ouverte${availableQuestions.length > 1 ? 's' : ''}` : ''}</span></button><button className={mode === 'history' ? 'setting-choice active' : 'setting-choice'} onClick={() => { setMode('history'); setSettingsOpen(false) }}>▤ Ouvrir l’historique <span>{mode === 'history' ? '✓' : ''}</span></button></div></div>}
    {configMissing && <div className="config-warning">Connecte Supabase avec tes variables d’environnement pour partager les conversations.</div>}
    {deleteQuestion && <div className="modal-backdrop" onClick={() => setDeleteQuestion(undefined)}><div className="delete-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setDeleteQuestion(undefined)} aria-label="Fermer">×</button><div className="delete-icon">⌫</div><span className="eyebrow danger-eyebrow">Action irréversible</span><h2>Supprimer cette conversation ?</h2><p>Cette conversation sera supprimée pour tout le monde, même si personne n’y a encore répondu. Elle sera définitivement effacée et ne pourra pas être récupérée.</p><div className="delete-actions"><button className="cancel-button" onClick={() => setDeleteQuestion(undefined)}>Annuler</button><button className="danger-button" onClick={() => void permanentlyDeleteQuestion(deleteQuestion)}>Supprimer pour tout le monde</button></div></div></div>}
    {authOpen && <div className="modal-backdrop" onClick={() => setAuthOpen(false)}><div className="auth-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setAuthOpen(false)}>×</button><div className="hero-mark">✦</div><span className="eyebrow">HumainGPT</span><h2>{authMode === 'signup' ? 'Créer ton compte' : 'Se connecter'}</h2><p>Un compte est nécessaire pour participer et retrouver ton historique.</p><form onSubmit={authenticate}><label>Email<input name="email" type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="vous@exemple.com" /></label><label className="password-label">Mot de passe<input name="password" type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={6} placeholder="6 caractères minimum" /></label><button className="modal-submit">{authMode === 'signup' ? 'Créer mon compte' : 'Se connecter'}</button></form><button className="auth-switch" onClick={() => setAuthMode(authMode === 'signup' ? 'signin' : 'signup')}>{authMode === 'signup' ? 'J’ai déjà un compte' : 'Créer un compte gratuitement'}</button><small>Aucune IA ne répond aux questions ici.</small></div></div>}
  </main>
}

function AttachmentPreview({ src, onRemove }: { src: string; onRemove: () => void }) {
  return <span className="attachment-preview"><img src={src} alt="Aperçu de la pièce jointe" /><button type="button" onClick={onRemove} aria-label="Retirer l’image">×</button></span>
}

function QuestionCard({ question, selected, seconds, answer, answerPreview, currentUserId, onClaim, onAnswerChange, onSubmit, onFile, onDraw, onRemoveImage }: { question: Question; selected: boolean; seconds: number; answer: string; answerPreview: string; currentUserId: string; onClaim: () => void; onAnswerChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onDraw: () => void; onRemoveImage: () => void }) {
  const thread = [...(question.messages || []).map(item => ({ ...item, kind: 'message' as const })), ...(question.answers || []).map(item => ({ ...item, kind: 'answer' as const }))].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  return <article className={`question-row ${selected ? 'selected' : ''}`}><div className="question-author"><span className="mini-avatar">{question.author[0]}</span><span><b>{question.author}{question.authorId === currentUserId ? ' · vous' : ''}</b><small>{question.time}</small></span></div><p>{question.text}</p>{question.image && <img className="content-image" src={question.image} alt="Image jointe à la question" />}{thread.length > 0 && <div className="question-thread">{thread.map(item => <div className={`question-thread-item ${item.authorId === currentUserId ? 'mine' : ''}`} key={`${item.kind}-${item.id}`}><span className="mini-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Vous' : item.author}</strong><small>{item.kind === 'answer' ? 'Réponse' : 'Message'}</small><p>{item.text}</p>{item.image && <img className="content-image" src={item.image} alt="Image jointe au fil" />}</div></div>)}</div>}{selected ? <form className="answer-form" onSubmit={onSubmit}><div className="answer-toolbar"><span className="countdown">{seconds}s</span><label className="tool-button" title="Ajouter une image">＋<input type="file" accept="image/*" onChange={onFile} /></label><button type="button" className="tool-button" onClick={onDraw} title="Dessiner">✎</button>{answerPreview && <AttachmentPreview src={answerPreview} onRemove={onRemoveImage} />}<span className="toolbar-hint">Répondre avec du texte ou un dessin</span></div><textarea value={answer} onChange={event => onAnswerChange(event.target.value)} placeholder="Écris ta réponse..." /><button className="answer-submit" disabled={!answer.trim() && !answerPreview}>Envoyer la réponse</button></form> : <button className="answer-link" disabled={Boolean(question.claimedBy)} onClick={onClaim}>{question.claimedBy === currentUserId ? 'Réservée par vous' : question.claimedBy ? 'Déjà réservée' : 'Répondre →'}</button>}</article>
}

function ActiveConversation({ question, currentUserId, draft, questionPreview, onDraftChange, onSubmit, onFile, onRemoveImage, onNewQuestion }: { question: Question; currentUserId: string; draft: string; questionPreview: string; onDraftChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveImage: () => void; onNewQuestion: () => void }) {
  const waiting = question.status === 'open' && question.answers.length === 0
  const thread = [...(question.messages || []).map(item => ({ ...item, kind: 'message' as const })), ...(question.answers || []).map(item => ({ ...item, kind: 'answer' as const }))].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
  return <div className="active-conversation">
    <div className="conversation-label"><span className="conversation-icon">✦</span><span>{shortTitle(question.text)}</span><span className="conversation-time">{question.time}</span></div>
    <div className="conversation-thread">
      <div className={`message-card question-message ${question.authorId === currentUserId ? 'message-own' : 'message-other'}`}><span className="mini-avatar">{question.author[0]}</span><div><strong>{question.authorId === currentUserId ? 'Vous' : question.author}</strong><small>{question.time}</small><p>{question.text}</p>{question.image && <img className="content-image" src={question.image} alt="Image jointe à votre question" />}</div></div>
      {thread.map(item => <div className={`message-card ${item.kind === 'answer' ? 'answer-message' : 'chat-message'} ${item.authorId === currentUserId ? 'message-own' : 'message-other'}`} key={`${item.kind}-${item.id}`}><span className="mini-avatar answer-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Vous' : item.author}</strong><small>{item.kind === 'answer' ? 'Réponse' : 'Message'}</small><p>{item.text}</p>{item.image && <img className="content-image" src={item.image} alt="Image jointe au message" />}</div></div>)}
      {waiting && <div className="waiting-card"><span className="waiting-orb"><i /><i /><i /></span><div><strong>Réponse en cours</strong><span>Votre question a été envoyée à la communauté.</span></div></div>}
    </div>
    <form className="conversation-composer" onSubmit={onSubmit}><textarea value={draft} onChange={event => onDraftChange(event.target.value)} placeholder="Poser une nouvelle question" aria-label="Poser une nouvelle question" /><div className="conversation-composer-actions"><label className="plus-button" title="Ajouter une image">＋<input type="file" accept="image/*" onChange={onFile} /></label>{questionPreview && <AttachmentPreview src={questionPreview} onRemove={onRemoveImage} />}<button className={`composer-arrow ${draft.trim().length >= 3 ? 'ready' : ''}`} disabled={draft.trim().length < 3} aria-label="Envoyer la question">↑</button></div></form>
    <button className="new-conversation-link" onClick={onNewQuestion}>Effacer et commencer un nouveau chat</button>
  </div>
}

function HistoryCard({ question, currentUserId, onOpen, onDelete }: { question: Question; currentUserId: string; onOpen: () => void; onDelete: () => void }) {
  return <article className="history-card"><div className="history-top"><span className={`status-dot ${question.status}`} /><span>{question.status === 'answered' ? 'Répondue' : 'En attente'}</span><time>{question.time}</time><button type="button" className="history-open" onClick={onOpen}>Ouvrir →</button>{question.authorId === currentUserId && <button type="button" className="history-delete" onClick={onDelete} aria-label="Supprimer définitivement" title="Supprimer définitivement">🗑️</button>}</div><div className="history-question"><span className="mini-avatar">{question.author[0]}</span><div><strong>{question.authorId === currentUserId ? 'Votre question' : `Question de ${question.author}`}</strong><p>{question.text}</p></div></div>{question.image && <img className="content-image" src={question.image} alt="Image de la conversation" />}{question.answers.map(item => <div className="history-answer" key={item.id}><span className="mini-avatar answer-avatar">{item.author[0]}</span><div><strong>{item.authorId === currentUserId ? 'Votre réponse' : item.author}</strong><small>{item.time}</small><p>{item.text}</p>{item.image && <img className="content-image" src={item.image} alt="Dessin ou image de la réponse" />}</div></div>)}</article>
}

function shortTitle(text: string) {
  const compact = text.trim().replace(/\s+/g, ' ')
  return compact.length > 34 ? `${compact.slice(0, 34).trimEnd()}…` : compact || 'Nouvelle conversation'
}

function EmptyState({ onClick, login }: { onClick?: () => void; login?: () => void }) {
  return <div className="empty-state"><div className="empty-icon">✓</div><strong>{login ? 'Connecte-toi pour retrouver ton historique' : 'Tout est calme pour le moment'}</strong><span>{login ? 'Tes conversations et tes réponses seront conservées ici.' : 'Les nouvelles questions apparaîtront ici dès leur publication.'}</span>{(onClick || login) && <button className="primary-button" onClick={login || onClick}>{login ? 'Se connecter' : 'Poser une question'}</button>}</div>
}
