import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import ProductionOperations from './ProductionOperations'
import QualityCharts, { qualityJobs } from './QualityCharts'
import SelectMenu from './SelectMenu'
import TwinHost from './TwinHost'
import './App.css'
import './MES.css'

export type Row = Record<string, string | number>
export type Page = 'home' | 'planning' | 'orders' | 'materials' | 'trace' | 'quality' | 'shipping' | 'process' | 'equipment' | 'events'
export type Plc = { connected:boolean; message:string; sampledAt:string; target:number; launched:number; rejected:number; packed:number; lineExit:number; machineState:number; assemblyPhase:number; inspectionPhase:number; packingPhase:number; mesStop:boolean; motorRunning:boolean }
export type Data = { plc:Plc; orders:Row[]; inventory:Row[]; events:Row[]; plans:Row[]; lots:Row[]; bom:Row[]; shipments:Row[]; productionLots:Row[] }
const initial:Data = {plc:{connected:false,message:'연결 중',sampledAt:'',target:0,launched:0,rejected:0,packed:0,lineExit:0,machineState:0,assemblyPhase:0,inspectionPhase:0,packingPhase:0,mesStop:true,motorRunning:false},orders:[],inventory:[],events:[],plans:[],lots:[],bom:[],shipments:[],productionLots:[]}
export const field=(r:Row,k:string)=>r[k.toUpperCase()]??r[k.toLowerCase()]
export const n=(r:Row,k:string)=>Number(field(r,k)??0)
export const s=(r:Row,k:string)=>String(field(r,k)??'')
const names:Record<Page,string>={home:'운영 현황',planning:'생산 계획',orders:'작업 지시',materials:'자재 입고 · 재고',trace:'생산 LOT · 추적',quality:'품질 분석',shipping:'출고 관리',process:'공정 · 3D 현장',equipment:'설비 · 로봇',events:'이벤트 이력'}
const menus:Page[]=['home','planning','orders','materials','trace','quality','shipping','process','equipment','events']
const eventNames:Record<string,string>={MATERIAL_CONSUMED:'본체·뚜껑 투입',REJECTED:'불량 분류',PACKED:'양품 포장',LOADED_DIGITAL:'차량 디지털 적재',TRUCK_DEPARTED_DIGITAL:'목표 수량 출고',PLC_COUNTER_RESET:'현장 누적 수량 초기화 감지'}
function route():Page {const hash=location.hash.slice(1) as Page;return menus.includes(hash)?hash:'home'}
async function api(url:string,method='GET'){const r=await fetch(url,{method});if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.detail||body.message||`HTTP ${r.status}`)}return r.json()}
function CardTitle({eyebrow,title,aside}:{eyebrow:string;title:string;aside?:string}){return <div className="mes-title"><div><small>{eyebrow}</small><h2>{title}</h2></div>{aside&&<span>{aside}</span>}</div>}
function Stat({label,value,unit,detail}:{label:string;value:number|string;unit?:string;detail?:string}){return <div className="mes-stat"><small>{label}</small><strong>{value}<em>{unit}</em></strong><span>{detail}</span></div>}
type Metric = {label:string;value:number|string;unit?:string;detail?:string}
const sum=(rows:Row[],key:string)=>rows.reduce((total,row)=>total+n(row,key),0)
function PageOverview({page,metrics,alert}:{page:Page;metrics:Metric[];alert?:ReactNode}){return <section className="mes-page-overview" aria-label={`${names[page]} 핵심 지표`}><div className="mes-overview-heading"><div><small>FACTORY SNAPSHOT</small><h1>{names[page]}</h1></div><span>MES 저장 실적 · 현장 현재값</span></div>{alert}<div className={`mes-page-metrics ${metrics.length>4?'six':''}`}>{metrics.map(metric=><Stat key={metric.label} {...metric}/>)}</div></section>}
function HomeInsights({data,metrics}:{data:Data;metrics:Metric[]}){
  const jobs=qualityJobs(data.productionLots)
  return <><section className="mes-home-kpis" aria-label="누적 공장 실적"><div className="mes-section-heading"><h2>공장 누적 실적</h2><span>전체 작업지시의 저장된 실적</span></div><div className="mes-page-metrics">{metrics.map(metric=><Stat key={metric.label} {...metric}/>)}</div></section><QualityCharts allJobs={jobs} visibleJobs={jobs.slice(-8)} rangeLabel="최근 8개 작업"/></>
}
function CurrentWork({order,plc}:{order:Row|null;plc:Plc}){
  const running=order&&['RUNNING','PAUSED'].includes(s(order,'STATUS'))
  if(!running)return null
  return <section className="mes-current-work"><div className="mes-section-heading"><h2>현재 생산 작업</h2><span>{running?`${s(order,'ORDER_CODE')} · 실시간 수신값`:'진행 중인 작업 없음 · 이전 현장 누적 수량는 현재 실적으로 표시하지 않음'}</span></div><div className="mes-stats"><Stat label="투입 세트" value={running?plc.launched:'진행 중인 작업 없음'} detail={running?'본체 1 + 뚜껑 1':undefined}/><Stat label="불량 분류" value={running?plc.rejected:'진행 중인 작업 없음'} detail={running?'양품 목표 제외':undefined}/><Stat label="양품 포장" value={running?plc.packed:'진행 중인 작업 없음'} detail={running?'포장 완료':undefined}/><Stat label="출구 통과" value={running?`${plc.lineExit} / ${n(order,'TARGET_QTY')}`:'진행 중인 작업 없음'} detail={running?'출고 수량 기준':undefined}/></div></section>
}
function stationLabel(phase:number,plc:Plc){if(!plc.connected)return '연결 대기';if(plc.mesStop)return '허가 없음';if(plc.machineState===3)return '시작 대기';if(plc.machineState===6)return '목표 완료';return phase===1?'진행 중':phase===2?'배출 중':'대기'}
const MATERIAL_MINIMUM=1000
function UpcomingAlerts({plans,stock}:{plans:Row[];stock?:Record<string,number>}){
  const now=new Date(),today=new Date(now);today.setHours(0,0,0,0)
  const upcoming=plans.filter(p=>['APPROVED','RELEASED'].includes(s(p,'STATUS'))).map(plan=>{
    const date=s(plan,'PLANNED_START').slice(0,10),time=s(plan,'PLANNED_START_TIME').slice(0,5)
    const start=new Date(`${date}T${time||'00:00'}:00`)
    return {plan,time,days:Math.round((new Date(`${date}T00:00:00`).getTime()-today.getTime())/86400000),hours:(start.getTime()-now.getTime())/3600000}
  }).filter(x=>Number.isFinite(x.hours)&&(x.time?x.hours>-24&&x.hours<=24:x.days>=0&&x.days<=1)).sort((a,b)=>a.hours-b.hours)
  const low=stock?(['BODY','LID'] as const).filter(sku=>(stock[sku]??0)<MATERIAL_MINIMUM):[]
  return <div className="mes-alerts" aria-live="polite">{upcoming.map(({plan,time,days,hours})=><div className="mes-alert" key={s(plan,'ID')}><strong>● {time?(hours<=0?'시작 예정 시각 도래':hours<=6?`${Math.ceil(hours)}시간 이내 시작`:days===0?'오늘 시작 예정':'내일 시작 예정'):`${days===0?'오늘':'내일'} 시작 예정`}</strong><span>{s(plan,'ORDER_CODE')||s(plan,'PLAN_CODE')} · 목표 양품 {n(plan,'TARGET_QTY')}개 · {s(plan,'PLANNED_START').slice(0,10)} {time||'시각 미등록'} · {s(plan,'STATUS')==='APPROVED'?'작업지시 발행 필요':'현장 시작 가능'}</span><a href={s(plan,'STATUS')==='APPROVED'?'#planning':'#orders'}>확인 →</a></div>)}{low.map(sku=><div className="mes-alert" key={sku}><strong>● {sku==='BODY'?'본체':'뚜껑'} 안전재고 부족</strong><span>현재 {stock?.[sku]??0}개 · 최소 {MATERIAL_MINIMUM}개 · 추가 필요 {MATERIAL_MINIMUM-(stock?.[sku]??0)}개</span><a href="#materials">자재 입고 →</a></div>)}{!upcoming.length&&!low.length&&<div className="mes-alert mes-alert-clear">긴급 일정·자재 부족 알림 없음</div>}</div>
}
function CurrentOrderFocus({order}:{order:Row|null}){
  const current=order&&['RUNNING','PAUSED'].includes(s(order,'STATUS'))
  return <section className={`mes-order-focus ${current?'':'single'}`}><div><small>CURRENT ORDER</small><strong>{current?s(order,'ORDER_CODE'):'현재 진행 중인 작업 없음'}</strong><span>{current?`${s(order,'STATUS')} · 목표 양품 ${n(order,'TARGET_QTY')}개`:'새 작업이 시작되면 현재 실적을 표시합니다.'}</span></div>{current&&<><div className="mes-focus-good"><small>현재 작업 양품</small><strong>{n(order,'LAST_PACKED')}</strong><span>개 포장 완료</span></div><div className="mes-focus-bad"><small>현재 작업 불량</small><strong>{n(order,'LAST_REJECTED')}</strong><span>개 분류 완료</span></div></>}</section>
}

