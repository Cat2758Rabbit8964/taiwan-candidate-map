/** 標題用字的激烈程度(0 到 3):只看字眼,不看正負、不看事實對錯,也不讀內文 */
const TIERS: [number, string[]][] = [
  [3, ['怒轟', '痛批', '痛斥', '重砲', '猛轟', '砲轟', '狂轟', '開轟', '暴怒', '震怒', '崩潰', '抓狂', '爆氣', '嗆爆', '炸鍋', '大翻車', '翻車', '驚爆', '噁心', '羞辱', '撕破臉', '不演了', '超扯', '太扯', '離譜', '荒謬', '慘']],
  [2, ['打臉', '踢爆', '爆料', '開砲', '互槓', '槓上', '傻眼', '尷尬', '狼狽', '翻臉', '反擊', '重擊', '叫囂', '震撼', '挨轟', '轟', '嗆', '怒', '酸', '爆', '驚', '竟', '狠', '揭', '拒絕', '出事']],
  [1, ['質疑', '批評', '抨擊', '指控', '控告', '提告', '告發', '呼籲', '籲', '要求', '回應', '反駁', '否認', '澄清', '道歉', '致歉', '不滿', '喊話', '槓', '諷']],
]

export interface Intensity {
  score: number
  /** 命中的字眼(含驚嘆號),供檢查 */
  words: string[]
}

const cache = new Map<string, Intensity>()

/**
 * 規則:取命中字眼的最高級;命中 2 個以上 2 級以上的字眼,算 3;
 * 已有字眼且標題用驚嘆號,再加 1(最高 3)。沒有任何字眼就是 0。
 */
export function intensityOf(title: string): Intensity {
  const hit = cache.get(title)
  if (hit) return hit
  const words: string[] = []
  let level = 0
  let strong = 0
  let rest = title
  for (const [lv, list] of TIERS) {
    for (const w of list) {
      if (rest.includes(w)) {
        words.push(w)
        level = Math.max(level, lv)
        if (lv >= 2) strong++
        rest = rest.split(w).join('□')
      }
    }
  }
  let score = level
  if (strong >= 2) score = 3
  if (level > 0 && /[!！]/.test(title)) {
    score = Math.min(3, score + 1)
    words.push('！')
  }
  const out = { score, words }
  cache.set(title, out)
  return out
}
