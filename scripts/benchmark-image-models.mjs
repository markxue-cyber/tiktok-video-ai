#!/usr/bin/env node
/**
 * 对比聚合 API（OpenAI 兼容 /images/generations）下各 image 模型的端到端耗时。
 *
 * 用法（在项目根目录）：
 *   export XIAO_DOU_BAO_API_KEY='你的key'
 *   export XIAO_DOU_BAO_AI_BASE_URL='https://api.xxx/v1'   # 与线上一致，勿尾斜杠也可
 *   pnpm bench:image-models
 *
 * 指定模型 id（空格分隔）：
 *   pnpm bench:image-models -- nano-banana-2 seedream-4-0-250328
 *
 * 或用环境变量（逗号分隔）：
 *   BENCH_IMAGE_MODELS='nano-banana-2,foo' pnpm bench:image-models
 *
 * 单次请求上限（毫秒，默认 180000）：
 *   BENCH_TIMEOUT_MS=240000 pnpm bench:image-models
 *
 * 说明：每个模型只测 1 次，受排队/网络波动影响大；建议同条件连跑 3 次看趋势。
 */

const base = String(process.env.XIAO_DOU_BAO_AI_BASE_URL || '')
  .replace(/\/+$/, '')
  .trim()
const key = String(process.env.XIAO_DOU_BAO_API_KEY || '').trim()
const timeoutMs = Math.max(30_000, Number(process.env.BENCH_TIMEOUT_MS || 180_000) || 180_000)

const argvModels = process.argv.slice(2).filter((a) => a !== '--')
const envModels = String(process.env.BENCH_IMAGE_MODELS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const defaultModels = ['nano-banana-2']
const models =
  argvModels.length > 0 ? argvModels : envModels.length > 0 ? envModels : defaultModels

if (!key || !base) {
  console.error('缺少环境变量：XIAO_DOU_BAO_API_KEY 与 XIAO_DOU_BAO_AI_BASE_URL')
  process.exit(1)
}

const PROMPT =
  String(process.env.BENCH_PROMPT || '').trim() ||
  'minimal white background, single small product cube, studio photo, no text'

async function benchOne(model) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const r = await fetch(`${base}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: ac.signal,
      body: JSON.stringify({
        model,
        prompt: PROMPT,
        n: 1,
        size: '1024x1024',
      }),
    })
    const text = await r.text()
    const ms = Date.now() - t0
    clearTimeout(timer)
    if (!r.ok) {
      return {
        model,
        ms,
        ok: false,
        detail: `HTTP ${r.status} ${text.slice(0, 300)}`,
      }
    }
    let hasUrl = false
    try {
      const j = JSON.parse(text)
      const first = Array.isArray(j?.data) ? j.data[0] : null
      hasUrl = !!(first?.url || first?.b64_json || j?.url)
    } catch {
      /* ignore */
    }
    return { model, ms, ok: true, hasUrl }
  } catch (e) {
    clearTimeout(timer)
    const ms = Date.now() - t0
    return { model, ms, ok: false, detail: String(e?.message || e) }
  }
}

async function main() {
  console.log('base:', base)
  console.log('models:', models.join(', '))
  console.log('timeout per model:', timeoutMs, 'ms')
  console.log('---')
  const rows = []
  for (const m of models) {
    process.stdout.write(`running ${m} ... `)
    const row = await benchOne(m)
    rows.push(row)
    console.log(row.ok ? `${row.ms} ms` : `FAIL (${row.ms} ms)`)
    if (!row.ok) console.log('  ', row.detail || '')
  }
  console.log('---')
  const okRows = rows.filter((r) => r.ok)
  okRows.sort((a, b) => a.ms - b.ms)
  console.log('sorted by latency (success only):')
  for (const r of okRows) {
    console.log(`  ${r.ms} ms\t${r.model}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
