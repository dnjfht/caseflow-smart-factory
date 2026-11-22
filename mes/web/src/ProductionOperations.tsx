import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Data, Page, Row } from './App'
import { n, s } from './App'
import QualityCharts, { qualityJobs } from './QualityCharts'
import TeachPendant from './TeachPendant'
import SelectMenu from './SelectMenu'
import LiveScene from './LiveScene'
import './ProductionOperations.css'

function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function localTime(value:string){return value?new Date(value).toLocaleString('ko-KR'):'—'}
function nextPlanCode(plans:Row[],saved=''){const ids=[...plans.map(p=>s(p,'PLAN_CODE')),saved].map(code=>Number(code.match(/\d+$/)?.[0]||0));return `PLAN-${String(Math.max(0,...ids)+1).padStart(3,'0')}`}
async function request(path:string,method='GET',body?:object){const r=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.detail||e.message||`HTTP ${r.status}`)}return r.json()}
function Title({label,title,aside}:{label:string;title:string;aside?:string}){return <div className="op-title"><div><small>{label}</small><h2>{title}</h2></div>{aside&&<span>{aside}</span>}</div>}
function Table({heads,rows}:{heads:string[];rows:ReactNode[][]}){return <div className="op-table-wrap"><table><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j} data-label={heads[j]}>{v}</td>)}</tr>):<tr><td colSpan={heads.length}>아직 기록이 없습니다.</td></tr>}</tbody></table></div>}
function status(phase:number,stopped:boolean,done:boolean){return done?'목표 완료':stopped?'정지':phase===1?'진행 중':phase===2?'배출 중':'대기'}

