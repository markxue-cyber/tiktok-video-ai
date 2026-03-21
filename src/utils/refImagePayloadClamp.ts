/**
 * Vercel Serverless 请求体约 4.5MB 上限；大图 data URL 会触发 FUNCTION_PAYLOAD_TOO_LARGE。
 * 在发往 /api/* 前对参考图做降采样，避免整段 JSON 超限。
 */
/** 留出 JSON 字段与编码余量，避免贴 Vercel ~4.5MB 上限 */
const DEFAULT_MAX_REF_CHARS = 2_200_000

function isDataUrl(s: string): boolean {
  return typeof s === 'string' && s.startsWith('data:image/') && s.includes('base64,')
}

/**
 * 将图片最长边限制为 maxSide，输出 JPEG 以显著减小体积（适合作为模型参考图）。
 */
function resizeDataUrlToJpeg(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        let w = img.naturalWidth || 1
        let h = img.naturalHeight || 1
        const longest = Math.max(w, h)
        const scale = longest > maxSide ? maxSide / longest : 1
        const nw = Math.max(1, Math.round(w * scale))
        const nh = Math.max(1, Math.round(h * scale))
        const c = document.createElement('canvas')
        c.width = nw
        c.height = nh
        const ctx = c.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, nw, nh)
        const jpeg = c.toDataURL('image/jpeg', quality)
        if (jpeg.startsWith('data:image/jpeg')) resolve(jpeg)
        else resolve(dataUrl)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * 若 refImage 为过大的 data URL，则循环缩小最长边并 JPEG 编码，直到低于字符上限或达到最小边长。
 * 非 data URL（如 https）原样返回。
 */
export async function clampRefImageForVercel(
  refImage: string,
  maxChars: number = DEFAULT_MAX_REF_CHARS,
): Promise<string> {
  const ref = String(refImage || '').trim()
  if (!ref || !isDataUrl(ref)) return ref
  if (ref.length <= maxChars) return ref

  let current = ref
  let maxSide = 2048
  let quality = 0.88
  const minSide = 640

  while (current.length > maxChars && maxSide >= minSide) {
    const next = await resizeDataUrlToJpeg(current, maxSide, quality)
    if (next.length >= current.length * 0.98) {
      maxSide = Math.floor(maxSide * 0.72)
      quality = Math.max(0.55, quality - 0.08)
      continue
    }
    current = next
    if (current.length <= maxChars) break
    maxSide = Math.floor(maxSide * 0.85)
    quality = Math.max(0.55, quality - 0.05)
  }

  const desperate: Array<{ side: number; q: number }> = [
    { side: 512, q: 0.52 },
    { side: 420, q: 0.45 },
    { side: 360, q: 0.4 },
  ]
  for (const { side, q } of desperate) {
    if (current.length <= maxChars) break
    current = await resizeDataUrlToJpeg(current, side, q)
  }

  return current
}
