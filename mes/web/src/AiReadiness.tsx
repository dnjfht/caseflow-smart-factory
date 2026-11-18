import { useEffect, useState } from 'react'

type Status={modelState:string;sampleCount:number;lastSample:string;qualityLabels:string;maintenanceLabels:string;sensorInputs:string}

export default function AiReadiness(){
  const [status,setStatus]=useState<Status|null>(null)
  useEffect(()=>{
    let disposed=false
    const load=()=>fetch('/api/ai/status').then(response=>response.ok?response.json():Promise.reject()).then((value:Status)=>{if(!disposed)setStatus(value)}).catch(()=>{if(!disposed)setStatus(null)})
    load()
    const timer=window.setInterval(load,10000)
    return()=>{disposed=true;window.clearInterval(timer)}
  },[])
  return <section className="card"><div className="op-title"><div><small>AI DATA FOUNDATION</small><h2>AI 학습 데이터 수집</h2></div><span>학습 전</span></div>
    <div className="mes-feature-grid"><div><b>설비 상태 기록</b><p>{status?`${status.sampleCount.toLocaleString('ko-KR')}건 수집 · 5초 간격`:'수집 상태 확인 중'}</p></div><div><b>품질 판정</b><p>현재 규칙 기반 판정 · 영상 검사 도입 준비 중</p></div><div><b>예지보전</b><p>고장·정비와 진동·전류·온도 이력 미수집</p></div></div>
    <p className="fine">현재 예측 모델은 학습하지 않았습니다. 설비 기록을 작업지시·LOT·검사·정비 데이터와 연결한 뒤 기준선과 모델을 검증합니다.</p>
  </section>
}
