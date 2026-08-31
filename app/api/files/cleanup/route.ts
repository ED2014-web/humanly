import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CLEANUP_SECRET}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Service non configuré' }, { status: 503 })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as any

  // Trouver les fichiers expirés (>24h)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: expired, error: queryError } = await admin
    .from('file_uploads')
    .select('path')
    .lt('created_at', cutoff)
    .limit(200)

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 })
  }

  if (!expired || expired.length === 0) {
    return NextResponse.json({ deleted: 0, message: 'Rien à nettoyer.' })
  }

  const paths = expired.map((f: any) => f.path)

  // Supprimer du stockage
  const { error: storageError } = await admin.storage
    .from('question-images')
    .remove(paths)

  // Supprimer de file_uploads
  const { error: dbError } = await admin
    .from('file_uploads')
    .delete()
    .in('path', paths)

  return NextResponse.json({
    deleted: paths.length,
    storageError: storageError?.message || null,
    dbError: dbError?.message || null,
  })
}
