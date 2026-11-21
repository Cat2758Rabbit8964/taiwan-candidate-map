import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  COLUMNS, CORE_OUTLETS, EVENTS, JUDGE, OTHER_OUTLETS, OUTLETS, PILOT_QUERY_DATE, REPORTS,
} from './data/coverage'
import type { Report } from './data/coverage'
import { intensityOf } from './data/intensity'

const COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
  '#bcbd22', '#17becf', '#393b79', '#e6550d', '#31a354', '#756bb1', '#636363',
]
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = (Math.PI / 5) * i - Math.PI / 2
  const r = i % 2 ? 4 : 9
  return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`
}).join(' L')
type Shape = (typeof SHAPES)[number] | 'star'

const styleOf = (outlet: string) => {
  if (outlet === JUDGE) return { color: 'var(--fg)', shape: 'star' as Shape }
  const i = OUTLETS.indexOf(outlet)
  return { color: COLORS[i % COLORS.length], shape: SHAPES[i % SHAPES.length] as Shape }
}

function Mark({ shape, r = 6 }: { shape: Shape; r?: number }) {
  switch (shape) {
    case 'circle': return <circle r={r} />
    case 'square': return <rect x={-r} y={-r} width={2 * r} height={2 * r} />
    case 'triangle': return <path d={`M0 ${-r - 1} L${r + 1} ${r} L${-r - 1} ${r} Z`} />
    case 'diamond': return <path d={`M0 ${-r - 1} L${r + 1} 0 L0 ${r + 1} L${-r - 1} 0 Z`} />
    case 'star': return <path d={`M${STAR} Z`} />
    case 'cross': return <path d={`M${-r} ${-2} H${-2} V${-r} H2 V${-2} H${r} V2 H2 V${r} H${-2} V2 H${-r} Z`} />
  }
}

const W = 720
const H = 380
const M = { l: 44, r: 16, t: 14, b: 34 }
const Y_LEVELS = [4, 3, 2, 1, 0, -1, -2, -3, -4]

interface Point {
  key: string
  outlet: string
  col: number
  score: number
  evTitle: string
  evColumn: string
  base: number
  baseReason: string
  /** 畫成這一點的報導;事實分析點沒有 */
  rep?: Report
  /** 同一家對同一事件的全部報導 */
  all: Report[]
}

/** 以網址決定的固定亂數(0~1),重新整理後位置不變 */
function rand(seed: string, salt: number) {
  let h = 2166136261 ^ salt
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  return ((h >>> 0) % 10000) / 10000
}

/** 同一家對同一事件只畫一點,另加每個事件一個「事實分析」點 */
function buildPoints(): Point[] {
    const evs = new Map(EVENTS.map((e) => [e.id, e]))
    const groups = new Map<string, Report[]>()
    for (const r of REPORTS) groups.set(`${r.event}|${r.outlet}`, [...(groups.get(`${r.event}|${r.outlet}`) ?? []), r])
    const out: Point[] = []
    for (const all of groups.values()) {
      const ev = evs.get(all[0].event)
      if (!ev) continue
      // 同一家對同一事件只畫一點:取最多則所在的欄(平手以事件所屬欄優先),分數取該欄各則平均並四捨五入
      const cnt = new Map<string, number>()
      for (const r of all) cnt.set(r.column, (cnt.get(r.column) ?? 0) + 1)
      const top = Math.max(...cnt.values())
      const col = [...cnt].filter(([, n]) => n === top).map(([c]) => c).includes(ev.column) ? ev.column : [...cnt].find(([, n]) => n === top)![0]
      const inCol = all.filter((r) => r.column === col)
      const mean = inCol.reduce((a, r) => a + r.score, 0) / inCol.length
      const score = Math.sign(mean) * Math.round(Math.abs(mean))
      const rep = [...inCol].sort((x, y) => Math.abs(x.score - mean) - Math.abs(y.score - mean))[0]
      out.push({ key: rep.url, outlet: rep.outlet, col: COLUMNS.indexOf(col as never), score, evTitle: ev.title, evColumn: ev.column, base: ev.base, baseReason: ev.baseReason, rep, all })
    }
    for (const ev of EVENTS) {
      out.push({ key: `judge|${ev.id}`, outlet: JUDGE, col: COLUMNS.indexOf(ev.column), score: ev.base, evTitle: ev.title, evColumn: ev.column, base: ev.base, baseReason: ev.baseReason, all: [] })
    }
    return out
}

function Scatter() {
  const [hover, setHover] = useState<string | null>(null)
  const [locked, setLocked] = useState<string | null>(null)
  const [picked, setPicked] = useState<Point | null>(null)
  const [tip, setTip] = useState<Point | null>(null)
  const active = hover ?? locked

  const points = useMemo<Point[]>(() => buildPoints(), [])

  const cw = (W - M.l - M.r) / COLUMNS.length
  const ch = (H - M.t - M.b) / (Y_LEVELS.length - 1)
  /** 點離格子中心的隨機偏移,限制在格子內,不會跳到相鄰的欄或分數 */
  const px = (p: Point) => M.l + cw * (p.col + 0.5) + (rand(p.key, 1) - 0.5) * cw * 0.6
  const py = (p: Point) => M.t + (4 - p.score) * ch + (rand(p.key, 2) - 0.5) * ch * 0.6

  const shown = points.filter((p) => !active || p.outlet === active)

  const legendItem = (o: string) => {
    const { color, shape } = styleOf(o)
    const n = points.filter((p) => p.outlet === o).length
    return (
      <li key={o}>
        <button
          type="button"
          className={`cov-leg${locked === o ? ' on' : ''}`}
          onMouseEnter={() => setHover(o)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(o)}
          onBlur={() => setHover(null)}
          onClick={() => setLocked(locked === o ? null : o)}
          aria-pressed={locked === o}
        >
          <svg width="16" height="16" viewBox="-8 -8 16 16" fill={color} aria-hidden><Mark shape={shape} r={5} /></svg>
          {o}
          {n > 0 && <small>{n}</small>}
        </button>
      </li>
    )
  }

  return (
    <div>
      <div className="cov-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="cov-chart" role="img" aria-label="報導評分散點圖">
        {Y_LEVELS.map((y) => (
          <g key={y}>
            <line x1={M.l} x2={W - M.r} y1={M.t + (4 - y) * ch} y2={M.t + (4 - y) * ch} className={y === 0 ? 'cov-zero' : 'cov-grid'} />
          </g>
        ))}
        <text x={M.l - 6} y={M.t + (H - M.t - M.b) / 4} textAnchor="end" className="cov-tick">↑ 正向</text>
        <text x={M.l - 6} y={M.t + ((H - M.t - M.b) * 3) / 4} textAnchor="end" className="cov-tick">↓ 負向</text>
        {COLUMNS.map((c, i) => (
          <g key={c}>
            {i > 0 && <line x1={M.l + cw * i} x2={M.l + cw * i} y1={M.t} y2={H - M.b} className="cov-grid" />}
            <text x={M.l + cw * (i + 0.5)} y={H - 10} textAnchor="middle" className="cov-tick">{c}</text>
          </g>
        ))}
        {shown.map((p, i) => {
          const { color, shape } = styleOf(p.outlet)
          return (
            <g
              key={`${p.key}|${i}`}
              transform={`translate(${px(p)},${py(p)})`}
              style={{ fill: color }}
              fillOpacity={p.outlet === JUDGE ? 0.9 : 0.75}
              stroke="var(--card)"
              strokeWidth={0.8}
              className="cov-point"
              tabIndex={0}
              onMouseEnter={() => { setPicked(p); setTip(p) }}
              onMouseLeave={() => setTip(null)}
              onFocus={() => { setPicked(p); setTip(p) }}
              onBlur={() => setTip(null)}
              onClick={() => setPicked(p)}
            >
              <Mark shape={shape} />
              <title>{`${p.outlet}|${p.score > 0 ? '+' : ''}${p.score}|${p.rep?.title ?? p.evTitle}`}</title>
            </g>
          )
        })}
      </svg>
      {tip && (
        <div className="cov-tip" style={{ left: `${(px(tip) / W) * 100}%`, top: `${(py(tip) / H) * 100}%` }}>
          <strong>{tip.outlet}</strong> {tip.score > 0 ? '+' : ''}{tip.score}<br />{tip.rep?.title ?? tip.evTitle}
        </div>
      )}
      </div>

      <ul className="cov-legend" aria-label="媒體圖例,點選只顯示該家">
        <li>
          <button type="button" className={`cov-leg cov-all${!active ? ' on' : ''}`} onClick={() => { setLocked(null); setHover(null) }}>
            全部
          </button>
        </li>
        <li className="cov-group">查核團隊的判斷</li>
        {legendItem(JUDGE)}
        <li className="cov-group">來源 7 家</li>
        {CORE_OUTLETS.map(legendItem)}
        <li className="cov-group">比對的其他媒體</li>
        {OTHER_OUTLETS.map(legendItem)}
      </ul>

      <div className="cov-detail" aria-live="polite">
        {picked ? (
          <>
            <p><strong>{picked.evTitle}</strong></p>
            {picked.rep ? (
              <>
                <p>
                  {picked.outlet}:<a href={picked.rep.url} target="_blank" rel="noreferrer">{picked.rep.title}</a>
                </p>
                <p>
                  標題帶給「{COLUMNS[picked.col]}」的印象分:{picked.score > 0 ? '+' : ''}{picked.score}(只依標題判定)。
                  {COLUMNS[picked.col] !== picked.evColumn
                    ? <>事件本身歸在「{picked.evColumn}」,但標題的寫法把印象導向「{COLUMNS[picked.col]}」,所以畫在這一欄。</>
                    : <>事件本身的最終裁決分 {picked.base > 0 ? '+' : ''}{picked.base}({picked.baseReason})。</>}
                </p>
                {picked.all.length > 1 && (
                  <details>
                    <summary>{picked.outlet}對這個事件共 {picked.all.length} 則報導,只畫一點(取平均後四捨五入)</summary>
                    <ul>
                      {picked.all.map((r) => (
                        <li key={r.url}>
                          <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>({r.column} {r.score > 0 ? '+' : ''}{r.score})
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p>
                事實分析(查核團隊判斷):這個事件歸在「{picked.evColumn}」,事件本身的分數 {picked.base > 0 ? '+' : ''}{picked.base}。理由:{picked.baseReason}。
                這是只看事件本身、不看任何媒體標題的判斷,可能有誤。
              </p>
            )}
          </>
        ) : (
          <p className="cov-hint">移到或點選圖上的點,這裡顯示該則報導與評分理由;星形是查核團隊對事件本身的判斷。</p>
        )}
      </div>
    </div>
  )
}

/** 各媒體與「事實分析」的比較:只看該媒體有報導的事件 */
function compare(points: Point[], outlet: string) {
  const judge = new Map(points.filter((p) => p.outlet === JUDGE).map((p) => [p.evTitle, p]))
  const mine = points.filter((p) => p.outlet === outlet)
  const pairs = mine.map((p) => ({ p, j: judge.get(p.evTitle)! })).filter((x) => x.j)
  if (!pairs.length) return null
  const same = pairs.filter(({ p, j }) => p.col === j.col)
  const dir = same.filter(({ p, j }) => Math.sign(p.score) === Math.sign(j.score)).length
  const bias = same.length ? same.reduce((a, { p, j }) => a + (p.score - j.score), 0) / same.length : 0
  // 分布相似度:把(政黨欄,分數)當格子,比較兩邊各格子的點數,取重疊比例
  const cell = (x: Point) => `${x.col}|${x.score}`
  const hm = new Map<string, number>()
  const hj = new Map<string, number>()
  for (const { p, j } of pairs) {
    hm.set(cell(p), (hm.get(cell(p)) ?? 0) + 1)
    hj.set(cell(j), (hj.get(cell(j)) ?? 0) + 1)
  }
  let overlap = 0
  for (const [k, v] of hm) overlap += Math.min(v, hj.get(k) ?? 0)
  return { n: pairs.length, overlap: overlap / pairs.length, dir: dir / pairs.length, bias }
}

/** 各媒體標題語氣統計與和事實分析的相似度 */
function ToneTable() {
  const points = useMemo(() => buildPoints(), [])
  const rows = OUTLETS.map((o) => {
    const rs = REPORTS.filter((r) => r.outlet === o)
    const byCol = (c: string) => {
      const xs = rs.filter((r) => r.column === c)
      return { n: xs.length, avg: xs.length ? xs.reduce((a, r) => a + r.score, 0) / xs.length : 0 }
    }
    const d = byCol('民進黨')
    const k = byCol('國民黨')
    const inten = (c: string) => {
      const xs = rs.filter((r) => r.column === c)
      return { n: xs.length, avg: xs.length ? xs.reduce((a, r) => a + intensityOf(r.title).score, 0) / xs.length : 0 }
    }
    let verdict = '樣本不足'
    if (d.n >= 5 && k.n >= 5) {
      const diff = d.avg - k.avg
      verdict = Math.abs(diff) < 0.15
        ? '看不出明顯差異'
        : diff < 0 ? '對民進黨相關事件較負面' : '對國民黨相關事件較負面'
    }
    return { o, n: rs.length, d, k, di: inten('民進黨'), ki: inten('國民黨'), verdict, c: compare(points, o) }
  }).filter((r) => r.n > 0)
  const f = (x: { n: number; avg: number }) => (x.n ? `${x.avg > 0 ? '+' : ''}${x.avg.toFixed(2)}(${x.n})` : '—')
  const g = (x: { n: number; avg: number }) => (x.n ? x.avg.toFixed(2) : '—')
  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <div className="cov-scroll">
      <table className="cov-table">
        <thead>
          <tr>
            <th>媒體</th><th>則數</th><th>民進黨事件平均</th><th>國民黨事件平均</th>
            <th title="該媒體在民進黨欄的標題用字激烈程度平均,0 到 3">民進黨用字激烈度</th>
            <th title="該媒體在國民黨欄的標題用字激烈程度平均,0 到 3">國民黨用字激烈度</th>
            <th title="把(政黨欄,分數)當格子,比較該媒體與事實分析在各格的點數重疊比例,100% 為完全相同">分布相似度</th>
            <th title="與事實分析在同一政黨欄、且正負方向相同的事件比例">方向一致</th>
            <th title="同一政黨欄內,媒體分數減事實分析分數的平均;正值代表比事實更正面">平均偏差</th>
            <th>判斷</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.o}>
              <td>{r.o}</td><td>{r.n}</td><td>{f(r.d)}</td><td>{f(r.k)}</td><td>{g(r.di)}</td><td>{g(r.ki)}</td>
              <td>{r.c ? `${pct(r.c.overlap)}(${r.c.n})` : '—'}</td>
              <td>{r.c ? pct(r.c.dir) : '—'}</td>
              <td>{r.c ? `${r.c.bias > 0 ? '+' : ''}${r.c.bias.toFixed(2)}` : '—'}</td>
              <td>{r.verdict}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}


/** 各政黨欄的標題用字激烈程度:灰條是全體平均,每個點是一則報導的分數(不看正負、不看事實分析) */
const IH = 300
const IM = { l: 44, r: 16, t: 14, b: 34 }
const I_LEVELS = [3, 2, 1, 0]
const I_NAMES = ['平鋪直敘', '輕度', '中度', '激烈']

interface IRow {
  r: Report
  score: number
  words: string[]
  col: number
}

function IntensityChart() {
  const [hover, setHover] = useState<string | null>(null)
  const [locked, setLocked] = useState<string | null>(null)
  const [picked, setPicked] = useState<IRow | null>(null)
  const [tip, setTip] = useState<IRow | null>(null)
  const [showAll, setShowAll] = useState(false)
  const active = hover ?? locked

  const rows = useMemo<IRow[]>(
    () =>
      REPORTS.map((r) => {
        const it = intensityOf(r.title)
        return { r, score: it.score, words: it.words, col: COLUMNS.indexOf(r.column as never) }
      }).filter((x) => x.col >= 0),
    [],
  )
  const colAvg = useMemo(
    () => COLUMNS.map((_, i) => {
      const xs = rows.filter((x) => x.col === i)
      return { n: xs.length, avg: xs.length ? xs.reduce((a, x) => a + x.score, 0) / xs.length : 0 }
    }),
    [rows],
  )

  const cw = (W - IM.l - IM.r) / COLUMNS.length
  const ch = (IH - IM.t - IM.b) / 3
  const y = (v: number) => IM.t + (3 - v) * ch
  const lane = (o: string) => 0.1 + (0.8 * OUTLETS.indexOf(o)) / (OUTLETS.length - 1)
  const px = (x: IRow) => IM.l + cw * (x.col + lane(x.r.outlet)) + (rand(x.r.url, 1) - 0.5) * cw * 0.05
  /** 0 分只往上錯開、3 分只往下錯開,不會畫出 0 到 3 的範圍;1、2 分上下都可 */
  const py = (x: IRow) => {
    const j = rand(x.r.url, 2)
    if (x.score === 0) return y(0) - j * ch * 0.5
    if (x.score === 3) return y(3) + j * ch * 0.5
    return y(x.score) + (j - 0.5) * ch * 0.55
  }

  const shown = rows.filter((x) => !active || x.r.outlet === active)

  const legendItem = (o: string) => {
    const { color, shape } = styleOf(o)
    const n = rows.filter((x) => x.r.outlet === o).length
    return (
      <li key={o}>
        <button
          type="button"
          className={`cov-leg${locked === o ? ' on' : ''}`}
          onMouseEnter={() => setHover(o)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(o)}
          onBlur={() => setHover(null)}
          onClick={() => setLocked(locked === o ? null : o)}
          aria-pressed={locked === o}
        >
          <svg width="16" height="16" viewBox="-8 -8 16 16" fill={color} aria-hidden><Mark shape={shape} r={5} /></svg>
          {o}
          {n > 0 && <small>{n}</small>}
        </button>
      </li>
    )
  }

  const top = useMemo(
    () => [...shown].sort((a, b) => b.score - a.score || b.words.length - a.words.length).slice(0, 5),
    [shown],
  )
  const tableRows = useMemo(
    () => (showAll ? [...shown].sort((a, b) => b.score - a.score || a.r.outlet.localeCompare(b.r.outlet)) : []),
    [shown, showAll],
  )

  return (
    <div>
      <div className="cov-wrap">
        <svg viewBox={`0 0 ${W} ${IH}`} className="cov-chart" role="img" aria-label="各則標題用字激烈程度散點圖">
          {I_LEVELS.map((v) => (
            <g key={v}>
              <line x1={IM.l} x2={W - IM.r} y1={y(v)} y2={y(v)} className={v === 0 ? 'cov-zero' : 'cov-grid'} />
              <text x={IM.l - 6} y={y(v) + 4} textAnchor="end" className="cov-tick">{I_NAMES[v]}</text>
            </g>
          ))}
          {COLUMNS.map((c, i) => (
            <g key={c}>
              {i > 0 && <line x1={IM.l + cw * i} x2={IM.l + cw * i} y1={IM.t} y2={IH - IM.b} className="cov-grid" />}
              <rect x={IM.l + cw * i + 6} y={y(colAvg[i].avg)} width={cw - 12} height={Math.max(0, y(0) - y(colAvg[i].avg))} className="cov-bar" />
              <text x={IM.l + cw * (i + 0.5)} y={IH - 18} textAnchor="middle" className="cov-tick">{c}</text>
              <text x={IM.l + cw * (i + 0.5)} y={IH - 4} textAnchor="middle" className="cov-tick">
                {colAvg[i].n} 則・平均 {colAvg[i].avg.toFixed(2)}
              </text>
            </g>
          ))}
          {shown.map((x) => {
            const { color, shape } = styleOf(x.r.outlet)
            return (
              <g
                key={x.r.url}
                transform={`translate(${px(x)},${py(x)})`}
                style={{ fill: color }}
                fillOpacity={0.75}
                stroke="var(--card)"
                strokeWidth={0.6}
                className="cov-point"
                tabIndex={0}
                onMouseEnter={() => { setPicked(x); setTip(x) }}
                onMouseLeave={() => setTip(null)}
                onFocus={() => { setPicked(x); setTip(x) }}
                onBlur={() => setTip(null)}
                onClick={() => setPicked(x)}
              >
                <Mark shape={shape} r={3.4} />
                <title>{`${x.r.outlet}|激烈度 ${x.score}|${x.r.title}`}</title>
              </g>
            )
          })}
        </svg>
        {tip && (
          <div className="cov-tip" style={{ left: `${(px(tip) / W) * 100}%`, top: `${(py(tip) / IH) * 100}%` }}>
            <strong>{tip.r.outlet}</strong> 激烈度 {tip.score}<br />{tip.r.title}
          </div>
        )}
      </div>

      <ul className="cov-legend" aria-label="媒體圖例,點選只顯示該家">
        <li>
          <button type="button" className={`cov-leg cov-all${!active ? ' on' : ''}`} onClick={() => { setLocked(null); setHover(null); setPicked(null) }}>
            全部
          </button>
        </li>
        <li className="cov-group">來源 7 家</li>
        {CORE_OUTLETS.map(legendItem)}
        <li className="cov-group">比對的其他媒體</li>
        {OTHER_OUTLETS.map(legendItem)}
      </ul>

      <div className="cov-detail" aria-live="polite">
        {picked ? (
          <>
            <p>
              {picked.r.outlet}:<a href={picked.r.url} target="_blank" rel="noreferrer">{picked.r.title}</a>
            </p>
            <p>
              標題用字激烈度:<strong>{picked.score}</strong>({I_NAMES[picked.score]});命中字眼:{picked.words.join('、') || '無'}。畫在「{COLUMNS[picked.col]}」欄。
            </p>
          </>
        ) : (
          <>
            <p><strong>{active ? `${active}` : '全部報導'}用字最激烈的 5 則標題</strong>(移到或點選圖上的點,看該則的分數)</p>
            <ol>
              {top.map((x) => (
                <li key={x.r.url}>
                  <a href={x.r.url} target="_blank" rel="noreferrer">{x.r.title}</a>
                  ({x.r.outlet}・激烈度 {x.score}・命中:{x.words.join('、') || '無'})
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <details onToggle={(e) => setShowAll((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>逐則列表:每則標題的用字激烈度({shown.length} 則{active ? `,${active}` : ''})</summary>
        {showAll && (
          <div className="cov-scroll cov-list">
            <table className="cov-table">
              <thead>
                <tr><th>激烈度</th><th>政黨欄</th><th>媒體</th><th>標題</th><th>命中字眼</th></tr>
              </thead>
              <tbody>
                {tableRows.map((x) => (
                  <tr key={x.r.url}>
                    <td>{x.score}</td>
                    <td>{COLUMNS[x.col]}</td>
                    <td>{x.r.outlet}</td>
                    <td><a href={x.r.url} target="_blank" rel="noreferrer">{x.r.title}</a></td>
                    <td>{x.words.join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </div>
  )
}

/** 各家媒體對每個政黨欄的平均情緒值(用字激烈度)與中度以上(2 分以上)的比例 */
function IntensityTable() {
  const rows = useMemo(
    () => REPORTS.map((r) => ({ r, score: intensityOf(r.title).score })),
    [],
  )
  const cell = (xs: { score: number }[]) =>
    xs.length ? { n: xs.length, avg: xs.reduce((a, x) => a + x.score, 0) / xs.length, mid: xs.filter((x) => x.score >= 2).length / xs.length } : null
  const outlets = OUTLETS.filter((o) => rows.some((x) => x.r.outlet === o))
  /** 兩種數值各用自己的色相,並以實際最小到最大拉開色階(最深約 80%) */
  const all = outlets.flatMap((o) => COLUMNS.map((c) => cell(rows.filter((x) => x.r.outlet === o && x.r.column === c)))).filter((c): c is NonNullable<ReturnType<typeof cell>> => !!c)
  const range = (f: (c: NonNullable<ReturnType<typeof cell>>) => number) => {
    const v = all.map(f)
    return { lo: Math.min(...v), hi: Math.max(...v) }
  }
  const rAvg = range((c) => c.avg)
  const rMid = range((c) => c.mid)
  const shade = (v: number, r: { lo: number; hi: number }, hue: string) => ({
    background: `color-mix(in srgb, ${hue} ${Math.round(((v - r.lo) / (r.hi - r.lo || 1)) * 80)}%, transparent)`,
  })
  const show = (c: ReturnType<typeof cell>) =>
    c ? (
      <>
        <td style={shade(c.avg, rAvg, '#e8590c')}>{c.avg.toFixed(2)}</td>
        <td style={shade(c.mid, rMid, '#1c7ed6')}>{Math.round(c.mid * 100)}%</td>
        <td className="cov-n">{c.n}</td>
      </>
    ) : (
      <><td>—</td><td>—</td><td className="cov-n">0</td></>
    )
  const line = (label: string, xs: typeof rows) => (
    <tr key={label}>
      <td>{label}</td>
      {COLUMNS.map((c) => <Fragment key={c}>{show(cell(xs.filter((x) => x.r.column === c)))}</Fragment>)}
    </tr>
  )
  return (
    <div className="cov-scroll">
      <table className="cov-table cov-itable">
        <thead>
          <tr>
            <th rowSpan={2}>媒體</th>
            {COLUMNS.map((c) => <th key={c} colSpan={3}>{c}</th>)}
          </tr>
          <tr>
            {COLUMNS.map((c) => (
              <Fragment key={c}>
                <th title="該媒體在這個政黨欄的標題用字激烈度平均,0 到 3">平均情緒值</th>
                <th title="用字激烈度 2 分(中度)以上的報導占該格全部報導的比例">中度以上</th>
                <th>則</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {outlets.map((o) => line(o, rows.filter((x) => x.r.outlet === o)))}
          {line('全部媒體', rows)}
        </tbody>
      </table>
    </div>
  )
}

const EVENT_DATES = EVENTS.map((e) => e.date).sort()
const EVENT_SPAN = `${EVENT_DATES[0].slice(0, 4)} 至 ${EVENT_DATES[EVENT_DATES.length - 1].slice(0, 4)} 年`

export function CoverageDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog cov-dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
    >
      <div className="dialog-head">
        <h2>媒體立場分析</h2>
        <button type="button" onClick={() => ref.current?.close()} aria-label="關閉">×</button>
      </div>

      <p className="cov-note">
        <strong>查核團隊的判斷,非事實認定。</strong>
        下列分數與「事實分析」是查核團隊依公開資料所做的主觀判斷,可能有誤,也不代表任何媒體或候選人的實際立場。發現錯誤請回報。
      </p>

      <p className="cov-lead">
        本站收錄 {OUTLETS.length} 家媒體的報導,分析各家新聞的<strong className="cov-hl">標題</strong>與<strong className="cov-hl">事實</strong>一致性。
        下面把 {EVENTS.length} 個事件、{REPORTS.length} 則報導畫成圖,看各家標題留給人的印象。
        採用的新聞:事件發生於 <strong className="cov-hl">{EVENT_SPAN}</strong>,查詢日期 {PILOT_QUERY_DATE}。
      </p>

      <section>
        <h3>各家報導的印象 × 事件所屬政黨</h3>
        <p className="cov-sub">
          一點是一家媒體對一個事件的報導(同家多則合併為一點)。星形是查核團隊只看事實的判斷。點選下方名稱只看該家,按「全部」恢復。
        </p>
        <Scatter />
      </section>

      <section>
        <h3>各政黨相關新聞的用字激烈程度</h3>
        <p className="cov-sub">
          只看標題用字有多激烈(0 平鋪直敘到 3 激烈),不分正面負面,也不含事實分析。每個點是一則報導的分數(同一格內點會重疊,位置只是錯開,不代表分數不同),灰條是該政黨欄全部報導的平均。下方可展開逐則列表。
        </p>
        <IntensityChart />
      </section>

      <section>
        <h3>各家媒體對各政黨的平均情緒值</h3>
        <p className="cov-sub">
          平均情緒值是標題用字激烈度的平均(0 到 3);中度以上是激烈度 2 分以上的報導占比;「則」是該格的報導數,少於 5 則的格子請勿過度解讀。「平均情緒值」用橘色、「中度以上」用藍色,各自從最低到最高拉開色階,顏色越深代表越高。
        </p>
        <IntensityTable />
      </section>

      <section>
        <h3>各家平均語氣與和事實分析的相似度</h3>
        <p className="cov-sub">
          平均為標題分數的平均,括號為則數。相似度只比較該媒體有報導的事件;滑鼠移到欄名看算法。只描述這批資料,不代表媒體整體立場。
        </p>
        <ToneTable />
      </section>

      <details>
        <summary>評分方式</summary>
        <ul>
          <li>報導的點:這則標題的寫法讓觀眾對某個政黨欄產生多大的正面或負面印象,−3 到 +3。與事實對錯無關。</li>
          <li>標題平鋪直敘就是 0;只有用字帶引導(如「慘了」「挨轟」「捷報」「打臉」)才給分。標題可把矛頭轉向另一陣營,那一點就畫在另一欄。</li>
          <li>星形(事實分析):只看事件本身。有官方認定、當事人承認或判決才給負分;只有質疑、當事人否認、尚無結論,給 0。</li>
          <li>主詞不是該政黨的事件(被害、被攻擊、不起訴、駁回、互批)不算該黨負面。</li>
          <li>分數由查核團隊逐則判定,可能有誤。</li>
          <li>
            用字激烈度(0 到 3):依標題字眼詞表自動判定,不看正負。3 級如「怒轟」「痛批」「翻車」「噁心」;2 級如「打臉」「踢爆」「轟」「嗆」「爆」;1 級如「質疑」「批評」「要求」「澄清」。
            取命中字眼的最高級;同時命中兩個以上 2 級以上字眼算 3;已有字眼且用驚嘆號再加 1,最高 3;沒有命中就是 0。
          </li>
        </ul>
      </details>

      <details>
        <summary>方法與限制</summary>
        <ul>
          <li>以搜尋引擎限定各媒體網域查詢事件關鍵字,查到標題才收錄;查不到不代表沒有報導。</li>
          <li>樣本有限,不可據此判斷任何媒體是否偏頗。</li>
          <li>事件取自本站已收錄的紀事,這些紀事當初主要依少數幾家媒體蒐集,所以那幾家的覆蓋會偏高,這是樣本造成的偏差。</li>
          <li>用字激烈度只比對詞表,不理解語意:同一個字在不同上下文可能意思不同(例如「爆」),也可能漏掉詞表之外的激烈寫法,僅供參考。</li>
          <li>評分只依標題,沒有逐篇讀內文。事件取自本站已收錄的紀事,已排除提名、登記、個人經歷介紹等非事件性紀事。</li>
        </ul>
      </details>
    </dialog>
  )
}
