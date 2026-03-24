export function buildDownloadProxyUrl(assetUrl: string, filename?: string) {
  const q = new URLSearchParams()
  q.set('url', String(assetUrl || ''))
  if (filename) q.set('name', String(filename))
  return `/api/download-asset?${q.toString()}`
}

export function triggerProxyDownload(assetUrl: string, filename?: string) {
  const href = buildDownloadProxyUrl(assetUrl, filename)
  const a = document.createElement('a')
  a.href = href
  if (filename) a.download = filename
  a.rel = 'noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
