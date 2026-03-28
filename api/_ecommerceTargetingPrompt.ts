/**
 * 将「目标平台 / 目标市场 / 文案语言」转为给 LLM 的定向说明（爆款风格 + 6 场景共用）
 */

const PLATFORM_HINTS: Record<string, string> = {
  unspecified: '无单一平台约束：采用跨区域电商素材通用拍法（主图干净、信息清晰、生活与氛围格可并存）。',
  amazon:
    'Amazon 系：主图格侧重纯白/极浅无缝底、主体占比高、少道具；避免画面内促销文字与违规宣称；生活格可做轻场景代入。',
  ebay: 'eBay：清晰多角度与真实感，主图可白底或干净棚拍；描述偏实用与信任感。',
  shopify: '独立站 / Shopify：品牌调性空间更大，可在氛围与生活格强化风格化光影与场景叙事；主图仍建议保留干净版。',
  walmart: 'Walmart：清晰、亲民、高性价比视觉倾向；主图干净、光线明亮。',
  etsy: 'Etsy：手作感与质感、温暖自然光、生活格与细节格可更突出材质与手工温度。',
  tiktok_shop:
    'TikTok Shop / 短视频电商：竖版友好、动感构图与生活格更重要；主图仍要清晰，氛围格可更强情绪与对比色（勿编造价格与功效）。',
  shopee: 'Shopee：东南亚常见明亮暖调、生活化场景、清爽背景；主图与白底格保持平台清晰度习惯。',
  lazada: 'Lazada：与东南亚类似，干净主图 + 生活代入；避免杂乱促销贴纸式画面（由后期加字）。',
  tokopedia: 'Tokopedia：印尼市场生活感与信任感，明亮场景、商品清晰。',
  mercado_libre: 'Mercado Libre：拉美市场，生活场景真实、色彩可略饱和；主图仍需主体清楚。',
  taobao_tmall: '淘宝/天猫：主图干净与卖点可视区习惯；生活与氛围可更强调种草与场景代入（勿在画面生成违规宣传字）。',
  jd: '京东：偏正品感与清晰规格展示，主图与白底格稳重明亮；生活格适度即可。',
  pdd: '拼多多：亲民、清晰、促销感可由后期贴字完成；画面保持主体清楚、背景不脏不乱。',
  douyin_shop: '抖音电商：内容感、竖版友好、生活与氛围格可加强故事性与代入；主图仍需清晰。',
  kuaishou_shop: '快手电商：真实生活感、接地气场景；商品清晰，避免过度「广告腔」虚假质感。',
  xiaohongshu: '小红书：审美偏生活方式与质感，柔和自然光、干净色调；生活格与氛围格可更强调「种草」氛围。',
  coupang: 'Coupang：韩国市场偏好清晰、高效信息感；主图干净，生活格简洁现代。',
  rakuten: '乐天 / 日本市场：精致棚拍与克制配色、细节清晰；生活格温馨整洁。',
  allegro: 'Allegro：欧洲区域用户，清晰务实、主图规范；生活格自然即可。',
  other_platform: '其他平台：在干净主图与生活氛围之间平衡，以商品清晰为第一优先。',
}

const MARKET_HINTS: Record<string, string> = {
  china: '中国市场：常见电商审美（主图信息清晰、场景真实可信）；人像与家居符号贴合国内习惯。',
  usa: '美国市场：偏好简洁、真实、多元人像与居家场景；避免刻板印象与敏感文化符号；勿编造 FDA 等认证。',
  europe: '欧洲市场：偏简约、环保质感、自然光；色彩可略低饱和；注意隐私与通用人物形象。',
  australia: '澳大利亚/澳新倾向：明亮自然光、户外与家居轻松感；季节与室内场景偏南半球生活想象需合理。',
  southeast_asia:
    '东南亚：暖调、明亮、高透气感；室内场景可偏热带/现代公寓；宗教与文化符号需谨慎、勿臆造。',
  japan: '日本：精致、整洁、低噪点；生活场景紧凑有序；色彩克制。',
  korea: '韩国：清透肤质光感、时尚整洁；生活场景现代公寓与简约陈设常见。',
  middle_east: '中东：尊重保守着装与家庭场景习惯；避免不当裸露与敏感符号；奢华感可用材质与光型暗示，勿编造宗教背书。',
  latin_america: '拉丁美洲：家庭氛围热烈友好、色彩可更鲜明；生活场景真实，勿刻板化。',
  other: '其他市场：采用普适、专业电商视觉，避免特定文化冒犯与未证实的本地化宣称。',
}

