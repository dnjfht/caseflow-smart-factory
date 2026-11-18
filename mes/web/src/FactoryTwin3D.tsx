import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import './FactoryTwin3D.css'

type Part = { id:string; name:string; package:string; position:[number,number,number]; rotationY:number }
type Cargo = { id:number; product:string; position:[number,number,number]; size:[number,number,number]; color:string; yawDeg:number }
type Layout = { running:boolean; parts:Part[] }
type Runtime = { running:boolean; simTime:number; count:number; cargo:Cargo[]; assemblyPhase?:number; packingPhase?:number; mesStop?:boolean }

const names:Record<string,string>={
  'oip.belt-conveyor':'이송 컨베이어','oip.six-axis-robot':'조립 로봇',
  'oip.box-spawner':'부품 공급기','oip.diffuse-sensor':'감지 센서',
  'oip.diverter':'분류 장치','oip.blade-stop':'정지 장치',
  'factory.stock-display':'자재 적재대','factory.dispatch-truck':'출고 차량',
  'factory.case-cell':'작업 스테이션','oip.despawner':'공정 출구',
}

function labelSprite(text:string){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=100
  const context=canvas.getContext('2d')!;context.fillStyle='#17343fe6';context.roundRect(0,0,512,100,16);context.fill()
  context.font='bold 38px sans-serif';context.fillStyle='white';context.textAlign='center';context.fillText(text,256,64)
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true}));sprite.scale.set(2.3,.45,1)
  return sprite
}

