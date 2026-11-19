import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import './FactoryTwin3D.css'

type Part = { id:string; name:string; package:string; position:[number,number,number]; rotationY:number }
type Cargo = { id:number; product:string; position:[number,number,number]; size:[number,number,number]; color:string; yawDeg:number }
type Layout = { running:boolean; parts:Part[] }
type Runtime = { running:boolean; preview?:boolean; simTime:number; count:number; cargo:Cargo[]; assemblyPhase?:number; inspectionPhase?:number; packingPhase?:number; rejected?:number; packed?:number; motorRunning?:boolean; bodyStopper?:boolean; lidStopper?:boolean; rejectDiverter?:boolean; mesStop?:boolean }
type RigLink = {name:string;parent?:string;shape:{kind:string;node?:string};offset:[number,number,number];quat?:[number,number,number,number]}
type RigFile = {geometry:{links:RigLink[]}}

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
    const scene=new THREE.Scene();scene.background=new THREE.Color('#ccd9d8');scene.fog=new THREE.Fog('#ccd9d8',42,85)
    const camera=new THREE.PerspectiveCamera(48,1,.1,150);camera.position.set(13,15,24)
    const compact=window.matchMedia('(max-width:700px)').matches
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if(compact)camera.position.set(11,11,19)
    let renderer:THREE.WebGLRenderer
    try{renderer=new THREE.WebGLRenderer({antialias:!compact,powerPreference:compact?'low-power':'high-performance'})}
    catch{setRenderError(true);setStatus('3D 가속 재시작 필요');return}
    renderer.setPixelRatio(Math.min(devicePixelRatio,compact?1:1.35));renderer.shadowMap.enabled=!compact;renderer.outputColorSpace=THREE.SRGBColorSpace
    element.appendChild(renderer.domElement)
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(11,0,0);controls.enableDamping=true;controls.maxDistance=65;controls.minDistance=3;controls.maxPolarAngle=Math.PI/2.02;controls.update()
    scene.add(new THREE.HemisphereLight('#ffffff','#8fa5a5',2.0))
    const sun=new THREE.DirectionalLight('#fff8e8',2.4);sun.position.set(8,20,12);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-34;sun.shadow.camera.right=34;sun.shadow.camera.top=22;sun.shadow.camera.bottom=-22;scene.add(sun)
    const floorTexture=new THREE.TextureLoader().load('/twin-assets/BuildingFloor.webp')
    floorTexture.wrapS=floorTexture.wrapT=THREE.RepeatWrapping;floorTexture.repeat.set(18,6);floorTexture.colorSpace=THREE.SRGBColorSpace
    const beltTexture=new THREE.TextureLoader().load('/twin-assets/BeltFabric.jpg')
    beltTexture.wrapS=beltTexture.wrapT=THREE.RepeatWrapping;beltTexture.repeat.set(5,1);beltTexture.colorSpace=THREE.SRGBColorSpace
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(72,24),new THREE.MeshStandardMaterial({map:floorTexture,color:'#d5dedb',roughness:.92}));ground.rotation.x=-Math.PI/2;ground.position.set(11,-.06,0);ground.receiveShadow=true;scene.add(ground)
    const grid=new THREE.GridHelper(72,72,'#a4b4b1','#bac8c4');grid.position.set(11,-.04,0);scene.add(grid)
    const staticGroup=new THREE.Group();scene.add(staticGroup)
    const dynamicGroup=new THREE.Group();scene.add(dynamicGroup)
    const cargoMeshes=new Map<number,{mesh:THREE.Mesh;target:THREE.Vector3;seen:boolean}>()
    const partMeshes:THREE.Object3D[]=[]
    const robotArms:THREE.Group[]=[]
    const robotWrists:THREE.Group[]=[]
    const robotStations:THREE.Group[]=[]
    const detailedRobotJoints:Array<{base:THREE.Group;upper:THREE.Group;forearm:THREE.Group;wrist:THREE.Group}>=[]
    const stopBlades:Array<{id:string;blade:THREE.Group}>=[]
    const diverterArms:THREE.Group[]=[]
    const inspectionLamps:THREE.MeshStandardMaterial[]=[]
    const sensorIndicators:Array<{material:THREE.MeshStandardMaterial;stage:number}>=[]
    const packingHeads:THREE.Group[]=[]
    let assemblyPhase=0,inspectionPhase=0,packingPhase=0,stopped=true
    let bodyStopper=false,lidStopper=false,rejectDiverter=false
    const box=(parent:THREE.Object3D,size:[number,number,number],color:string,x=0,y=0,z=0)=>{
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.68,metalness:.12}));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh
    }
    // Architectural pieces are display-only; every moving product still follows OIP coordinates.
    box(scene,[31,.025,.055],'#e5ad3b',11,-.018,-2.0)
    box(scene,[31,.025,.055],'#e5ad3b',11,-.018,3.4)
    for(let x=-3;x<29;x+=2){
      box(scene,[.6,.027,.06],'#e8b84e',x,-.016,-1.98)
      box(scene,[.6,.027,.06],'#e8b84e',x,-.016,3.38)
    }
    for(let x=-4;x<30;x+=4){
      box(scene,[.12,4.5,.12],'#6f8588',x,2.2,-6.2)
      box(scene,[.09,.09,10],'#87999a',x,4.45,-1.2)
      box(scene,[1.6,.035,.035],'#effcf8',x,4.34,-2)
      box(scene,[1.6,.07,.5],'#e8f5f0',x,4.38,-2)
    }
    box(scene,[35,3.2,.08],'#bdc9c4',11,2.75,-6.35)
    for(let x=-3;x<29;x+=3.5)box(scene,[2.8,1.35,.06],'#79a3a6',x,2.6,-6.27)
    for(const z of [-3.6,4.35]){
      for(let x=-3;x<29;x+=2.5){
        box(scene,[.055,1.35,.055],'#5f777a',x,.67,z)
        box(scene,[2.5,.06,.06],'#617e7e',x+1.25,1.29,z)
        box(scene,[2.5,.035,.035],'#708987',x+1.25,.48,z)
      }
    }
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
          const belt=box(group,[length,.035,.53],branch?'#b67a59':'#d7e4e2',0,.07,0)
          ;(belt.material as THREE.MeshStandardMaterial).map=beltTexture
          ;(belt.material as THREE.MeshStandardMaterial).needsUpdate=true
          box(group,[length,.1,.045],'#a7b6b7',0,.14,-.34)
          box(group,[length,.1,.045],'#a7b6b7',0,.14,.34)
          box(group,[length-.18,.025,.08],'#223e49',0,.16,-.31)
          box(group,[length-.18,.025,.08],'#223e49',0,.16,.31)
          for(let x=-length/2+.25;x<length/2;x+=.45){
            const roller=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.58,10),new THREE.MeshStandardMaterial({color:'#bac9c9',metalness:.4,roughness:.35}));roller.rotation.x=Math.PI/2;roller.position.set(x,.087,0);group.add(roller)
          }
          for(const sign of [-1,1])for(const end of [-1,1])box(group,[.07,.76,.07],'#748e8e',end*(length/2-.2),-.48,sign*.26)
          box(group,[.42,.34,.38],'#5e7a80',length/2-.32,-.27,.53)
          box(group,[.34,.1,.28],'#364f58',length/2-.32,-.02,.53)
          partMeshes.push(...group.children)
        }else if(part.package==='oip.six-axis-robot'){
          robotStations.push(group)
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
          const wrist=new THREE.Group();wrist.position.set(.96,1.06,0);arm.add(wrist);robotWrists.push(wrist)
          cylinder(wrist,.105,.31,.08,-.2,0,.42)
          box(wrist,[.19,.18,.19],'#486777',.12,-.4,0)
          for(const x of [-.1,.1])box(wrist,[.045,.22,.045],'#344d55',.12+x,-.56,0)
          const cable=new THREE.Mesh(new THREE.TorusGeometry(.28,.025,6,18,Math.PI),new THREE.MeshStandardMaterial({color:'#2a434d',roughness:.9}));cable.rotation.z=Math.PI/2;cable.position.set(.49,.63,-.2);arm.add(cable)
          for(const x of [-.32,.32])for(const z of [-.32,.32])box(group,[.07,.03,.07],'#d8ad58',x,.16,z)
          partMeshes.push(...group.children,...arm.children,...wrist.children)
        }else if(part.package==='oip.box-spawner'){
          box(group,[.7,.15,.65],'#364f55',0,.55,0);box(group,[.09,.9,.09],'#738d89',-.3,.1,-.27);box(group,[.09,.9,.09],'#738d89',.3,.1,.27)
          box(group,[.48,.32,.42],'#d7aa62',0,.37,0)
          box(group,[.6,.07,.53],'#af7c49',0,.59,0)
          box(group,[.17,.22,.08],'#4f7882',.35,.35,.25)
          partMeshes.push(...group.children)
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
          box(group,[.035,.6,.035],'#637d7c',0,-.3,0);box(group,[.13,.17,.15],'#356c72')
          const indicator=new THREE.MeshStandardMaterial({color:'#408b79',emissive:'#173d34',emissiveIntensity:.4})
          const diode=new THREE.Mesh(new THREE.BoxGeometry(.025,.06,.06),indicator);diode.position.set(.08,.02,0);group.add(diode)
          sensorIndicators.push({material:indicator,stage:part.position[0]<6?0:part.position[0]<12?1:2})
          box(group,[.28,.035,.28],'#304a51',0,-.59,0)
          partMeshes.push(...group.children)
        }else if(part.package==='oip.diverter'||part.package==='oip.blade-stop'){
          box(group,[.46,.22,.52],'#526c74',0,-.12,0)
          box(group,[.33,.11,.4],'#d89354',0,.05,0)
          const blade=new THREE.Group();group.add(blade)
          if(part.package==='oip.diverter'){
            box(blade,[.72,.07,.13],'#dfad67',.27,.17,0)
            box(group,[.18,.22,.2],'#344d58',-.1,.08,0)
            diverterArms.push(blade)
          }else{
            box(blade,[.1,.32,.54],'#d8a15a',0,.16,0)
            stopBlades.push({id:part.id,blade})
          }
          partMeshes.push(...group.children,...blade.children)
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
            box(group,[1.8,.06,.08],'#d7a34b',0,.18,.65)
          }else if(station==='검사'){
            box(group,[.28,.28,.32],'#456579',0,1.47,-.62)
            const lens=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,.13,16),new THREE.MeshStandardMaterial({color:'#182f39',metalness:.5,roughness:.25}));lens.rotation.x=Math.PI/2;lens.position.set(0,1.4,-.38);group.add(lens)
            const lamp=box(group,[1.1,.035,.05],'#d8edea',0,1.49,-.58)
            inspectionLamps.push(lamp.material as THREE.MeshStandardMaterial)
          }else{
            box(group,[.6,.22,.4],'#617f87',-.85,.22,-.45)
            box(group,[.16,.08,.14],'#d95042',-.85,.39,-.37)
          }
        }
      }
      // The production GLB and its rig definition come from the MIT-licensed browser simulator.
      // Keep the procedural arm as a visible fallback until the model and Draco decoder have loaded.
      const draco=new DRACOLoader();draco.setDecoderPath('/twin-assets/draco/')
      const loader=new GLTFLoader();loader.setDRACOLoader(draco)
      Promise.all([
        new Promise<THREE.Group>((resolve,reject)=>loader.load('/twin-assets/SixAxisRobot.glb',g=>resolve(g.scene),undefined,reject)),
        fetch('/twin-assets/rig.json').then(r=>r.json() as Promise<RigFile>),
        new THREE.TextureLoader().loadAsync('/twin-assets/BaseColor.webp'),
        new THREE.TextureLoader().loadAsync('/twin-assets/ORM.webp'),
      ]).then(([model,rig,colorMap,ormMap])=>{
        if(disposed)return
        colorMap.colorSpace=THREE.SRGBColorSpace
        const material=new THREE.MeshStandardMaterial({map:colorMap,roughnessMap:ormMap,metalnessMap:ormMap,metalness:.12,roughness:.7})
        const source=new Map<string,THREE.Mesh>()
        model.traverse(node=>{if(node instanceof THREE.Mesh)source.set(node.name,node)})
        for(const station of robotStations){
          const rigRoot=new THREE.Group();station.add(rigRoot)
          const links=new Map<string,THREE.Group>()
          for(const link of rig.geometry.links){
            const pivot=new THREE.Group();pivot.name=link.name;pivot.position.set(...link.offset)
            if(link.quat)pivot.quaternion.set(...link.quat)
            ;(link.parent?links.get(link.parent):rigRoot)?.add(pivot);links.set(link.name,pivot)
            const mesh=link.shape.node?source.get(link.shape.node):undefined
            if(mesh){const copy=mesh.clone();copy.material=material;copy.castShadow=true;copy.receiveShadow=true;pivot.add(copy);partMeshes.push(copy)}
          }
          const base=links.get('basePivot'),upper=links.get('upperArm'),forearm=links.get('forearm'),wrist=links.get('wristPitch')
          if(base&&upper&&forearm&&wrist)detailedRobotJoints.push({base,upper,forearm,wrist})
          // Hide the fallback only after the detailed rig is complete.
          for(const child of station.children)if(child!==rigRoot)child.visible=false
        }
      }).catch(error=>console.warn('Robot model unavailable; using lightweight arm',error)).finally(()=>draco.dispose())
      setStatus(layout.running?'실시간 연결':'현장 대기')
    }).catch(()=>{if(!disposed)setStatus('현장 연결 대기')})
    let inFlight=false
    const update=async()=>{
      if(inFlight)return
      inFlight=true
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
        setStatus(state.preview?'예시 공정 재생':state.running?'실시간 연결':'현장 대기')
        assemblyPhase=state.assemblyPhase??0;inspectionPhase=state.inspectionPhase??0;packingPhase=state.packingPhase??0;stopped=state.mesStop??true
        bodyStopper=state.bodyStopper??false;lidStopper=state.lidStopper??false;rejectDiverter=state.rejectDiverter??false
        setActivity(stopped?'현장 정지':assemblyPhase===1?'로봇 조립 중':packingPhase===1?'양품 포장 중':inspectionPhase===1?'품질 검사 중':rejectDiverter?'불량 분류 중':assemblyPhase===2?'조립품 배출 중':packingPhase===2?'포장품 배출 중':'이송·부품 공급 중')
      }catch{if(!disposed)setStatus('현장 연결 대기')}
      finally{inFlight=false}
    }
    void update();const poll=window.setInterval(update,compact?700:450)
    const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2()
    const click=(event:MouseEvent)=>{
      const bounds=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1)
      raycaster.setFromCamera(pointer,camera);const hits=raycaster.intersectObjects(partMeshes)
      let object:THREE.Object3D|null=hits[0]?.object||null;while(object&&!object.userData.part)object=object.parent
      setSelected((object?.userData.part as Part)||null)
    }
    renderer.domElement.addEventListener('click',click)
    let frame=0,lastFrame=0
    const draw=(now:number)=>{frame=requestAnimationFrame(draw)
      if(now-lastFrame<(reducedMotion?100:compact?42:30))return
      lastFrame=now;controls.update();for(const value of cargoMeshes.values())value.mesh.position.lerp(value.target,.38)
      const t=now*.001
      for(const arm of robotArms){const active=!stopped&&assemblyPhase>0;arm.rotation.y=THREE.MathUtils.lerp(arm.rotation.y,active?Math.sin(t*3)*.55:0,.1);arm.rotation.z=THREE.MathUtils.lerp(arm.rotation.z,active?Math.sin(t*3+1)*.13:0,.1)}
      for(const wrist of robotWrists)wrist.rotation.z=THREE.MathUtils.lerp(wrist.rotation.z,!stopped&&assemblyPhase>0?Math.sin(t*4+.7)*.38:0,.12)
      for(const joints of detailedRobotJoints){const active=!stopped&&assemblyPhase>0
        joints.base.rotation.y=THREE.MathUtils.lerp(joints.base.rotation.y,active?Math.sin(t*2.4)*.55:0,.1)
        joints.upper.rotation.z=THREE.MathUtils.lerp(joints.upper.rotation.z,active?-.35+Math.sin(t*2.4+.7)*.22:0,.1)
        joints.forearm.rotation.z=THREE.MathUtils.lerp(joints.forearm.rotation.z,active?.42+Math.sin(t*2.4+1.2)*.26:0,.1)
        joints.wrist.rotation.z=THREE.MathUtils.lerp(joints.wrist.rotation.z,active?Math.sin(t*2.4+2)*.35:0,.1)
      }
      for(const head of packingHeads)head.position.y=THREE.MathUtils.lerp(head.position.y,!stopped&&packingPhase===1?1.12:1.5,.1)
      for(const {id,blade} of stopBlades){const extended=!stopped&&(id.toLowerCase().includes('body')?bodyStopper:lidStopper);blade.position.y=THREE.MathUtils.lerp(blade.position.y,extended ? .17 : -.12,.2)}
      for(const blade of diverterArms)blade.rotation.y=THREE.MathUtils.lerp(blade.rotation.y,!stopped&&rejectDiverter?-.6:0,.2)
      for(const material of inspectionLamps){material.emissive.set(inspectionPhase===1&&!stopped?'#a9f4df':'#152b31');material.emissiveIntensity=inspectionPhase===1&&!stopped?1.2:.15}
      for(const {material,stage} of sensorIndicators){const active=!stopped&&[assemblyPhase,inspectionPhase,packingPhase][stage]===1;material.emissive.set(active?'#8bffd5':'#173d34');material.emissiveIntensity=active?1:.35}
      renderer.render(scene,camera)};frame=requestAnimationFrame(draw)
    return()=>{disposed=true;clearInterval(poll);cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('click',click);controls.dispose();scene.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(material=>material.dispose())}});floorTexture.dispose();beltTexture.dispose();renderer.dispose();element.removeChild(renderer.domElement)}
  },[])
  return <div className="factory-twin-wrap"><div className="factory-twin-canvas" ref={host}>{renderError&&<div className="factory-twin-fallback"><p>브라우저의 3D 가속이 중지됐습니다. 브라우저를 다시 실행하면 현장 화면을 볼 수 있습니다.</p></div>}</div><div className="factory-twin-bar"><span className={status==='실시간 연결'?'ok':''}>● {status}</span><span>{activity}</span><span>현장 시간 {time.toFixed(1)}초</span><span>이송 중 제품 {count}개</span><span>드래그 회전 · 휠 확대 · 우클릭 이동</span></div>{selected&&<div className="factory-twin-selected"><strong>{selected.name||names[selected.package]||'설비'}</strong><span>{names[selected.package]||'공정 설비'} · 위치 {selected.position.map(v=>v.toFixed(1)).join(', ')} m</span><button onClick={()=>setSelected(null)}>닫기</button></div>}</div>
}
