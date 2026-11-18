import type { Row } from './App'
import { n, s } from './App'
import './QualityCharts.css'

export type QualityJob = { code:string; good:number; bad:number; total:number; status:string }
export function qualityJobs(lots:Row[]):QualityJob[]{
  return [...lots].reverse().map(l=>({code:s(l,'ORDER_CODE'),good:n(l,'GOOD_QTY'),bad:n(l,'REJECTED_QTY'),total:n(l,'GOOD_QTY')+n(l,'REJECTED_QTY'),status:s(l,'STATUS')}))
}
const pct=(v:number)=>`${Math.round(v)}%`
function Ring({label,value,bad=false}:{label:string;value:number;bad?:boolean}){
  const color=bad?'#d8755d':'#4cad84'
  return <div className="qc-ring-wrap"><div className="qc-ring" style={{background:`conic-gradient(${color} ${Math.max(0,Math.min(100,value))}%, #e7eeeb 0)`}}><div><strong>{pct(value)}</strong><span>{label}</span></div></div></div>
}
function Plot({jobs,kind}:{jobs:QualityJob[];kind:'stack'|'good'|'bad'}){
  const width=620,left=42,right=16,top=19,plotW=width-left-right,plotH=170
  const labelWidth=Math.max(6,Math.floor(plotW/Math.max(1,jobs.length)/6.2))
  const labels=jobs.map(job=>{
    const parts=job.code.replace(/^WO-PLAN-/,'WO-').split(/(?<=-)/)
    const lines:string[]=[]
    let line=''
    for(const part of parts){
      if(line&&line.length+part.length>labelWidth){lines.push(line);line=''}
      if(part.length>labelWidth){if(line){lines.push(line);line=''}const chunks=part.match(new RegExp(`.{1,${labelWidth}}`,'g'))||[];lines.push(...chunks.slice(0,-1));line=chunks.at(-1)||''}
      else line+=part
    }
    if(line)lines.push(line)
    return lines
  })
  const labelLines=Math.max(1,...labels.map(lines=>lines.length))
  const height=top+plotH+23+labelLines*15+24
  const max=Math.max(1,...jobs.map(j=>kind==='stack'?j.total:kind==='good'?j.good:j.bad))
  const y=(v:number)=>top+plotH-v/max*plotH
  const x=(i:number)=>left+plotW*(i+.5)/Math.max(1,jobs.length)
  const value=(j:QualityJob)=>kind==='good'?j.good:j.bad
  const color=kind==='good'?'#4b83da':'#d8755d'
  const points=jobs.map((j,i)=>`${x(i)},${y(value(j))}`).join(' ')
  const ticks=max<=5?Array.from({length:max+1},(_,i)=>i):[0,.25,.5,.75,1].map(t=>Math.round(max*t))
  return <svg className="qc-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={kind==='stack'?'작업별 전체 생산량 중 양품과 불량의 수량':kind==='good'?'작업 순서별 양품 수량 선 그래프':'작업 순서별 불량 수량 선 그래프'}>
    {ticks.map(t=><g key={t}><line x1={left} x2={width-right} y1={y(t)} y2={y(t)} stroke="#e3eae8"/><text x={left-8} y={y(t)+4} textAnchor="end" className="qc-axis">{t}</text></g>)}
    {jobs.map((j,i)=><g key={`${j.code}-${i}`}><line x1={x(i)} x2={x(i)} y1={top} y2={top+plotH} stroke="#edf2f0"/><text x={x(i)} y={top+plotH+18} textAnchor="middle" className="qc-axis">{labels[i].map((line,number)=><tspan key={number} x={x(i)} dy={number?15:0}>{line}</tspan>)}</text><title>{`${j.code}: 양품 ${j.good}개, 불량 ${j.bad}개`}</title></g>)}
    {kind==='stack'&&jobs.map((j,i)=>{const barW=Math.min(44,plotW/Math.max(1,jobs.length)*.54);return <g key={`${j.code}-${i}`}><rect x={x(i)-barW/2} y={y(j.good)} width={barW} height={Math.max(0,top+plotH-y(j.good))} fill="#4cad84"/><rect x={x(i)-barW/2} y={y(j.total)} width={barW} height={Math.max(0,y(j.good)-y(j.total))} fill="#d8755d"/><text x={x(i)} y={Math.max(top+10,y(j.total)-6)} textAnchor="middle" className="qc-value">{j.total}</text></g>})}
    {kind!=='stack'&&<><polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{jobs.map((j,i)=><circle key={`${j.code}-${i}`} cx={x(i)} cy={y(value(j))} r="4" fill={color}><title>{`${j.code}: ${value(j)}개`}</title></circle>)}</>}
    <text x={width/2} y={height-7} textAnchor="middle" className="qc-axis">작업지시 · 왼쪽에서 오른쪽</text>
  </svg>
}
export default function QualityCharts({allJobs,visibleJobs,rangeLabel}:{allJobs:QualityJob[];visibleJobs:QualityJob[];rangeLabel:string}){
  const measured=allJobs.filter(j=>j.total>0),good=measured.reduce((a,j)=>a+j.good,0),bad=measured.reduce((a,j)=>a+j.bad,0)
  const overall=good+bad?good/(good+bad)*100:0
  const average=measured.length?measured.reduce((a,j)=>a+j.good/j.total*100,0)/measured.length:0
  return <section className="qc-grid" aria-label="품질 실적 차트 네 개">
    <div className="card qc-card"><div className="qc-heading"><div><small>QUALITY PERFORMANCE</small><h2>전체와 작업당 평균 품질</h2></div><span>실적 있는 작업 {measured.length}건</span></div><div className="qc-rings"><Ring label="전체 양품률" value={overall}/><Ring label="작업당 평균 양품률" value={average}/><Ring label="작업당 평균 불량률" value={measured.length?100-average:0} bad/></div><p className="fine">전체: 양품 {good}개 / 불량 {bad}개. 작업당 평균은 실적이 있는 각 작업의 비율을 동일한 가중치로 평균합니다. 현재 검사는 규칙 기반 판정이며 영상 판정은 도입 예정입니다.</p></div>
    <div className="card qc-card"><div className="qc-heading"><div><small>ORDER MIX</small><h2>작업별 양품 · 불량 구성</h2></div><span>{rangeLabel}</span></div><div className="qc-legend"><i className="good"/>양품 <i className="bad"/>불량</div>{visibleJobs.length?<Plot jobs={visibleJobs} kind="stack"/>:<p className="mes-muted">표시할 작업 실적이 없습니다.</p>}</div>
    <div className="card qc-card"><div className="qc-heading"><div><small>GOOD OUTPUT</small><h2>작업별 양품 수량</h2></div><span>{rangeLabel}</span></div>{visibleJobs.length?<Plot jobs={visibleJobs} kind="good"/>:<p className="mes-muted">표시할 작업 실적이 없습니다.</p>}</div>
    <div className="card qc-card"><div className="qc-heading"><div><small>REJECT OUTPUT</small><h2>작업별 불량 수량</h2></div><span>{rangeLabel}</span></div>{visibleJobs.length?<Plot jobs={visibleJobs} kind="bad"/>:<p className="mes-muted">표시할 작업 실적이 없습니다.</p>}</div>
  </section>
}
