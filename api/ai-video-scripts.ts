type OpenAICompatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAICompatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAICompatContentPart[]
}

async function callOpenAICompatJSON<T>({
  apiKey,
  baseUrl,
  request,
}: {
  apiKey: string
  baseUrl: string
  request: {
    model: string
    messages: OpenAICompatMessage[]
    temperature?: number
    response_format?: { type: 'json_object' } | { type: 'text' }
  }
}): Promise<T> {
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions'
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  const rawText = await resp.text()
  const data = (() => {
    try {
      return JSON.parse(rawText)
    } catch {
      return { _raw: rawText }
    }
  })()

  if (!resp.ok) {
    const msg = (data as any)?.error?.message || (data as any)?.message || `LLM请求失败(${resp.status})`
    throw new Error(msg)
  }

  const content =
    (data as any)?.choices?.[0]?.message?.content ??
    (data as any)?.choices?.[0]?.text ??
    (data as any)?.output_text ??
    (data as any)?.data?.output_text
  const refusal = (data as any)?.choices?.[0]?.message?.refusal
  if (refusal && typeof refusal === 'string') {
    throw new Error(`LLM拒绝响应：${refusal}`)
  }
  if (!content || typeof content !== 'string') {
    const snippet = rawText.slice(0, 300)
    throw new Error(`LLM响应为空（raw: ${snippet}）`)
  }

  try {
    return JSON.parse(content) as T
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (m?.[0]) return JSON.parse(m[0]) as T
    throw new Error('LLM未返回可解析的JSON')
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' })

  try {
    const apiKey = process.env.XIAO_DOU_BAO_API_KEY
    const baseUrl = process.env.XIAO_DOU_BAO_AI_BASE_URL || 'https://api.linkapi.org/v1'
    const model = process.env.XIAO_DOU_BAO_GPT_MODEL || 'gpt-4o'

    const { product, language, refImage } = req.body || {}
    if (!product) return res.status(400).json({ success: false, error: '缺少product' })
    if (!refImage) return res.status(400).json({ success: false, error: '缺少refImage' })

    if (!apiKey) {
      return res.status(200).json({
        success: true,
        scripts: [
          '【开场钩子】这东西到底好不好用？\n【镜头1】画面：开箱取出商品｜字幕：开箱看看｜口播：先拆开看看做工细节\n【镜头2】画面：外观细节特写｜字幕：细节一眼见｜口播：这个设计点很直观\n【镜头3】画面：上手演示核心用法｜字幕：一用就懂｜口播：像这样操作就行\n【镜头4】画面：卖点1特写/演示｜字幕：重点1｜口播：这个点是我最在意的\n【镜头5】画面：卖点2场景化展示｜字幕：重点2｜口播：放到日常场景里更实用\n【镜头6】画面：卖点3补充特写｜字幕：重点3｜口播：再看这个细节也很加分\n【收尾CTA】想看更细的使用方法，先收藏关注～',
          '【开场钩子】以前我最怕的就是这个麻烦。\n【镜头1】画面：痛点场景快速切入｜字幕：痛点来了｜口播：之前每次都会卡住\n【镜头2】画面：传统方案对比镜头（保守）｜字幕：老办法太累｜口播：用老办法总是麻烦\n【镜头3】画面：商品上手解决动作｜字幕：换它试试｜口播：换成这个步骤更顺\n【镜头4】画面：卖点1“画面证明”｜字幕：关键点1｜口播：这个结构设计很关键\n【镜头5】画面：卖点2演示动作｜字幕：关键点2｜口播：第二个点直接省一步\n【镜头6】画面：结果呈现（不夸大）｜字幕：体验更好｜口播：至少我用起来更顺手\n【收尾CTA】如果你也遇到同样问题，先收藏对照一下～',
          '【开场钩子】适合谁？我觉得这类场景最需要。\n【镜头1】画面：目标场景开场｜字幕：场景代入｜口播：比如在这个场景里\n【镜头2】画面：拿起商品开始使用｜字幕：上手很快｜口播：拿起来就能用\n【镜头3】画面：卖点1特写｜字幕：看这里｜口播：这个细节真的很加分\n【镜头4】画面：卖点2演示｜字幕：再来一个｜口播：第二个点更实用\n【镜头5】画面：卖点3场景化｜字幕：更贴近日常｜口播：日常用就很顺\n【镜头6】画面：收纳/摆放回到场景｜字幕：放哪都行｜口播：收纳也不占地方\n【收尾CTA】想让我再拍一条更细的使用技巧，留言告诉我～',
        ],
        _mock: true,
      })
    }

    const primarySystem = [
      '你是短视频分镜编导，擅长输出“可直接拍摄”的镜头脚本。请基于商品图与商品信息生成 3 条短视频脚本。',
      '',
      '输出要求（必须严格）：',
      '- 只输出 JSON：{"scripts":[...]}，scripts 必须是长度为3的字符串数组',
      '- 不要输出任何解释、Markdown、前后缀',
      '',
      '硬约束：',
      '1) 禁止编造参数/材质/功效/认证/优惠信息。只能使用商品信息里给定卖点 + 图片可见内容。拿不准就不要写。',
      '2) 每条脚本适配 10-15 秒竖屏：总共 7-9 行（每行一句），节奏快、口语化。',
      '3) 每条脚本必须是“镜头化”格式，严格用以下模板（每行都要可拍摄）：',
      '',
      '【开场钩子】<1行>',
      '【镜头1】画面：<…>｜字幕：<…>｜口播：<…>',
      '【镜头2】画面：<…>｜字幕：<…>｜口播：<…>',
      '...',
      '【镜头6】画面：<…>｜字幕：<…>｜口播：<…>',
      '【收尾CTA】<1行（中性引导：收藏/关注/了解更多/去看看；避免强引导购买/承诺收益）>',
      '',
      '4) 卖点覆盖：sellingPoints 中前 3 个卖点必须至少各出现 1 次，并且要用“画面证明”方式呈现（特写/演示/对比）。',
      '5) 三条脚本风格必须明显不同：',
      '   - 脚本1：开箱测评风（开箱→细节→上手→总结）',
      '   - 脚本2：痛点对比风（痛点→对比→解决→结果）',
      '   - 脚本3：场景体验风（目标场景→体验→推荐理由）',
      '6) 合规：避免医疗、绝对化、夸大承诺；不要包含歧视/暴力/成人/政治内容。',
      '',
      '语言：按用户要求语言输出。',
    ].join('\n')

    const safeFallbackSystem = [
      '你是短视频分镜脚本助手。你的任务是把给定的商品信息与图片，改写成“中性、合规、可拍摄”的分镜脚本。',
      '',
      '必须严格只输出 JSON：{"scripts":[...]}，scripts 是长度为3的字符串数组。',
      '不要出现“带货/下单/优惠/返钱/赚钱/必买”等强营销词；CTA 只允许中性引导（收藏/关注/了解更多/去看看）。',
      '禁止编造：任何参数、功效、认证、价格、优惠、对比指标；不确定就用更保守描述。',
      '',
      '格式必须严格为：',
      '【开场钩子】…',
      '【镜头1】画面：…｜字幕：…｜口播：…',
      '...',
      '【镜头6】画面：…｜字幕：…｜口播：…',
      '【收尾CTA】…',
    ].join('\n')

    const userMsg: OpenAICompatMessage = {
      role: 'user',
      content: [
        { type: 'text', text: `输出语言：${language || product.language || '简体中文'}` },
        { type: 'text', text: `商品信息（必须遵守，不要编造）：\n${JSON.stringify(product)}` },
        { type: 'text', text: '请结合商品图的外观与使用场景生成 3 条“镜头化脚本”。' },
        { type: 'image_url', image_url: { url: String(refImage) } },
      ],
    }

    const run = (systemPrompt: string, temperature: number) =>
      callOpenAICompatJSON<{ scripts: any[] }>({
        apiKey,
        baseUrl,
        request: {
          model,
          temperature,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            userMsg,
          ],
        },
      })

    let data: { scripts: any[] }
    try {
      data = await run(primarySystem, 0.7)
    } catch (err: any) {
      const msg = String(err?.message || '')
      if (msg.includes('LLM拒绝响应')) {
        data = await run(safeFallbackSystem, 0.4)
      } else {
        throw err
      }
    }

    const scriptsRaw = Array.isArray(data.scripts) ? data.scripts.filter(Boolean).slice(0, 3) : []
    const scripts = scriptsRaw.map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const title = (item as any).title || (item as any).name || (item as any).style
        const body = (item as any).script || (item as any).text || (item as any).content
        if (title && body) return `${title}\n${body}`
        if (body) return String(body)
        return JSON.stringify(item)
      }
      return String(item)
    })
    if (scripts.length < 3) throw new Error('脚本生成结果不足3条')

    return res.status(200).json({ success: true, scripts })
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || '服务器错误' })
  }
}