function platformLabel(value: string): string {
  const row = [
    { value: 'unspecified', label: '通用/不限' },
    { value: 'amazon', label: 'Amazon' },
    { value: 'ebay', label: 'eBay' },
    { value: 'shopify', label: 'Shopify' },
    { value: 'walmart', label: 'Walmart' },
    { value: 'etsy', label: 'Etsy' },
    { value: 'tiktok_shop', label: 'TikTok Shop' },
    { value: 'shopee', label: 'Shopee' },
    { value: 'lazada', label: 'Lazada' },
    { value: 'tokopedia', label: 'Tokopedia' },
    { value: 'mercado_libre', label: 'Mercado Libre' },
    { value: 'taobao_tmall', label: '淘宝/天猫' },
    { value: 'jd', label: '京东' },
    { value: 'pdd', label: '拼多多' },
    { value: 'douyin_shop', label: '抖音电商' },
    { value: 'kuaishou_shop', label: '快手电商' },
    { value: 'xiaohongshu', label: '小红书' },
    { value: 'coupang', label: 'Coupang' },
    { value: 'rakuten', label: '乐天' },
    { value: 'allegro', label: 'Allegro' },
    { value: 'other_platform', label: '其他平台' },
  ].find((x) => x.value === value)
  return row?.label || value || '通用/不限'
}

function marketLabel(value: string): string {
  const row = [
    { value: 'china', label: '中国' },
    { value: 'usa', label: '美国' },
    { value: 'europe', label: '欧洲' },
    { value: 'australia', label: '澳大利亚' },
    { value: 'southeast_asia', label: '东南亚' },
    { value: 'japan', label: '日本' },
    { value: 'korea', label: '韩国' },
    { value: 'middle_east', label: '中东' },
    { value: 'latin_america', label: '拉丁美洲' },
    { value: 'other', label: '其他' },
  ].find((x) => x.value === value)
  return row?.label || value || '中国'
}

export type EcommerceTargetingInput = {
  targetPlatform?: string
  targetMarket?: string
  /** 文案语言：与 ProductInfo.language 一致（仅投放语境，不决定工作台输出语种） */
  copyLanguage?: string
  language?: string
}

/**
 * 电商套图工作台：与「文案语言」解耦，国内运营界面始终可读中文。
 * 拼在用户消息靠前位置，配合 buildEcommerceTargetingBlock 使用。
 */
export function buildWorkbenchUserLanguagePreamble(copyLanguageLabel: string): string {
  const l = String(copyLanguageLabel || '简体中文').trim() || '简体中文'
  return [
    '【工作台输出语言｜固定简体中文】',
    '商品分析全文、爆款风格（title 须恰好 4 个汉字 / description / imagePrompt）、六场景（title / description / imagePrompt）、主提示词 parts 与合并 prompt、精修与质检中的 issues/suggestions 等——凡国内用户在界面可读的说明性文字，必须使用简体中文。',
    'imagePrompt 以中文叙述为主；如需便于生图模型理解，可在短语后用括号夹极短英文视觉关键词，禁止整段改为英文。',
    '「文案语言」仅表示投放定向偏好（见下条【投放定向】），用于理解目标平台/市场的场景符号、主图习惯；若画面内需生成可读文字时优先使用该语言。禁止仅凭「文案语言」将上述工作台字段改为外语。',
    `【投放文案语言（用户选择，仅供参考）】${l}`,
  ].join('\n')
}

/**
 * 返回一段可拼进 user 消息的定向说明（中文为主，便于与国内模型对齐）
 */
export function buildEcommerceTargetingBlock(input: EcommerceTargetingInput): string {
  const tp = String(input.targetPlatform || 'unspecified').trim() || 'unspecified'
  const tm = String(input.targetMarket || 'china').trim() || 'china'
  const lang = String(input.copyLanguage || input.language || '简体中文').trim() || '简体中文'

  const pHint = PLATFORM_HINTS[tp] || PLATFORM_HINTS.unspecified
  const mHint = MARKET_HINTS[tm] || MARKET_HINTS.other

  return [
    '【投放定向｜须融入爆款 DNA 与 6 场景规划，勿编造当地法规、认证、具体折扣与医疗功效】',
    `目标平台（用户选择）：${platformLabel(tp)}。侧重点：${pHint}`,
    `目标市场（用户选择）：${marketLabel(tm)}。文化与视觉倾向：${mHint}`,
    `投放文案语言（用户选择）：${lang}。仅作渠道语境：帮助构思符合该平台/市场的场景符号、构图与光影气质；不得要求将商品分析、爆款风格卡片文案或六场景说明改为该外语。画面内默认尽量不生成可读文字；若需文字须与该语言一致且避免乱码。`,
    '工作台界面可见正文须为简体中文（规则见同条请求中的【工作台输出语言】）。',
    '各场景格（白底/卖点/生活/对比/细节/氛围）的 imagePrompt 须体现上述平台主图习惯与市场审美，并与 DNA 分层策略兼容（白底格不因市场而改为暗底）。',
  ].join('\n')
}
