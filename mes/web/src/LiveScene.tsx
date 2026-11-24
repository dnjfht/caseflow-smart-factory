import { useState } from 'react'
import type { Data } from './App'
import { s } from './App'
import { TwinSlot } from './TwinHost'
import { can, needText, useSession } from './auth'
import { modeKo, STATUS_KO, useEquipment } from './equipment'
import { isStaticSite, pressLine, twin, useTwinLink, useTwinTags } from './twin'

import './LiveScene.css'

const STATE: Record<number, string> = { 1: '대기 (MES 허가 없음)', 2: '가동 중', 3: 'MES 허가됨 · 현장 시작 대기', 4: '현장 정지', 5: '고장', 6: '목표 수량 완료' }

/** The line as the person on the floor sees it: the 3D twin, and the operator panel next to it. */
export default function LiveScene({ data }: { data: Data; onUpdate: () => Promise<unknown> }) {
  const { ready, tags: localTags } = useTwinTags(400)
  const link = useTwinLink()
  const viewer = link.mode === 'viewer'
  // the panel shows THE line: OIP Desktop's PLC when the field PC is connected (this twin then only mirrors it),
  // the driving browser's twin for a watcher, else this twin
  const remote = (viewer || link.field) && Object.keys(link.serverTags).length > 0
  const tags = remote ? link.serverTags : localTags
  const [notice, setNotice] = useState('')
  const active = data.orders.find(order => ['RUNNING', 'PAUSED'].includes(s(order, 'STATUS')))
  // with no order in progress the panel keeps showing the last one, finished, rather than the line's leftover counters
  const shown = active ?? data.orders.find(order => s(order, 'STATUS') !== 'CREATED')
  const permit = tags.MesPermit === true
  const operator = can('PRODUCTION', useSession())
  const eq = useEquipment()
  const fault = eq?.openFault ?? null
  const faultAsset = fault ? eq!.assets.find(a => a.code === fault.asset_code)?.name ?? fault.asset_code : ''
  const running = tags.M0 === true
  const state = Number(tags.MachineState ?? 0)
  const num = (k: string) => Number(tags[k] ?? 0)
  // counts are the order's, as the MES records them - the same numbers as the overview, whichever copy of the line
  // made them and however often a page was reloaded
  const n = (k: string) => Number(s(shown!, k)) || 0
  const counts = !isStaticSite && shown
    ? { target: n('TARGET_QTY'), launched: n('LAST_LAUNCHED'), rejected: n('LAST_REJECTED'), packed: n('LAST_PACKED'), shipped: n('LAST_EXIT') }
    : { target: num('TargetQuantity'), launched: num('LaunchedCount'), rejected: num('RejectCount'), packed: num('ProducedCount'), shipped: num('ShippedCount') }
  async function press(key: 'HmiStart' | 'HmiStop') {
    setNotice('')
    if (key === 'HmiStart' && !permit) { setNotice('MES 가동 허가가 없어 시작되지 않습니다. 작업 지시에서 가동을 허가하세요.'); return }
    // the line is pressed where it runs: OIP Desktop (through the MES) when the field PC is connected
    if (remote) { await pressLine(key).catch(() => setNotice('MES 서버에 연결할 수 없어 누르지 못했습니다.')); return }
    await twin()?.press(key)
  }
  function demoPermit(on: boolean) {
    twin()?.write('MesPermit', on)
    setNotice(on ? '공개 시연용 허가를 냈습니다. 현장 시작 버튼을 누르세요.' : '허가를 해제했습니다.')
  }
  return <section className="card live-scene">
    <div className="op-title"><div><small>LIVE FACTORY · WEB TWIN</small><h2>3D 현장 · 현장 조작반</h2></div><span>{!ready ? '가상 공정 불러오는 중' : link.mode === 'driver' ? 'MES 서버 연결 · 실적 DB 기록 중' : link.mode === 'viewer' ? '관전 모드' : link.mode === 'static' ? '공개 시연' : 'MES 서버 연결 중'}</span></div>
    {fault && <p className={`eq-scene-banner s-${fault.status.toLowerCase()}`} role="alert"><b>● 설비 {fault.kind === 'BREAKDOWN' ? '고장' : '예방 정비'}으로 라인 정지</b><span>{faultAsset} · {fault.kind === 'BREAKDOWN' ? modeKo(fault.mode_code) : '예방 정비'} · 고장 코드 {fault.fault_code} · {STATUS_KO[fault.status]}. 설비 관리자가 수리를 확인하면 자동으로 다시 시작합니다.</span><a href="#maintenance">설비 관리 →</a></p>}
    <div className="live-scene-layout">
      <TwinSlot view="overview" />
      <div className="field-panel">
        <div className="field-panel-head"><strong>현장 조작반</strong><small>{active ? s(active, 'ORDER_CODE') : shown && !isStaticSite ? `직전 작업 ${s(shown, 'ORDER_CODE')} · ${s(shown, 'STATUS') === 'COMPLETE' ? '완료' : s(shown, 'STATUS')}` : '진행 중인 작업 없음'}</small></div>
        <div className="field-lamps">
          <div className={permit ? 'lamp on green' : 'lamp'}><i />MES 허가</div>
          <div className={running ? 'lamp on blue' : 'lamp'}><i />운전</div>
          <div className={tags.AlarmLamp === true ? 'lamp on red' : 'lamp'}><i />알람</div>
        </div>
        <p className="field-state">{ready ? STATE[state] ?? `상태 ${state}` : '현장 제어기 연결 대기'}</p>
        <div className="field-buttons">
          <button className="pb start" disabled={!operator || !ready || running || !permit} title={!operator ? needText('PRODUCTION') : permit ? '' : 'MES 가동 허가가 있어야 시작할 수 있습니다'} onClick={() => press('HmiStart')}>시작</button>
          <button className="pb stop" disabled={!operator || !ready || !running} title={operator ? '' : needText('PRODUCTION')} onClick={() => press('HmiStop')}>정지</button>
        </div>
        <dl className="field-counts">
          <div><dt>목표</dt><dd>{counts.target}</dd></div>
          <div><dt>투입</dt><dd>{counts.launched}</dd></div>
          <div><dt>불량</dt><dd>{counts.rejected}</dd></div>
          <div><dt>포장</dt><dd>{counts.packed}</dd></div>
          <div><dt>출하</dt><dd>{counts.shipped}</dd></div>
        </dl>
        {isStaticSite && <div className="field-demo"><small>공개 시연 · MES 서버 없이 실행 중</small><div><button disabled={!ready || permit} onClick={() => demoPermit(true)}>MES 허가 (시연)</button><button disabled={!ready || !permit} onClick={() => demoPermit(false)}>허가 해제</button></div></div>}
        {!isStaticSite && !operator && <p className="fine">조작반 시작·정지는 생산 작업자 이상만 누를 수 있습니다. 오른쪽 위에서 로그인하세요.</p>}
        {!isStaticSite && !permit && !running && <p className="fine">MES 허가가 꺼져 있어 시작 버튼이 잠겨 있습니다. PLC도 허가 없이는 시작 신호를 무시합니다(데스크톱의 초록 버튼 포함).</p>}
        {remote && link.field && !running && localTags.M0 === true && <p className="field-pc on">웹 트윈이 데스크톱이 이미 만든 제품을 마저 따라가는 중입니다(탭이 가려져 있던 동안 브라우저가 3D를 멈춰 뒤처진 만큼). 실적은 데스크톱 기준이라 숫자는 늘지 않습니다.</p>}
        {!isStaticSite && <p className={link.field ? 'field-pc on' : 'field-pc'}>{link.field ? '현장 PC의 OIP 데스크톱이 실제 라인입니다 · 이 3D는 데스크톱이 투입한 세트를 같은 순서로 투입하고 같은 판정(양품·불량)을 적용해 따라갑니다. 시작·정지는 데스크톱에 눌립니다' : '현장 PC(OIP 데스크톱) 미연결 · 웹 트윈이 현장입니다'}</p>}
        {link.message && <p className="field-link">{link.message}</p>}
        {notice && <p className="field-notice" role="status">{notice}</p>}
      </div>
    </div>
    <p className="fine">MES는 가동을 허가만 합니다. 허가가 있을 때 현장의 시작 버튼(3D 화면의 초록 버튼 또는 이 조작반)을 눌러야 공정이 돌고, 정지 버튼·허가 해제·목표 달성 시 멈춥니다. 3D 화면은 드래그로 회전, 휠로 확대할 수 있습니다.</p>
  </section>
}
