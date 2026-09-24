import type { ApprovalRuleKey } from './approval-presets.ts';
import { randomUUID } from 'node:crypto';
export interface AutoApprovalEntry { id:string;session:string;title:string;tool:string;command:string;tier:'safe'|'grey'|'medium';at:number;rule?:ApprovalRuleKey }
export class AutoApprovalState {
  private entries:AutoApprovalEntry[]=[];
  private now:()=>number;
  constructor(now=Date.now){this.now=now;}
  add(entry:Omit<AutoApprovalEntry,'id'|'at'>):void{
    if(!['safe','grey','medium'].includes(entry.tier))throw Error('High-risk requests cannot be automatically approved');
    this.entries.unshift({...entry,id:randomUUID(),at:this.now(),command:Array.from(entry.command).slice(0,300).join(''),
      ...(entry.rule?{rule:{...entry.rule}}:{})});
    this.entries=this.entries.slice(0,5);
  }
  list():AutoApprovalEntry[]{return this.entries.map(entry=>({...entry,...(entry.rule?{rule:{...entry.rule}}:{})}));}
  revoke(rule:ApprovalRuleKey):void{
    for(const entry of this.entries)if(entry.rule?.tool===rule.tool && entry.rule.workspace===rule.workspace && entry.rule.fingerprint===rule.fingerprint)delete entry.rule;
  }
}