function OrderExecution({data,order,status,busy,startBlock,actionMessage,actionOk,onSelect,onCommand}:{data:Data;order:Row|null;status:string;busy:boolean;startBlock:string;actionMessage:string;actionOk:boolean;onSelect:(id:number)=>void;onCommand:(action:string)=>void}){
  const id=order?n(order,'ID'):0,target=order?n(order,'TARGET_QTY'):0
  const selectable=data.orders.filter(o=>['CREATED','RUNNING','PAUSED','NEEDS_RESET'].includes(s(o,'STATUS')))
  return <>
    <CurrentOrderFocus order={order}/>
    <section className="card mes-execution">
      <CardTitle eyebrow="SHOP FLOOR EXECUTION" title="작업지시 · 현장 운전" aside={status==='NO ORDER'?'시작 대기 없음':status}/>
      <p className="mes-intro">발행된 작업지시를 선택하고 현장 상태를 확인한 뒤 생산을 시작합니다. 생산계획의 시작 예정 시각이 되어야 가동을 허가할 수 있고, 예정 시각이 지난 작업은 바로 허가할 수 있습니다.</p>
      {selectable.length>0?<div className="mes-order-picker"><div className="mes-order-picker-label"><small>01 · 작업 선택</small><strong>시작할 작업지시</strong><span>목표 양품 수량을 확인하세요.</span></div><SelectMenu className="mes-order-select-wrap" ariaLabel="시작할 작업지시 선택" disabled={busy||['RUNNING','PAUSED'].includes(status)} value={String(id)} onChange={value=>onSelect(Number(value))} options={selectable.map(o=>({value:String(n(o,'ID')),label:`${s(o,'ORDER_CODE')} · 목표 ${n(o,'TARGET_QTY')}개`}))}/></div>:<div className="mes-order-empty">시작 대기 중인 작업지시가 없습니다. 생산 계획을 승인하고 작업지시를 발행하세요.</div>}
      {order&&<><div className="mes-order-main"><strong>{s(order,'ORDER_CODE')}</strong><span>목표 양품 {target}개</span><span>상태 {status}</span></div><div className="bar"><i style={{width:`${Math.min(100,n(order,'LAST_EXIT')/Math.max(1,target)*100)}%`}}/></div><p className="sub">출구 {n(order,'LAST_EXIT')} / {target} · 불량 {n(order,'LAST_REJECTED')} · 포장 {n(order,'LAST_PACKED')}</p>{['CREATED','NEEDS_RESET'].includes(status)&&<div className={`mes-start-readiness ${startBlock?'blocked':'ready'}`} role="status"><strong>{startBlock?(startBlock.startsWith('생산계획')?'예정 시각 대기':'시작 전 확인 필요'):status==='NEEDS_RESET'?'이전 실적 보존·재개':'시작 준비 완료'}</strong><span>{startBlock||'허가할 때 이전 현장 카운터를 초기화합니다. 허가 후 현장 시작 버튼으로 가동합니다.'}</span></div>}<div className="buttons"><button disabled={busy||status!=='CREATED'||!!startBlock} onClick={()=>onCommand('start')}>가동 허가</button>{status==='NEEDS_RESET'&&<button disabled={busy||!!startBlock} onClick={()=>onCommand('recover')}>남은 수량 재개</button>}<button disabled={busy||status!=='RUNNING'} onClick={()=>onCommand('pause')}>허가 해제(정지)</button><button disabled={busy||status!=='PAUSED'} onClick={()=>onCommand('resume')}>허가 재발행</button></div>{actionMessage&&<p className={`mes-action-message ${actionOk?'ok':'fail'}`} role={actionOk?'status':'alert'}>{actionMessage}</p>}</>}
      <p className="fine">작업 시작·복구 시 이전 작업의 현장 누적 수량은 자동 초기화하고 MES 실적은 유지합니다. 본체·뚜껑 재고가 없거나 다른 작업이 가동 중이면 시작할 수 없습니다.</p>
    </section>
    <section className="card"><CardTitle eyebrow="ORDER REGISTER" title="작업지시 목록"/><div className="op-table-wrap"><table><thead><tr><th>작업번호</th><th>상태</th><th>목표 양품</th><th>투입</th><th>불량</th><th>포장</th><th>출구</th><th>생산 LOT</th></tr></thead><tbody>{data.orders.map(o=><tr key={s(o,'ID')}><td data-label="작업번호">{s(o,'ORDER_CODE')}</td><td data-label="상태">{s(o,'STATUS')}</td><td data-label="목표 양품">{n(o,'TARGET_QTY')}</td><td data-label="투입">{n(o,'LAST_LAUNCHED')}</td><td data-label="불량">{n(o,'LAST_REJECTED')}</td><td data-label="포장">{n(o,'LAST_PACKED')}</td><td data-label="출구">{n(o,'LAST_EXIT')}</td><td data-label="생산 LOT">FG-{s(o,'ORDER_CODE')}</td></tr>)}</tbody></table></div></section>
  </>
}