export default function ProductionOperations({page,data,onUpdate}:{page:Page;data:Data;onUpdate:()=>Promise<unknown>}){
  const [planCode,setPlanCode]=useState('PLAN-002'),[planTarget,setPlanTarget]=useState(3)
  const [plannedStart,setPlannedStart]=useState(localDate),[plannedStartTime,setPlannedStartTime]=useState('09:00'),[dueDate,setDueDate]=useState(localDate)
  const [destination,setDestination]=useState('고객사 물류센터'),[createdBy,setCreatedBy]=useState('생산계획 담당자'),[approver,setApprover]=useState('생산팀장')
  const [lotCode,setLotCode]=useState(''),[sku,setSku]=useState('BODY'),[receiveQty,setReceiveQty]=useState(10)
  const [supplier,setSupplier]=useState(''),[origin,setOrigin]=useState(''),[receivedBy,setReceivedBy]=useState('입고 담당자')
  const [traceLot,setTraceLot]=useState(''),[traceOrder,setTraceOrder]=useState(''),[forward,setForward]=useState<Row[]>([]),[backward,setBackward]=useState<Row[]>([])
  const [traceMode,setTraceMode]=useState<'forward'|'backward'|null>(null),[tracePage,setTracePage]=useState(1)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[messageOk,setMessageOk]=useState(false)
  const [qualitySearch,setQualitySearch]=useState(''),[qualityStatus,setQualityStatus]=useState('ALL'),[qualityPage,setQualityPage]=useState(1)
  useEffect(()=>{setMessage('');setMessageOk(false)},[page])
  useEffect(()=>{setPlanCode(current=>data.plans.some(p=>s(p,'PLAN_CODE')===current)?nextPlanCode(data.plans):current)},[data.plans])
  const stock=Object.fromEntries(data.inventory.map(r=>[s(r,'SKU'),n(r,'QUANTITY')]))
  async function mutate(path:string,body?:object){
    setBusy(true);setMessage('')
    try{
      if(path==='/api/plans'&&(!Number.isInteger(planTarget)||planTarget<1||planTarget>10000))throw Error('완제품 목표는 1~10,000개의 정수로 입력하세요.')
      if(path==='/api/lots'){
        if(!Number.isInteger(receiveQty)||receiveQty<1||receiveQty>32767)throw Error('입고 수량은 1~32,767개의 정수로 입력하세요.')
        if(!supplier.trim()||!origin.trim()||!receivedBy.trim())throw Error('공급처·입고 출처·입고 담당자를 입력하세요.')
      }
      const saved=await request(path,'POST',body)
      await onUpdate().catch(()=>{})
      if(path==='/api/plans')setPlanCode(nextPlanCode(data.plans,String(saved.PLAN_CODE||'')))
      if(path==='/api/lots')setLotCode('')
      setMessageOk(true)
      setMessage(path==='/api/plans'?`${saved.PLAN_CODE} 저장 완료 · 아래 목록에서 계획 승인 → 작업지시 발행 → 작업 지시 페이지에서 생산 시작 순서로 진행하세요.`:path==='/api/lots'?`${saved.LOT_CODE} 입고 완료 · ${saved.RECEIVED_QTY}개 등록했습니다. 아래 LOT 목록과 재고 수량을 확인하세요.`:'처리되었습니다.')
    }catch(e){
      if(path==='/api/plans')await onUpdate().catch(()=>{})
      setMessageOk(false);setMessage(e instanceof Error?e.message:String(e))
    }
    finally{setBusy(false)}
  }
  async function lookup(mode:'forward'|'backward'){
    setMessage('');setMessageOk(false);setTraceMode(mode);setTracePage(1)
    const raw=(mode==='forward'?traceLot:traceOrder).trim()
    if(!raw){setMessage(mode==='forward'?'원자재 LOT를 선택하거나 입력하세요.':'작업번호를 선택하거나 입력하세요.');return}
    const code=mode==='backward'&&raw.startsWith('FG-')?raw.slice(3):raw
    try{
      const rows:Row[]=await request(`/api/trace/${mode}/${encodeURIComponent(code)}`)
      if(mode==='forward')setForward(rows);else setBackward(rows)
      setMessageOk(true)
      setMessage(rows.length?`${raw}: 연결된 투입 기록 ${rows.length}건을 찾았습니다.`:mode==='backward'?`${raw}: 이 작업에는 원자재 LOT 투입 이력이 기록되지 않아 역추적할 수 없습니다. 과거 데모 실적에는 LOT 연결 기록이 없을 수 있습니다.`:`${raw}: 아직 이 LOT의 작업 투입 기록이 없습니다.`)
    }catch(e){setMessage(e instanceof Error?e.message:String(e))}
  }
  const jobs=qualityJobs(data.productionLots)
  const qualityFiltered=jobs.filter(j=>j.code.toLowerCase().includes(qualitySearch.toLowerCase())&&(qualityStatus==='ALL'||j.status===qualityStatus)).reverse()
  const qualityPages=Math.max(1,Math.ceil(qualityFiltered.length/8))
  const visibleQuality=qualityFiltered.slice((Math.min(qualityPage,qualityPages)-1)*8,Math.min(qualityPage,qualityPages)*8).reverse()
  const totalGood=jobs.reduce((a,j)=>a+j.good,0),totalBad=jobs.reduce((a,j)=>a+j.bad,0)
  return <div className="operations mes-page">
    {page==='planning'&&<><section className="card"><Title label="PRODUCTION PLAN" title="생산계획 작성" aside="CASE · BOM 1:1"/><p className="op-explain">계획 저장은 생산 예약을 등록합니다. 저장 후 아래 목록에서 승인하고 작업지시를 발행해야 작업 지시 화면에 나타납니다. 완제품 목표 수량을 정하면 BOM에 따라 본체와 뚜껑 필요량이 계산됩니다. 불량품 보충분은 실제 검사 결과에 따라 추가 소모됩니다.</p><div className="bom-strip">{data.bom.map(line=><span key={s(line,'MATERIAL_SKU')}>{s(line,'ITEM_NAME')} × {n(line,'QUANTITY_PER_UNIT')} / 완제품 1개</span>)}</div><div className="mes-requirements"><b>계획 소요</b><span>본체 {planTarget}개</span><span>뚜껑 {planTarget}개</span><small>현재 가용: 본체 {stock.BODY??0}개 · 뚜껑 {stock.LID??0}개</small></div><div className="op-form"><label>계획번호<input value={planCode} onChange={e=>setPlanCode(e.target.value)}/></label><label>완제품 목표<input type="number" min="1" max="10000" step="1" value={planTarget} onChange={e=>setPlanTarget(Number(e.target.value))}/></label><label>작업 시작일<input type="date" value={plannedStart} onChange={e=>setPlannedStart(e.target.value)}/></label><label>시작 시각<input type="time" value={plannedStartTime} onChange={e=>setPlannedStartTime(e.target.value)}/></label><label>납기일<input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label><label>출고처<input value={destination} onChange={e=>setDestination(e.target.value)}/></label><label>계획 작성자<input value={createdBy} onChange={e=>setCreatedBy(e.target.value)}/></label><button disabled={busy} onClick={()=>mutate('/api/plans',{code:planCode,target:planTarget,plannedStart,plannedStartTime,dueDate,destination,createdBy})}>계획 저장</button></div>{message&&<p className={`op-message ${messageOk?'':'op-error'}`} role={messageOk?'status':'alert'}>{message}</p>}</section><section className="card"><Title label="REVIEW → APPROVE → RELEASE" title="승인과 작업지시 발행"/><p className="op-explain">계획 담당자가 작성하고 생산 책임자가 승인합니다. 승인된 계획은 예정 시각 전에도 작업지시로 미리 발행할 수 있지만, 가동 허가는 시작 예정 시각이 되어야 낼 수 있습니다. 허가 후 현장 담당자가 시작 버튼으로 가동합니다.</p><div className="op-form"><label>승인 담당자<input value={approver} onChange={e=>setApprover(e.target.value)}/></label><span className="mes-muted">현재는 담당자 이름 기록만 수행하며 실제 계정 권한 검증은 없습니다.</span></div><Table heads={['계획번호','작성자','목표 / BOM 소요','시작 예정','시작 시각','납기','출고처','상태','승인자','다음 단계']} rows={data.plans.map(p=>[s(p,'PLAN_CODE'),s(p,'CREATED_BY')||'기존 계획',`${n(p,'TARGET_QTY')}개 / 본체·뚜껑 각 ${n(p,'TARGET_QTY')}개`,s(p,'PLANNED_START').slice(0,10)||'기존 계획',s(p,'PLANNED_START_TIME').slice(0,5)||'미등록',s(p,'DUE_DATE').slice(0,10),s(p,'DESTINATION'),s(p,'STATUS'),s(p,'APPROVED_BY')||'—',s(p,'STATUS')==='DRAFT'?<button disabled={busy} onClick={()=>mutate(`/api/plans/${s(p,'ID')}/approve`,{approver})}>계획 승인</button>:s(p,'STATUS')==='APPROVED'?<button disabled={busy} onClick={()=>mutate(`/api/plans/${s(p,'ID')}/release`)}>작업지시 발행</button>:s(p,'ORDER_CODE')||'—'])}/></section></>}
    {page==='materials'&&<><section className="card"><Title label="MATERIAL INVENTORY" title="부재료 재고와 BOM" aside="입고 → LOT → 투입"/><div className="mes-stocks"><div><small>본체</small><strong>{stock.BODY??0}</strong><span>개 가용</span></div><div><small>뚜껑</small><strong>{stock.LID??0}</strong><span>개 가용</span></div><div><small>포장 완제품</small><strong>{stock.FINISHED??0}</strong><span>개 출고 대기</span></div><div><small>불량품</small><strong>{stock.REJECT??0}</strong><span>개 분류</span></div></div><div className="bom-strip">{data.bom.map(line=><span key={s(line,'MATERIAL_SKU')}>CASE 1개 = {s(line,'ITEM_NAME')} {n(line,'QUANTITY_PER_UNIT')}개</span>)}</div><p className="fine">생산 투입 신호가 발생하면 FIFO LOT에서 본체·뚜껑 각 1개씩 차감합니다. 재고가 0이면 새 세트 공급만 보류합니다.</p></section><section className="card"><Title label="GOODS RECEIPT" title="직원 부재료 입고"/><p className="op-explain">현장 직원이 입고 LOT, 공급처, 출처, 수량을 등록합니다. 저장 즉시 자재 재고가 늘고 현장 재고 표시로 전달됩니다.</p><div className="op-form"><label>입고 LOT<input value={lotCode} onChange={e=>setLotCode(e.target.value)} placeholder="비우면 자동 LOT 생성"/></label><label>부재료<SelectMenu ariaLabel="입고 부재료" value={sku} onChange={setSku} options={[{value:'BODY',label:'본체'},{value:'LID',label:'뚜껑'}]}/></label><label>수량<input type="number" min="1" max="32767" step="1" value={receiveQty} onChange={e=>setReceiveQty(Number(e.target.value))}/></label><label>공급처<input value={supplier} onChange={e=>setSupplier(e.target.value)}/></label><label>입고 출처<input value={origin} onChange={e=>setOrigin(e.target.value)}/></label><label>입고 담당자<input value={receivedBy} onChange={e=>setReceivedBy(e.target.value)}/></label><button disabled={busy} onClick={()=>mutate('/api/lots',{lotCode,sku,quantity:receiveQty,supplier,origin,receivedBy})}>LOT 입고 등록</button></div><p className="op-field-help">입고 LOT를 비워두면 고유 번호를 자동 생성합니다.</p>{message&&<p className={`op-message ${messageOk?'':'op-error'}`} role={messageOk?'status':'alert'}>{message}</p>}<Table heads={['LOT','품목','공급처','출처','담당자','입고','가용','입고 시각']} rows={data.lots.map(l=>[s(l,'LOT_CODE'),s(l,'SKU'),s(l,'SUPPLIER'),s(l,'ORIGIN'),s(l,'RECEIVED_BY')||'기록 없음(기존 데이터)',n(l,'RECEIVED_QTY'),n(l,'AVAILABLE_QTY'),localTime(s(l,'RECEIVED_AT'))])}/></section></>}
    {page==='trace'&&<>
      <section className="card"><Title label="PRODUCTION LOT" title="생산 LOT 현황" aside="작업지시별 생성"/><p className="op-explain">작업지시 발행 시 완제품 생산 LOT가 생성되고, 현장의 투입·포장·불량·출구 실적에 따라 계속 갱신됩니다.</p><Table heads={['생산 LOT','작업지시','상태','목표 양품','부품 투입','양품 포장','불량','출구 통과']} rows={data.productionLots.map(l=>[s(l,'LOT_CODE'),s(l,'ORDER_CODE'),s(l,'STATUS'),n(l,'TARGET_QTY'),n(l,'LAUNCHED_QTY'),n(l,'GOOD_QTY'),n(l,'REJECTED_QTY'),n(l,'SHIPPED_QTY')])}/></section>
      <section className="card"><Title label="LOT GENEALOGY" title="원자재부터 출고처까지 추적" aside="작업 묶음 단위"/><p className="op-explain">원자재 LOT → 작업 투입 → 생산 LOT → 출고처를 조회합니다. 번호를 선택하거나 직접 입력하세요. 개별 제품 일련번호 추적에는 제품 식별 신호가 필요합니다.</p>
        <div className="trace-controls">
          <label>원자재 LOT 선택<SelectMenu ariaLabel="원자재 LOT 선택" value={traceLot} onChange={value=>{setTraceLot(value);setTraceMode(null);setMessage('')}} options={[{value:'',label:'원자재 LOT 선택'},...data.lots.map(l=>({value:s(l,'LOT_CODE'),label:`${s(l,'LOT_CODE')} · ${s(l,'SKU')}`}))]}/></label>
          <label>직접 입력<input value={traceLot} onChange={event=>{setTraceLot(event.target.value);setTraceMode(null);setMessage('')}} placeholder="원자재 LOT 직접 입력"/></label>
          <button onClick={()=>lookup('forward')}>정방향 조회</button>
          <label>작업지시 또는 생산 LOT 선택<SelectMenu ariaLabel="작업지시 또는 생산 LOT 선택" value={traceOrder} onChange={value=>{setTraceOrder(value);setTraceMode(null);setMessage('')}} options={[{value:'',label:'작업지시 선택'},...data.productionLots.map(l=>({value:s(l,'ORDER_CODE'),label:`${s(l,'LOT_CODE')} · ${s(l,'ORDER_CODE')}`}))]}/></label>
          <label>직접 입력<input value={traceOrder} onChange={event=>{setTraceOrder(event.target.value);setTraceMode(null);setMessage('')}} placeholder="작업번호 또는 FG-생산 LOT"/></label>
          <button onClick={()=>lookup('backward')}>역방향 조회</button>
        </div>
        {message&&<p className={`op-message ${messageOk?'':'op-error'}`} role={messageOk?'status':'alert'}>{message}</p>}
        {traceMode==='forward'&&forward.length>0&&<><h3>원자재 LOT → 출고처</h3><Table heads={['원자재 LOT','공급처','작업','투입 순번','생산 LOT','출고처']} rows={forward.slice((tracePage-1)*20,tracePage*20).map(r=>[s(r,'LOT_CODE'),s(r,'SUPPLIER'),s(r,'ORDER_CODE'),n(r,'LAUNCH_COUNTER'),s(r,'FINISHED_LOT_CODE')||'생산 중',s(r,'DESTINATION')||'미출고'])}/></>}
        {traceMode==='backward'&&backward.length>0&&<><h3>생산 LOT → 원자재 출처</h3><Table heads={['생산 LOT','출고처','투입 순번','자재','원자재 LOT','공급처 / 출처']} rows={backward.slice((tracePage-1)*20,tracePage*20).map(r=>[s(r,'FINISHED_LOT_CODE'),s(r,'DESTINATION')||'미출고',n(r,'LAUNCH_COUNTER'),s(r,'SKU'),s(r,'LOT_CODE'),`${s(r,'SUPPLIER')} / ${s(r,'ORIGIN')}`])}/></>}
        {traceMode&&((traceMode==='forward'?forward:backward).length>20)&&<div className="qc-pager"><span>전체 {(traceMode==='forward'?forward:backward).length}건 · 페이지당 20건</span><button disabled={tracePage<=1} onClick={()=>setTracePage(page=>page-1)}>이전</button><span>{tracePage} / {Math.ceil((traceMode==='forward'?forward:backward).length/20)}</span><button disabled={tracePage>=Math.ceil((traceMode==='forward'?forward:backward).length/20)} onClick={()=>setTracePage(page=>page+1)}>다음</button></div>}
      </section>
    </>}
    {page==='quality'&&<><section className="card"><Title label="QUALITY REGISTER" title="작업별 품질 조회" aside={`전체 ${jobs.length}건`}/><div className="qc-controls"><input aria-label="작업번호 검색" placeholder="작업번호 검색" value={qualitySearch} onChange={e=>{setQualitySearch(e.target.value);setQualityPage(1)}}/><SelectMenu ariaLabel="작업 상태 필터" value={qualityStatus} onChange={value=>{setQualityStatus(value);setQualityPage(1)}} options={[{value:'ALL',label:'전체 상태'},{value:'RUNNING',label:'가동 중'},{value:'PAUSED',label:'일시 정지'},{value:'COMPLETE',label:'완료'},{value:'CREATED',label:'시작 대기'}]}/><span>검색 결과 {qualityFiltered.length}건 · 페이지당 8건</span></div></section><QualityCharts allJobs={jobs} visibleJobs={visibleQuality} rangeLabel={`조회 ${Math.min(qualityPage,qualityPages)} / ${qualityPages}쪽`}/><section className="card"><Title label="ORDER DETAIL" title="작업별 양품 · 불량 내역" aside="검색 · 상태 필터 · 페이지 이동"/><Table heads={['작업번호','상태','총 검사','양품','불량','양품률','불량률']} rows={[...visibleQuality].reverse().map(j=>[j.code,j.status,j.total,j.good,j.bad,j.total?`${Math.round(j.good/j.total*100)}%`:'—',j.total?`${Math.round(j.bad/j.total*100)}%`:'—'])}/><div className="qc-pager"><button disabled={qualityPage<=1} onClick={()=>setQualityPage(p=>p-1)}>이전</button><span>{Math.min(qualityPage,qualityPages)} / {qualityPages}</span><button disabled={qualityPage>=qualityPages} onClick={()=>setQualityPage(p=>p+1)}>다음</button></div><p className="fine">차트는 현재 검색·상태 필터의 선택 페이지 8건을 보여줍니다. 원형 차트의 전체 비율은 모든 실적 작업 기준입니다. 목록이 늘어도 페이지별로 조회합니다.</p></section></>}
    {page==='shipping'&&<><section className="card"><Title label="DISPATCH" title="완제품 적재 · 출고" aside="목표 양품 도달 시 출고"/><div className="mes-stocks"><div><small>누적 양품</small><strong>{totalGood}</strong><span>개 포장</span></div><div><small>누적 불량</small><strong>{totalBad}</strong><span>개 분류</span></div><div><small>포장 완제품 대기</small><strong>{stock.FINISHED??0}</strong><span>개</span></div><div><small>차량 디지털 적재</small><strong>{stock.TRUCK??0}</strong><span>개</span></div><div><small>누적 출고</small><strong>{stock.DISPATCHED??0}</strong><span>개</span></div></div><p className="op-explain">출구 센서 통과분을 적재하고 목표 양품 수량이 채워지면 출고처와 생산 LOT를 기록합니다. 출고 차량 이동은 별도 시각 모형으로 검증 중입니다.</p><Table heads={['출고번호','작업번호','생산 LOT','출고처','수량','출고 시각']} rows={data.shipments.map(sh=>[s(sh,'SHIPMENT_CODE'),s(sh,'ORDER_CODE'),s(sh,'FINISHED_LOT_CODE'),s(sh,'DESTINATION'),n(sh,'QUANTITY'),localTime(s(sh,'DEPARTED_AT'))])}/></section></>}
    {page==='process'&&<><LiveScene data={data} onUpdate={onUpdate}/><section className="card"><Title label="LIVE STATIONS" title="동시에 진행되는 설비" aside="설비 상태"/><div className="station-grid">{[['본체 · 뚜껑 공급',data.plc.assemblyPhase===0&&data.plc.machineState===2?1:0,'IX0.2 · IX0.3 / QX0.2 · QX0.3'],['6축 로봇 조립',data.plc.assemblyPhase,'IX0.6 · IX0.7 / QX0.6'],['검사 · 불량 분류',data.plc.inspectionPhase,'IX2.0 · IX2.1 / QX1.1'],['양품 포장',data.plc.packingPhase,'IX1.3 · IX1.4 / QX1.3']].map(([name,phase,io])=><div className={'station '+(phase===1&&!data.plc.mesStop?'active':'')} key={String(name)}><div><i/><strong>{name}</strong></div><b>{status(Number(phase),data.plc.mesStop,data.plc.machineState===6)}</b><small>{io}</small></div>)}</div></section></>}
    {page==='equipment'&&<><section className="card"><Title label="EQUIPMENT & ROBOT" title="설비와 협동로봇 상태"/><div className="mes-feature-grid"><div><b>현장 제어기</b><p>{data.plc.connected?'연결됨':'연결 대기'} · {data.plc.mesStop?'MES 허가 없음':data.plc.machineState===2?'가동 중':data.plc.machineState===3?'허가됨 · 시작 대기':'정지'}</p></div><div><b>조립 로봇</b><p>{data.plc.assemblyPhase===1?'조립 중':data.plc.assemblyPhase===2?'배출 중':'대기'}</p></div><div><b>6축 협동로봇</b><p>아래 티치펜던트로 동작과 순서를 조작</p></div></div></section><TeachPendant/></>}
    </div>
}


