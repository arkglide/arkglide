import {useState} from 'react';
import {TextField,type TextFieldProps} from '@mui/material';

// Keep incomplete signed/decimal input local until it becomes a finite number.
export function ScalarField({value,onValueChange,...props}:Omit<TextFieldProps,'value'|'onChange'|'type'> & {value:number;onValueChange:(value:number)=>void}){
 const [draft,setDraft]=useState<string|null>(null);
 const display=Number.isFinite(value)?String(value):'';
 return <TextField {...props} type="number" value={draft??display}
  onFocus={()=>setDraft(display)} onBlur={()=>setDraft(null)}
  onChange={event=>{const text=event.target.value;setDraft(text);if(text.trim()&&Number.isFinite(Number(text))&&Number(text)!==value)onValueChange(Number(text));}}
 />;
}
