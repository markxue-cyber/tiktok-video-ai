import { Zap } from 'lucide-react'

const zapCls =
  'h-[1.05em] w-[1.05em] shrink-0 text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.65)] [stroke-linecap:round] [stroke-linejoin:round]'

type Props = {
  amount: number
  /** 是否包一层中文括号「（…）」（仅数字+闪电，无「积分」文案） */
  wrapInParens?: boolean
  className?: string
}

/** 消耗积分按钮内：数字 + 闪电图标（替代「约 N 积分」） */
export function CreditCostWithZap({ amount, wrapInParens = false, className }: Props) {
  const inner = (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${className || ''}`}>
      <span>{amount}</span>
      <Zap className={zapCls} strokeWidth={2.35} fill="none" aria-hidden />
    </span>
  )
  if (wrapInParens) return <>（{inner}）</>
  return inner
}
