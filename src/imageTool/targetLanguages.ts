/** 图片翻译目标语言（与产品 UI 一致，两列栅格顺序：先左列再右列） */
export type TargetLanguageCode =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'ru'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'id'
  | 'ms'
  | 'th'
  | 'vi'
  | 'fil'
  | 'pt-BR'

export type TargetLanguage = {
  code: TargetLanguageCode
  /** 界面展示（中文） */
  labelZh: string
  /** 写入英文 prompt，便于模型理解 */
  promptEn: string
}

/** 顺序：第 1 行 中文|英语，第 2 行 日语|韩语 … */
export const TARGET_LANGUAGES: readonly TargetLanguage[] = [
  { code: 'zh', labelZh: '中文', promptEn: 'Simplified Chinese' },
  { code: 'en', labelZh: '英语', promptEn: 'English' },
  { code: 'ja', labelZh: '日语', promptEn: 'Japanese' },
  { code: 'ko', labelZh: '韩语', promptEn: 'Korean' },
  { code: 'ru', labelZh: '俄语', promptEn: 'Russian' },
  { code: 'fr', labelZh: '法语', promptEn: 'French' },
  { code: 'de', labelZh: '德语', promptEn: 'German' },
  { code: 'es', labelZh: '西班牙语', promptEn: 'Spanish' },
  { code: 'it', labelZh: '意大利语', promptEn: 'Italian' },
  { code: 'id', labelZh: '印尼语', promptEn: 'Indonesian' },
  { code: 'ms', labelZh: '马来语', promptEn: 'Malay' },
  { code: 'th', labelZh: '泰语', promptEn: 'Thai' },
  { code: 'vi', labelZh: '越南语', promptEn: 'Vietnamese' },
  { code: 'fil', labelZh: '菲律宾语', promptEn: 'Filipino' },
  { code: 'pt-BR', labelZh: '葡萄牙语(巴西)', promptEn: 'Brazilian Portuguese' },
] as const

export const DEFAULT_TARGET_LANG: TargetLanguageCode = 'zh'

const ALLOW = new Set(TARGET_LANGUAGES.map((x) => x.code))

export function isTargetLanguageCode(s: string): s is TargetLanguageCode {
  return ALLOW.has(s as TargetLanguageCode)
}

export function targetLangByCode(code: string): TargetLanguage | null {
  return TARGET_LANGUAGES.find((x) => x.code === code) || null
}
