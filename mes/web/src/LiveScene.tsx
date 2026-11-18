import { lazy, Suspense, useState } from 'react'
import type { Data } from './App'
import { n, s } from './App'

import './LiveScene.css'

const FactoryTwin3D = lazy(() => import('./FactoryTwin3D'))

export default function LiveScene({data,onUpdate}:{data:Data;onUpdate:()=>Promise<unknown>}){
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const active=data.orders.find(order=>['RUNNING','PAUSED'].includes(s(order,'STATUS')))
  const state=active?s(active,'STATUS'):'대기'
  async function command(action:'pause'|'resume'){
    if(!active)return
    setBusy(true);setNotice('')
    try{
      const response=await fetch(`/api/orders/${n(active,'ID')}/${action}`,{method:'POST'})
      if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.detail||error.message||`HTTP ${response.status}`)}
      await onUpdate()
      setNotice(action==='pause'?'현장 정지 명령을 보냈습니다.':'현장 재가동 명령을 보냈습니다.')
    }catch(error){setNotice(error instanceof Error?error.message:String(error))}
    finally{setBusy(false)}
  }
  return <section className="card live-scene"><div className="op-title"><div><small>LIVE FACTORY</small><h2>3D 현장 · 설비 운전</h2></div><span>현장 상태 연동</span></div>
    <Suspense fallback={<div className="live-scene-loading">현장 화면 연결 중…</div>}><FactoryTwin3D/></Suspense><div className="live-scene-controls"><strong>{active?s(active,'ORDER_CODE'):'진행 중인 작업 없음'}</strong><span>작업 상태 {state}</span><span>투입 {data.plc.launched} · 불량 {data.plc.rejected} · 포장 {data.plc.packed} · 출구 {data.plc.lineExit}</span><span>제어기 {data.plc.connected?'연결됨':'연결 끊김'}</span><div className="live-scene-buttons"><button disabled={busy||state!=='RUNNING'} onClick={()=>command('pause')}>현장 정지</button><button disabled={busy||state!=='PAUSED'} onClick={()=>command('resume')}>재가동</button><a href="#orders">작업지시 보기</a></div>{notice&&<p role="status">{notice}</p>}</div><p className="fine">설비와 제품의 현재 위치를 현장 제어기에서 수신합니다. 화면을 드래그하거나 확대하여 확인할 수 있습니다.</p>
  </section>
}

