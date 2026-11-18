// Displays MES inventory, mirrored from the database to a PLC word. Visual quantities only.
definePart({
  params: {
    capacity: {type:'number', default:10, min:10, max:10, step:1, hidden:true, desc:'Visual shelf slots.'},
    stockTag: {type:'tag', dir:'in', stType:'INT', default:'', label:'MES stock word', desc:'PLC word updated with MES LOT stock.'},
    item: {type:'string', default:'MATERIAL', label:'Item', desc:'Material name shown on the rack.'}
  },
  step(ctx) {
    const stock = Math.max(0, ctx.params.stockTag ? ctx.readNumber(ctx.params.stockTag) : 0)
    for (let i=0; i<10; i++) {
      const x = -.40 + (i%5)*.20
      const y = .28 + Math.floor(i/5)*.20
      ctx.setSubPose('box', {position:[x, i<stock ? y : -20, 0]}, i)
    }
    ctx.display('readout', ctx.params.item + '  ' + stock + ' EA')
  }
})