export default function App(){
  const [selectedOrderId,setSelectedOrderId]=useState(0)
  const [data,setData]=useState<Data>(initial),[page,setPage]=useState<Page>(route),[busy,setBusy]=useState(false),[error,setError]=useState(''),[actionMessage,setActionMessage]=useState(''),[actionOk,setActionOk]=useState(false)
  const refresh=()=>api('/api/overview').then((d:Data)=>{setData(d);setError('')}).catch(e=>setError(String(e)))
  useEffect(()=>{const onHash=()=>{setPage(route());setActionMessage('');window.scrollTo(0,0)};window.addEventListener('hashchange',onHash);return()=>window.removeEventListener('hashchange',onHash)},[])
  useEffect(()=>{refresh();const t=window.setInterval(refresh,1500);return()=>window.clearInterval(t)},[])
  const order=data.orders.find(r=>['RUNNING','PAUSED'].includes(s(r,'STATUS')))||data.orders.find(r=>n(r,'ID')===selectedOrderId&&['CREATED','NEEDS_RESET'].includes(s(r,'STATUS')))||data.orders.find(r=>s(r,'STATUS')==='CREATED')||data.orders.find(r=>s(r,'STATUS')==='NEEDS_RESET')||null,status=order?s(order,'STATUS'):'NO ORDER',id=order?n(order,'ID'):0,target=order?n(order,'TARGET_QTY'):data.plc.target||3
  const plannedPlan=order&&status==='CREATED'?data.plans.find(p=>s(p,'ORDER_CODE')===s(order,'ORDER_CODE')):undefined
  const plannedAt=plannedPlan&&s(plannedPlan,'PLANNED_START')?new Date(`${s(plannedPlan,'PLANNED_START').slice(0,10)}T${s(plannedPlan,'PLANNED_START_TIME').slice(0,5)||'00:00'}`):null
  const minutesToStart=plannedAt?Math.ceil((plannedAt.getTime()-Date.now())/60000):0
  const startBlock=['CREATED','NEEDS_RESET'].includes(status)&&!data.plc.connected?'현장 제어기 연결을 확인하세요.':
    minutesToStart>0?`생산계획 시작 예정 ${s(plannedPlan!,'PLANNED_START').slice(5,10)} ${s(plannedPlan!,'PLANNED_START_TIME').slice(0,5)||'00:00'} 이후 가동 허가 가능 (${minutesToStart>=60?`${Math.floor(minutesToStart/60)}시간 ${minutesToStart%60}분`:`${minutesToStart}분`} 남음)`:''
  const activeOrder=order&&['CREATED','RUNNING','PAUSED','NEEDS_RESET'].includes(status)?order:null
  const stock=Object.fromEntries(data.inventory.map(r=>[s(r,'SKU'),n(r,'QUANTITY')]))
  const openPlans=data.plans.filter(r=>['DRAFT','APPROVED','RELEASED','RUNNING'].includes(s(r,'STATUS')))
  const runningOrders=data.orders.filter(r=>s(r,'STATUS')==='RUNNING').length
  const queuedOrders=data.orders.filter(r=>s(r,'STATUS')==='CREATED').length
  const pausedOrders=data.orders.filter(r=>s(r,'STATUS')==='PAUSED').length
  const completedOrders=data.orders.filter(r=>s(r,'STATUS')==='COMPLETE').length
  const unreleasedPlans=data.plans.filter(r=>['DRAFT','APPROVED'].includes(s(r,'STATUS'))).length
  const approvedPlans=data.plans.filter(r=>s(r,'STATUS')==='APPROVED').length
  const goodTotal=sum(data.productionLots,'GOOD_QTY'),rejectTotal=sum(data.productionLots,'REJECTED_QTY')
  const yieldRate=goodTotal+rejectTotal?Math.round(goodTotal/(goodTotal+rejectTotal)*100):0
  const shippedTotal=sum(data.shipments,'QUANTITY')
  const usableMaterialLots=data.lots.filter(r=>n(r,'AVAILABLE_QTY')>0).length
  const emptyMaterialTypes=['BODY','LID'].filter(k=>(stock[k]??0)<=0).length
  const qualityIssueOrders=data.orders.filter(r=>n(r,'LAST_REJECTED')>0).length
  const commonMetrics:Metric[]=[{label:'진행 중 작업지시',value:runningOrders,unit:'건',detail:'현장 가동 중'},{label:'시작 대기 작업지시',value:queuedOrders,unit:'건',detail:'발행 후 현장 시작 전'}]
  const pageMetrics:Record<Page,Metric[]>={
    home:[],
    planning:[...commonMetrics,{label:'지시 미발행 계획',value:unreleasedPlans,unit:'건',detail:'초안·승인 완료 포함'},{label:'발행 가능 계획',value:approvedPlans,unit:'건',detail:'시작 예정일 확인 필요'}],
    orders:[...commonMetrics,{label:'일시 정지 작업',value:pausedOrders,unit:'건',detail:'재가동 가능'},{label:'완료 작업',value:completedOrders,unit:'건',detail:'목표 양품 출고 완료'}],
    materials:[...commonMetrics,{label:'본체 재고',value:stock.BODY??0,unit:'개',detail:'MES 가용 수량'},{label:'뚜껑 재고',value:stock.LID??0,unit:'개',detail:'MES 가용 수량'},{label:'가용 자재 LOT',value:usableMaterialLots,unit:'개',detail:`총 입고 LOT ${data.lots.length}개`},{label:'재고 0인 부재료',value:emptyMaterialTypes,unit:'종',detail:'본체·뚜껑 기준'}],
    trace:[...commonMetrics,{label:'누적 생산 LOT',value:data.productionLots.length,unit:'개',detail:'작업지시별 완제품 LOT'},{label:'누적 자재 LOT',value:data.lots.length,unit:'개',detail:`가용 ${usableMaterialLots}개`},{label:'완료 생산 LOT',value:data.productionLots.filter(r=>s(r,'STATUS')==='COMPLETE').length,unit:'개',detail:'목표 양품 출고 완료'},{label:'출고 LOT',value:data.shipments.length,unit:'개',detail:'고객사 목적지 연결'}],
    quality:[...commonMetrics,{label:'누적 양품',value:goodTotal,unit:'개',detail:'포장 완료 기준'},{label:'누적 불량',value:rejectTotal,unit:'개',detail:'불량 분류 기준'},{label:'실적 양품률',value:`${yieldRate}%`,detail:'포장 양품 ÷ 포장 양품·불량'},{label:'불량 발생 작업',value:qualityIssueOrders,unit:'건',detail:'불량 1개 이상'}],
    shipping:[...commonMetrics,{label:'누적 양품',value:goodTotal,unit:'개',detail:'전체 생산 LOT'},{label:'누적 불량',value:rejectTotal,unit:'개',detail:'전체 생산 LOT'},{label:'누적 출고',value:shippedTotal,unit:'개',detail:'출고 기록 합계'},{label:'출고 LOT',value:data.shipments.length,unit:'건',detail:'목적지별 이력'},{label:'포장 후 출고 대기',value:stock.FINISHED??0,unit:'개',detail:'완제품 재고'},{label:'차량 디지털 적재',value:stock.TRUCK??0,unit:'개',detail:'실물 적재 미구현'}],
    process:[...commonMetrics,{label:'현재 작업 투입',value:data.plc.launched,unit:'세트',detail:'현장 누적값'},{label:'현재 작업 포장',value:data.plc.packed,unit:'개',detail:'현장 누적값'}],
    equipment:[...commonMetrics,{label:'현장 제어기 연결',value:data.plc.connected?'연결됨':'끊김',detail:'OPC UA 현재 상태'},{label:'일시 정지 작업',value:pausedOrders,unit:'건',detail:'정비 정지와 별도'},{label:'설비 고장 이력',value:'미수집',detail:'고장·정비 센서 이력 구축 예정'},{label:'예지보전 데이터',value:'미수집',detail:'온도·진동·전류 센서 예정'}],
    events:[...commonMetrics,{label:'화면 표시 이벤트',value:data.events.length,unit:'건',detail:'최근 최대 50건'},{label:'제어기 연결',value:data.plc.connected?'정상':'끊김',detail:'현재 수신 상태'}]
  }
  async function command(action:string){setBusy(true);setActionMessage('');try{await api(`/api/orders/${id}/${action}`,'POST');await refresh();setActionOk(true);setActionMessage(action==='start'?`${s(order!,'ORDER_CODE')} 가동을 허가했습니다. 현장에서 시작 버튼을 누르면 공정이 시작됩니다.`:action==='recover'?`${s(order!,'ORDER_CODE')}의 이전 실적을 보존하고 남은 목표 수량을 재개했습니다.`:action==='pause'?'가동 허가를 해제했습니다. 공정이 정지합니다.':'가동 허가를 다시 냈습니다. 현장에서 시작 버튼을 눌러 재가동하세요.')}catch(e){setActionOk(false);setActionMessage(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  const steps=[['1','본체 · 뚜껑 투입','BOM 1:1, 자재 허가','IX0.2 / IX0.3'],['2','로봇 조립','본체와 뚜껑 결합','IX0.6 / IX0.7'],['3','검사 · 분류','검사 판정, 불량 분기','IX2.0 / IX2.1'],['4','양품 포장','포장 완료 신호','IX1.3 / IX1.4'],['5','출구 · 출고','목표 양품을 묶음 출고','IX1.6 / MW110']]
  return <div className="shell mes-shell"><aside><div className="brand"><span>CF</span> CASE<span>FLOW</span><small>SMART FACTORY MES</small></div><nav aria-label="MES 메뉴">{menus.map(m=><a key={m} href={`#${m}`} className={page===m?'selected':''} aria-current={page===m?'page':undefined}>{names[m]}</a>)}</nav><div className="side-foot"><b className={data.plc.connected?'online':''}>●</b> 현장 제어기 {data.plc.connected?'연결됨':'연결 끊김'}<small>웹 트윈 PLC · MES 허가 방식</small></div></aside><main><TwinHost/><header><b>{names[page]}</b><span>소형 케이스 조립 공정</span><time>현장 수신 {data.plc.sampledAt?new Date(data.plc.sampledAt).toLocaleTimeString('ko-KR'):'—'}</time></header><div className="content mes-content">{page!=='home'&&<PageOverview page={page} metrics={pageMetrics[page]} alert={<>{error&&<p className="error" role="alert">{error}</p>}<UpcomingAlerts plans={data.plans} stock={stock}/></>}/>}
    {page==='home'&&<><section className="hero"><div><label>LIVE PRODUCTION</label><h1>케이스 조립 · 검사 · 포장</h1><p>본체와 뚜껑을 조립하고, 앞선 제품을 검사·포장하는 동안 다음 세트를 공급합니다. 불량은 목표 양품에서 제외합니다.</p><div className="chips"><span>현재 작업 {activeOrder?s(activeOrder,'ORDER_CODE'):'대기'}</span>{activeOrder&&<span>목표 양품 {target}개</span>}<span>검사: 규칙 기반 판정</span></div></div><div className="hero-status"><small>라인 상태</small><strong>{!data.plc.connected?'제어기 연결 대기':data.plc.mesStop?'MES 허가 없음':data.plc.machineState===6?'목표 완료':data.plc.machineState===3?'허가됨 · 현장 시작 대기':data.plc.machineState===2?'가동 중':'정지'}</strong><small>설비 상태 코드 {data.plc.machineState}</small></div></section><UpcomingAlerts plans={data.plans} stock={stock}/><CurrentOrderFocus order={activeOrder}/><CurrentWork order={activeOrder} plc={data.plc}/><HomeInsights data={data} metrics={[{label:'누적 양품 포장',value:goodTotal,unit:'개',detail:'전체 생산 LOT 합계'},{label:'누적 불량 분류',value:rejectTotal,unit:'개',detail:'전체 생산 LOT 합계'},{label:'실적 양품률',value:`${yieldRate}%`,detail:'포장 양품 ÷ 양품·불량'},{label:'누적 출고',value:shippedTotal,unit:'개',detail:'출고 이력 합계'},{label:'생산 LOT',value:data.productionLots.length,unit:'개',detail:'작업지시별 생성'},{label:'가용 자재 LOT',value:usableMaterialLots,unit:'개',detail:`전체 입고 LOT ${data.lots.length}개`}]}/><div className="mes-two home-summary"><section className="card"><CardTitle eyebrow="OPERATIONS QUEUE" title="작업과 현장 알림"/><div className="mes-station-list"><div><span>가동 중 작업지시</span><strong>{runningOrders}건</strong></div><div><span>시작 대기 작업지시</span><strong>{queuedOrders}건</strong></div><div><span>작업지시 미발행 계획</span><strong>{unreleasedPlans}건</strong></div><div><span>재고 0인 부재료</span><strong>{emptyMaterialTypes}종</strong></div><div><span>설비 고장·정비 이력</span><strong>미수집</strong></div></div><p className="fine">고장 발생 횟수와 고장 예측은 설비 알람·정비 이력 수집 후 표시합니다. 현재 0건으로 간주하지 않습니다.</p></section><section className="card"><CardTitle eyebrow="CURRENT STATIONS" title="지금 진행 중인 공정" aside="설비 상태"/><div className="mes-station-list">{[['본체 · 뚜껑 공급',data.plc.assemblyPhase===0&&data.plc.machineState===2?1:0],['로봇 조립',data.plc.assemblyPhase],['검사 · 분류',data.plc.inspectionPhase],['양품 포장',data.plc.packingPhase]].map(([label,phase])=><div key={String(label)}><b className={phase===1&&!data.plc.mesStop?'is-active':''}/><span>{label}</span><strong>{stationLabel(Number(phase),data.plc)}</strong></div>)}</div><a className="mes-link" href="#process">공정 전체 보기 →</a></section><section className="card"><CardTitle eyebrow="WORK & MATERIAL" title="현재 작업과 자재" aside="BOM 1:1"/><div className="mes-station-list"><div><span>작업지시</span><strong>{activeOrder?s(activeOrder,'ORDER_CODE'):'대기'}</strong></div><div><span>가용 본체</span><strong>{stock.BODY??0}개</strong></div><div><span>가용 뚜껑</span><strong>{stock.LID??0}개</strong></div><div><span>미완료 생산계획</span><strong>{openPlans.length}건</strong></div></div><a className="mes-link" href="#orders">작업지시 보기 →</a></section></div><section className="card"><CardTitle eyebrow="WORKFLOW" title="계획에서 출고까지"/><div className="mes-flow">{['생산계획 작성','계획 승인','작업지시 발행','현장 가동','LOT 소모·검사·포장','양품 출고'].map((x,i)=><div key={x}><small>{String(i+1).padStart(2,'0')}</small><b>{x}</b></div>)}</div><p className="fine">작성자·승인자 이름을 기록합니다. 사용자 계정과 권한 검증은 후속 구현 항목입니다.</p></section></>}
    {page==='orders'&&<OrderExecution data={data} order={activeOrder} status={status} busy={busy} startBlock={startBlock} actionMessage={actionMessage} actionOk={actionOk} onSelect={selected=>{setSelectedOrderId(selected);setActionMessage('')}} onCommand={command}/>}
    {page==='process'&&<><section className="card"><CardTitle eyebrow="PROCESS MAP" title="설비가 제어하는 생산 공정" aside="10ms 스캔"/><div className="stages">{steps.map(([no,title,desc,io])=><div className="stage" key={no}><small>{no}</small><b>{title}</b><p>{desc}</p><em>{io}</em></div>)}</div><p className="note">조립품 배출 뒤 다음 세트 공급을 시작하고, 앞 제품은 검사·포장을 병행합니다. 자재 부족 시 새 공급만 보류합니다.</p></section><ProductionOperations page="process" data={data} onUpdate={refresh}/></>}
    {(['planning','materials','trace','quality','shipping','equipment'] as Page[]).includes(page)&&<ProductionOperations page={page} data={data} onUpdate={refresh}/>}
    {page==='events'&&<section className="card"><CardTitle eyebrow="PRODUCTION EVENTS" title="실적 · 상태 이벤트" aside="최근 50건"/><div className="events">{data.events.map(e=><div key={s(e,'ID')}><b>●</b><strong>{eventNames[s(e,'EVENT_TYPE')]||s(e,'EVENT_TYPE')}</strong><span>누적 {s(e,'COUNTER_VALUE')}</span><time>{new Date(s(e,'OCCURRED_AT')).toLocaleString('ko-KR')}</time></div>)}</div></section>}
    <footer>현장 설비 · 생산 실적 · 자재 LOT · 작업지시 연동 | 운영 시연 환경</footer></div></main></div>
}

