// A clearly labelled public preview loop. The local MES always uses OIP positions instead.
const started = performance.now()
type PreviewCargo = { id:number; product:string; position:[number,number,number]; size:[number,number,number]; color:string; yawDeg:number }

export function previewScene(){
  const time=(performance.now()-started)/1000
  const cargo:PreviewCargo[]=[]
  let assemblyPhase=0,inspectionPhase=0,packingPhase=0,rejectDiverter=false
  const put=(id:number,x:number,z:number,color:string,height=.18)=>cargo.push({id,product:'CASE',position:[x,.94+height/2,z],size:[.3,height,.3],color,yawDeg:0})
  for(let lane=0;lane<4;lane++){
    const phase=(time+lane*7)%28
    const reject=lane===2
    if(phase<3){
      put(lane*10+1,.7+phase*.9,0,'#d5a86b',.15)
      put(lane*10+2,.7+phase*.9,2.4,'#367db5',.1)
    }else if(phase<5){
      assemblyPhase=1
      put(lane*10+1,3.4,0,'#d5a86b',.15)
      put(lane*10+2,3.4,2.4-(phase-3)*1.2,'#367db5',.1)
    }else if(phase<11){
      put(lane*10+3,3.4+(phase-5)*.98,0,'#c6a36b',.23)
    }else if(phase<12){
      inspectionPhase=1
      put(lane*10+3,9.3,0,'#c6a36b',.23)
    }else if(reject&&phase<17){
      rejectDiverter=true
      put(lane*10+3,11.2,Math.min(4.1,(phase-12)*.83),'#c9816c',.23)
    }else if(phase<17){
      put(lane*10+3,9.3+(phase-12)*.98,0,'#c6a36b',.23)
    }else if(!reject&&phase<19){
      packingPhase=1
      put(lane*10+3,14.2,0,'#c6a36b',.23)
    }else if(!reject){
      put(lane*10+4,14.2+(phase-19)*1.13,0,'#b58a55',.3)
    }
  }
  return {preview:true,running:false,simTime:time,count:cargo.length,cargo,assemblyPhase,inspectionPhase,packingPhase,rejectDiverter,bodyStopper:assemblyPhase===1,lidStopper:assemblyPhase===1,mesStop:false}
}
