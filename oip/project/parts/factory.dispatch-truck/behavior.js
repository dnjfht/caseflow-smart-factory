// PLC exit count draws a waiting truck's load, then its target departure.
// The shipping outlet still removes the physical case; these load boxes are visual proxies.
let departure = 0
definePart({
  params: {
    capacity:{type:'number',default:10,min:10,max:10,step:1,hidden:true,desc:'Truck load slots.'},
    loadTag:{type:'tag',dir:'in',stType:'INT',default:'',label:'Exit count',desc:'PLC accepted finished cases at exit.'},
    targetTag:{type:'tag',dir:'in',stType:'INT',default:'',label:'Target',desc:'PLC work order target.'}
  },
  step(ctx) {
    const loaded = Math.max(0, ctx.params.loadTag ? ctx.readNumber(ctx.params.loadTag) : 0)
    const target = Math.max(1, ctx.params.targetTag ? ctx.readNumber(ctx.params.targetTag) : 1)
    if (loaded >= target) departure = Math.min(8, departure + ctx.dt*.65)
    ctx.setSubPose('truck',{position:[departure,0,0]})
    for(let i=0;i<10;i++) {
      const x = -.91 + (i%5)*.45
      const y = .99 + Math.floor(i/5)*.31
      ctx.setSubPose('cargo',{position:[x, i<loaded ? y : -20, (i%2 ? .27 : -.27)]},i)
    }
    ctx.display('readout', loaded>=target ? 'DISPATCH '+loaded+'/'+target : 'WAIT '+loaded+'/'+target)
  }
})
