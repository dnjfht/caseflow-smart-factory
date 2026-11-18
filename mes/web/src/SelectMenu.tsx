import { useEffect, useRef, useState } from 'react'
import './SelectMenu.css'

export type SelectOption = { value:string; label:string }

export default function SelectMenu({value,options,onChange,disabled=false,ariaLabel,className=''}:{value:string;options:SelectOption[];onChange:(value:string)=>void;disabled?:boolean;ariaLabel:string;className?:string}){
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(!open)return;const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[open])
  useEffect(()=>{if(disabled)setOpen(false)},[disabled])
  const selected=options.find(option=>option.value===value)
  return <div ref={root} className={`select-menu ${className}${open?' is-open':''}`}>
    <button type="button" className="select-menu-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(current=>!current)} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const current=options.findIndex(option=>option.value===value),next=(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;onChange(options[next].value)}}}>
      <span>{selected?.label||'선택하세요'}</span><i aria-hidden="true"/>
    </button>
    {open&&<div className="select-menu-options" role="listbox" aria-label={ariaLabel}>{options.map(option=><button key={option.value} type="button" role="option" aria-selected={option.value===value} onClick={()=>{onChange(option.value);setOpen(false)}}>{option.label}</button>)}</div>}
  </div>
}
