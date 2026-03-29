import { Zap } from 'lucide-react'

const zapCls =
  'h-[1.05em] w-[1.05em] shrink-0 text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.65)] [stroke-linecap:round] [stroke-linejoin:round]'

type Props = {
  amount: number
  className?: string
}

/** 消耗积分：数字 + 闪电（无括号，与主文案用父级 gap 排版） */
export function CreditCostWithZap({ amount, className }: Props) {
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${className || ''}`}>
      <span>{amount}</span>
      <Zap className={zapCls} strokeWidth={2.35} fill="none" aria-hidden />
    </span>
  )
}