export default function FactoryTwin3D(){
  const host=useRef<HTMLDivElement>(null)
  const [selected,setSelected]=useState<Part|null>(null)
  const [status,setStatus]=useState('현장 연결 중')
  const [time,setTime]=useState(0)
  const [count,setCount]=useState(0)
  const [activity,setActivity]=useState('설비 대기')
  const [renderError,setRenderError]=useState(false)
  useEffect(()=>{
    const element=host.current;if(!element)return
    const scene=new THREE.Scene();scene.background=new THREE.Color('#dbe6e5');scene.fog=new THREE.Fog('#dbe6e5',38,78)
    const camera=new THREE.PerspectiveCamera(48,1,.1,150);camera.position.set(13,20,29)
    let renderer:THREE.WebGLRenderer
    try{renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'})}
    catch{setRenderError(true);setStatus('3D 가속 재시작 필요');return}
    renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.shadowMap.enabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace
    element.appendChild(renderer.domElement)
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(11,0,0);controls.enableDamping=true;controls.maxDistance=65;controls.minDistance=3;controls.maxPolarAngle=Math.PI/2.02;controls.update()
    scene.add(new THREE.HemisphereLight('#ffffff','#a0b8ad',2.2))
    const sun=new THREE.DirectionalLight('#ffffff',2.3);sun.position.set(8,20,12);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-34;sun.shadow.camera.right=34;sun.shadow.camera.top=22;sun.shadow.camera.bottom=-22;scene.add(sun)
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(72,24),new THREE.MeshStandardMaterial({color:'#c4ccc9',roughness:.94}));ground.rotation.x=-Math.PI/2;ground.position.set(11,-.06,0);ground.receiveShadow=true;scene.add(ground)
    const grid=new THREE.GridHelper(72,72,'#9caeaa','#b8c5c1');grid.position.set(11,-.04,0);scene.add(grid)
    const staticGroup=new THREE.Group();scene.add(staticGroup)
    const dynamicGroup=new THREE.Group();scene.add(dynamicGroup)
    const cargoMeshes=new Map<number,{mesh:THREE.Mesh;target:THREE.Vector3;seen:boolean}>()
    const partMeshes:THREE.Object3D[]=[]
    const robotArms:THREE.Group[]=[]
    const packingHeads:THREE.Group[]=[]
    let assemblyPhase=0,packingPhase=0,stopped=true
    const box=(parent:THREE.Object3D,size:[number,number,number],color:string,x=0,y=0,z=0)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.68,metalness:.12}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh
    }
    // Architectural pieces are display-only; every moving product still follows OIP coordinates.
    box(scene,[31,.025,.055],'#eab94d',11,-.018,-2.0)
    box(scene,[31,.025,.055],'#eab94d',11,-.018,3.4)
    for(let x=-4;x<30;x+=4){
      box(scene,[.12,4.5,.12],'#6f8588',x,2.2,-6.2)
      box(scene,[.09,.09,10],'#87999a',x,4.45,-1.2)
      box(scene,[1.6,.035,.035],'#e9f6eb',x,4.34,-2)
    }
    box(scene,[35,3.2,.08],'#bdc9c4',11,2.75,-6.35)
    for(let x=-3;x<29;x+=3.5)box(scene,[2.8,1.35,.06],'#79a3a6',x,2.6,-6.27)
    const resize=()=>{const width=Math.max(1,Math.min(element.clientWidth,2400)),height=Math.max(1,element.clientHeight);camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false)}
    const observer=new ResizeObserver(resize);observer.observe(element);resize()
    let disposed=false
    fetch('/api/scene/layout',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('현장 연결 대기');return r.json() as Promise<Layout>}).then(layout=>{
      if(disposed)return
      for(const part of layout.parts){
        const group=new THREE.Group();group.position.set(...part.position);group.rotation.y=part.rotationY||0;group.userData.part=part
        staticGroup.add(group)
        if(part.package==='oip.belt-conveyor'){
          const branch=part.id?.toLowerCase().includes('reject');const length=branch?3.5:4.0
          box(group,[length,.19,.72],'#294d55',0,-.04,0)
          box(group,[length,.035,.53],branch?'#b67a59':'#477d83',0,.07,0)
          box(group,[length,.1,.045],'#a7b6b7',0,.14,-.34)
          box(group,[length,.1,.045],'#a7b6b7',0,.14,.34)
          for(let x=-length/2+.25;x<length/2;x+=.45){
            const roller=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.58,10),new THREE.MeshStandardMaterial({color:'#bac9c9',metalness:.4,roughness:.35}));roller.rotation.x=Math.PI/2;roller.position.set(x,.087,0);group.add(roller)
          }
          for(const sign of [-1,1])for(const end of [-1,1])box(group,[.07,.76,.07],'#748e8e',end*(length/2-.2),-.48,sign*.26)
          partMeshes.push(...group.children)
        }else if(part.package==='oip.six-axis-robot'){
          const body=new THREE.MeshStandardMaterial({color:'#e8eeec',roughness:.36,metalness:.15})
          const joint=new THREE.MeshStandardMaterial({color:'#537993',roughness:.43,metalness:.2})
          const cylinder=(parent:THREE.Object3D,radius:number,length:number,x:number,y:number,z:number,angle=0)=>{
            const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,24),body)
            mesh.position.set(x,y,z);mesh.rotation.z=angle;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh)
          }
          const pivot=(parent:THREE.Object3D,radius:number,x:number,y:number,z:number)=>{
            const mesh=new THREE.Mesh(new THREE.SphereGeometry(radius,20,14),joint)
            mesh.position.set(x,y,z);mesh.castShadow=true;parent.add(mesh)
          }
          box(group,[.76,.12,.76],'#355866',0,.08,0)
          cylinder(group,.22,.55,0,.41,0)
          pivot(group,.26,0,.72,0)
          const arm=new THREE.Group();arm.position.y=.72;group.add(arm);robotArms.push(arm)
          cylinder(arm,.17,.73,.23,.31,0,-.72)
          pivot(arm,.22,.46,.62,0)
          cylinder(arm,.145,.64,.72,.84,0,-.82)
          pivot(arm,.17,.96,1.06,0)
          cylinder(arm,.105,.31,1.04,.86,0,.42)
          box(arm,[.12,.34,.15],'#486777',1.08,.63,0)
          for(const x of [-.08,.08])box(arm,[.045,.22,.045],'#344d55',1.08+x,.42,0)
          partMeshes.push(...group.children,...arm.children)
        }else if(part.package==='oip.box-spawner'){
          box(group,[.7,.15,.65],'#364f55',0,.55,0);box(group,[.09,.9,.09],'#738d89',-.3,.1,-.27);box(group,[.09,.9,.09],'#738d89',.3,.1,.27)
          box(group,[.48,.32,.42],'#d7aa62',0,.37,0);partMeshes.push(...group.children)
        }else if(part.package==='factory.stock-display'){
          for(const shelf of [.25,.9,1.55])box(group,[1.8,.08,1.1],'#657985',0,shelf,0)
          for(const x of [-.82,.82])for(const z of [-.48,.48])box(group,[.09,1.8,.09],'#455b60',x,.9,z)
          for(const shelf of [.48,1.13])for(const x of [-.47,.47])box(group,[.65,.42,.73],'#ba8c52',x,shelf,0)
          partMeshes.push(...group.children)
        }else if(part.package==='factory.dispatch-truck'){
          box(group,[2.5,.12,1.25],'#2c4652',0,.42,0);box(group,[2.2,.72,1.22],'#426a7a',-.2,.85,0)
          box(group,[.74,1.0,1.18],'#e0e9e6',1.3,.77,0);box(group,[.05,.42,.8],'#80aab3',1.68,.98,0)
          for(const x of [-.8,1.25])for(const z of [-.55,.55]){
            const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.24,.24,.11,16),new THREE.MeshStandardMaterial({color:'#1b2c30',roughness:.85}));wheel.rotation.x=Math.PI/2;wheel.position.set(x,.27,z);group.add(wheel)
          }
          partMeshes.push(...group.children)
        }else if(part.package==='oip.diffuse-sensor'){
          box(group,[.035,.6,.035],'#637d7c',0,-.3,0);box(group,[.13,.17,.15],'#356c72');box(group,[.025,.06,.06],'#7cdab0',.08,.02,0);partMeshes.push(...group.children)
        }else if(part.package==='oip.diverter'||part.package==='oip.blade-stop'){
          box(group,[.4,.22,.5],'#c57b55');partMeshes.push(...group.children)
        }else if(part.package==='factory.case-cell'){
          const station=part.position[0]<6?'조립':part.position[0]<12?'검사':'포장'
          const marker=labelSprite(station);marker.position.set(0,1.7,0);group.add(marker)
          for(const x of [-.75,.75])box(group,[.055,1.75,.055],'#527d79',x,.85,-.65)
          box(group,[1.65,.09,.11],'#4d7774',0,1.72,-.65)
          if(station==='포장'){
            const head=new THREE.Group();head.position.set(0,1.5,0);group.add(head);packingHeads.push(head)
            box(head,[.7,.13,.7],'#6d8793')
            for(const side of [-1,1])box(head,[.09,.48,.7],'#a2b2ad',side*.38,-.26,0)
            box(group,[.9,.09,.8],'#c79b69',0,.16,0)
          }
        }
      }
      setStatus(layout.running?'실시간 연결':'현장 대기')
    }).catch(()=>{if(!disposed)setStatus('현장 연결 대기')})
    const update=async()=>{
      try{
        const response=await fetch('/api/scene/runtime',{cache:'no-store'});if(!response.ok)throw Error()
        const state=await response.json() as Runtime;if(disposed)return
        for(const value of cargoMeshes.values())value.seen=false
        for(const item of state.cargo){
          let value=cargoMeshes.get(item.id)
          if(!value){
            const mesh=box(dynamicGroup,item.size,item.color||'#d5a86b');mesh.position.set(...item.position)
            value={mesh,target:new THREE.Vector3(...item.position),seen:true};cargoMeshes.set(item.id,value)
          }
          value.target.set(...item.position);value.mesh.rotation.y=(item.yawDeg||0)*Math.PI/180;value.seen=true
        }
        for(const [id,value] of cargoMeshes)if(!value.seen){dynamicGroup.remove(value.mesh);value.mesh.geometry.dispose();(value.mesh.material as THREE.Material).dispose();cargoMeshes.delete(id)}
        setTime(Number.isFinite(state.simTime)?state.simTime:0)
        setCount(Number.isFinite(state.count)?state.count:0)
        setStatus(state.running?'실시간 연결':'현장 대기')
        assemblyPhase=state.assemblyPhase??0;packingPhase=state.packingPhase??0;stopped=state.mesStop??true
        setActivity(stopped?'현장 정지':assemblyPhase===1?'로봇 조립 중':assemblyPhase===2?'조립품 배출 중':packingPhase===1?'포장 중':packingPhase===2?'포장품 배출 중':'설비 대기')
      }catch{if(!disposed)setStatus('현장 연결 대기')}
    }
    void update();const poll=window.setInterval(update,350)
    const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2()
    const click=(event:MouseEvent)=>{
      const bounds=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1)
      raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(partMeshes)
      let object:THREE.Object3D|null=hits[0]?.object||null;while(object&&!object.userData.part)object=object.parent
      setSelected((object?.userData.part as Part)||null)
    }
    renderer.domElement.addEventListener('click',click)
    let frame=0
    const draw=()=>{controls.update();for(const value of cargoMeshes.values())value.mesh.position.lerp(value.target,.28)
      const t=performance.now()*.001
      for(const arm of robotArms){const active=!stopped&&assemblyPhase>0;arm.rotation.y=THREE.MathUtils.lerp(arm.rotation.y,active?Math.sin(t*3)*.55:0,.1);arm.rotation.z=THREE.MathUtils.lerp(arm.rotation.z,active?Math.sin(t*3+1)*.13:0,.1)}
      for(const head of packingHeads)head.position.y=THREE.MathUtils.lerp(head.position.y,!stopped&&packingPhase===1?1.12:1.5,.1)
      renderer.render(scene,camera);frame=requestAnimationFrame(draw)};draw()
    return()=>{disposed=true;clearInterval(poll);cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('click',click);controls.dispose();scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(material=>material.dispose())}});renderer.dispose();element.removeChild(renderer.domElement)}
  },[])
  return <div className="factory-twin-wrap"><div className="factory-twin-canvas" ref={host}>{renderError&&<div className="factory-twin-fallback"><img src="/assets/factory/factory-preview.jpg" alt="현장 설비 미리보기"/><p>브라우저의 3D 가속이 중지됐습니다. 브라우저를 다시 실행하면 실시간 3D 화면을 볼 수 있습니다.</p></div>}</div><div className="factory-twin-bar"><span className={status==='실시간 연결'?'ok':''}>● {status}</span><span>{activity}</span><span>현장 시간 {time.toFixed(1)}초</span><span>이송 중 제품 {count}개</span><span>드래그 회전 · 휠 확대 · 우클릭 이동</span></div>{selected&&<div className="factory-twin-selected"><strong>{selected.name||names[selected.package]||'설비'}</strong><span>{names[selected.package]||'공정 설비'} · 위치 {selected.position.map(v=>v.toFixed(1)).join(', ')} m</span><button onClick={()=>setSelected(null)}>닫기</button></div>}</div>
}
