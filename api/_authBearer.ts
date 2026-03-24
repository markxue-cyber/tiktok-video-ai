import { parseJson } from './_admin.js'

/** 与 me.ts 一致：用 Auth REST 校验 Bearer，避免在 Vercel 上依赖 @supabase/supabase-js 的 requireUser */
export async function requireBearerUser(req: any): Promise<{ id: string; email?: string }> {
  const auth = String(req.headers?.authorization || '')
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!token) throw new Error('未登录（缺少 Authorization Bearer token）')

  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) throw new Error('Supabase 未配置（缺少 SUPABASE_URL / SUPABASE_ANON_KEY）')

  const base = String(supabaseUrl).replace(/\/$/, '')
  const userResp = await fetch(`${base}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  })
  const userJson = await parseJson(userResp)
  if (!userResp.ok) {
    throw new Error(
      userJson?.error_description || userJson?.message || userJson?.msg || '登录已失效，请重新登录',
    )
  }
  const user = userJson?.user || userJson
  const id = String(user?.id || user?.sub || '')
  if (!id) throw new Error('登录已失效，请重新登录')
  return { id, email: user?.email }
}
