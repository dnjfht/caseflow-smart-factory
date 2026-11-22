import { useState } from 'react'
import type { Data } from './App'
import { s } from './App'
import { TwinSlot } from './TwinHost'
import { isStaticSite, twin, useTwinLink, useTwinTags } from './twin'

import './LiveScene.css'

const STATE: Record<number, string> = { 1: '대기 (MES 허가 없음)', 2: '가동 중', 3: 'MES 허가됨 · 현장 시작 대기', 4: '현장 정지', 5: '고장', 6: '목표 수량 완료' }

/** The line as the person on the floor sees it: the 3D twin, and the operator panel next to it. */
export default function LiveScene({ data }: { data: Data; onUpdate: () => Promise<unknown> }) {
  const { ready, tags: localTags } = useTwinTags(400)
  const link = useTwinLink()
  const viewer = link.mode === 'viewer'
  // a watcher shows the driving browser's line, not its own idle copy
  const tags = viewer ? link.serverTags : localTags
  const [notice, setNotice] = useState('')
  const active = data.orders.find(order => ['RUNNING', 'PAUSED'].includes(s(order, 'STATUS')))
  const permit = tags.MesPermit === true
  const running = tags.M0 === true
  const state = Number(tags.MachineState ?? 0)
  const num = (k: string) => Number(tags[k] ?? 0)
  // counts shown are the line's, as the MES keeps them: a reloaded page restarts its own copy of the simulation from
  // zero, but the order's production carries on from what the server has already counted
  const line = !isStaticSite && data.plc.connected && active
  const counts = line
    ? { target: Number(s(active, 'TARGET_QTY')) || num('TargetQuantity'), launched: data.plc.launched, rejected: data.plc.rejected, packed: data.plc.packed, shipped: data.plc.lineExit }
    : { target: num('TargetQuantity'), launched: num('LaunchedCount'), rejected: num('RejectCount'), packed: num('ProducedCount'), shipped: num('ShippedCount') }
  async function press(key: 'HmiStart' | 'HmiStop') {
    const t = twin()
    if (!t) return
    setNotice('')
    await t.press(key)
    if (key === 'HmiStart' && !t.tags().MesPermit) setNotice('MES 가동 허가가 없어 시작되지 않았습니다. 작업 지시에서 가동을 허가하세요.')
  }
  function demoPermit(on: boolean) {
    twin()?.write('MesPermit', on)
    setNotice(on ? '공개 시연용 허가를 냈습니다. 현장 시작 버튼을 누르세요.' : '허가를 해제했습니다.')
  }
  return <section className="card live-scene">
    <div className="op-title"><div><small>LIVE FACTORY · WEB TWIN</small><h2>3D 현장 · 현장 조작반</h2></div><span>{!ready ? '가상 공정 불러오는 중' : link.mode === 'driver' ? 'MES 서버 연결 · 실적 DB 기록 중' : link.mode === 'viewer' ? '관전 모드' : link.mode === 'static' ? '공개 시연' : 'MES 서버 연결 중'}</span></div>
    <div className="live-scene-layout">
      <TwinSlot view="overview" />
      <div className="field-panel">
        <div className="field-panel-head"><strong>현장 조작반</strong><small>{active ? s(active, 'ORDER_CODE') : '진행 중인 작업 없음'}</small></div>
        <div className="field-lamps">
          <div className={permit ? 'lamp on green' : 'lamp'}><i />MES 허가</div>
          <div className={running ? 'lamp on blue' : 'lamp'}><i />운전</div>
          <div className={tags.AlarmLamp === true ? 'lamp on red' : 'lamp'}><i />알람</div>
        </div>
        <p className="field-state">{ready ? STATE[state] ?? `상태 ${state}` : '현장 제어기 연결 대기'}</p>
        <div className="field-buttons">
          <button className="pb start" disabled={!ready || running || viewer} onClick={() => press('HmiStart')}>시작</button>
          <button className="pb stop" disabled={!ready || !running || viewer} onClick={() => press('HmiStop')}>정지</button>
        </div>
        <dl className="field-counts">
          <div><dt>목표</dt><dd>{counts.target}</dd></div>
          <div><dt>투입</dt><dd>{counts.launched}</dd></div>
          <div><dt>불량</dt><dd>{counts.rejected}</dd></div>
          <div><dt>포장</dt><dd>{counts.packed}</dd></div>
          <div><dt>출하</dt><dd>{counts.shipped}</dd></div>
        </dl>
        {isStaticSite && <div className="field-demo"><small>공개 시연 · MES 서버 없이 실행 중</small><div><button disabled={!ready || permit} onClick={() => demoPermit(true)}>MES 허가 (시연)</button><button disabled={!ready || !permit} onClick={() => demoPermit(false)}>허가 해제</button></div></div>}
        {!isStaticSite && <p className={link.field ? 'field-pc on' : 'field-pc'}>{link.field ? '현장 PC의 OIP 데스크톱 연결됨 · 시작·정지·허가가 양쪽에 함께 적용됩니다' : '현장 PC(OIP 데스크톱) 미연결 · 웹 트윈이 현장입니다'}</p>}
        {link.message && <p className="field-link">{link.message}</p>}
        {notice && <p className="field-notice" role="status">{notice}</p>}
      </div>
    </div>
    <p className="fine">MES는 가동을 허가만 합니다. 허가가 있을 때 현장의 시작 버튼(3D 화면의 초록 버튼 또는 이 조작반)을 눌러야 공정이 돌고, 정지 버튼·허가 해제·목표 달성 시 멈춥니다. 3D 화면은 드래그로 회전, 휠로 확대할 수 있습니다.</p>
  </section>
}
