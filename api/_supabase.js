import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY）')
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}

export function getSupabaseAnon() {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')
  return createClient(url, anonKey, { auth: { persistSession: false } })
}

export async function requireUser(req) {
  const auth = String(req.headers?.authorization || '')
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new Error('未登录（缺少 Authorization Bearer token）')
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) throw new Error('登录已失效，请重新登录')
  return { user: data.user, token }
}

