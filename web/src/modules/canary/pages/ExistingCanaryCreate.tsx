import { useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Button, CodeBlock, FieldInput, FieldNumber, FieldSelect, FloatingField, PageBanner, SectionCard, Switch } from "@modelsphere/ui";
import { ErrorNotice } from "../components/ErrorNotice";
import { useCanaryApi, useCanaryWrite } from "../lib/provider";
import { usePluginPath } from "../lib/host";
import { useTranslation } from "../lib/translation";
import { applyProductionTarget, defaultCanaryName } from "../lib/target";
import { emptyDraft } from "../lib/emit";
import { toYaml } from "../lib/yaml";
import { textMappings } from "../lib/text-contract";
import type { ExistingDraft, Prepared } from "../types";

export function ExistingCanaryCreate({ namespaces, textAuthSecret }: { namespaces: string[];textAuthSecret:string }) {
 const api=useCanaryApi();const canWrite=useCanaryWrite();const p=usePluginPath();const navigate=useNavigate();const {t}=useTranslation("canary");
 const [namespace,setNamespace]=useState(namespaces[0]??"");const [name,setName]=useState("");const [target,setTarget]=useState("");const [baseline,setBaseline]=useState("");const [candidate,setCandidate]=useState("");
 const [production,setProduction]=useState(90);const [canary,setCanary]=useState(10);const [showAll,setShowAll]=useState(true);const [ack,setAck]=useState(false);const [prepared,setPrepared]=useState<Prepared|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<Error|null>(null);
 const [textEnabled,setTextEnabled]=useState(false);const [modelChoices,setModelChoices]=useState<Record<string,string>>({});
 const deployments=useQuery({queryKey:["canary",api.mode,"deployments"],queryFn:()=>api.swiss.deployments(),retry:false});
 const candidates=useQuery({queryKey:["canary",api.mode,"arm-candidates",namespace],queryFn:()=>{if(!api.armCandidates)throw new Error("Existing-service API unavailable");return api.armCandidates(namespace)},enabled:!!namespace&&!!target,retry:false});
 const targets=(deployments.data??[]).filter(x=>x.kind==="LLMService"&&x.uid&&x.selectable!==false);
 const selectedTarget=targets.find(x=>`${x.namespace}/${x.name}`===target);
 const selected=(value:string)=>(candidates.data??[]).find(x=>x.serviceRef.uid===value);
 const control=selected(baseline),variant=selected(candidate);
 const aliases=useQuery({queryKey:["canary",api.mode,"model-aliases",target,selectedTarget?.uid],queryFn:()=>{if(!api.modelAliases||!selectedTarget?.uid)throw new Error("Model discovery unavailable");return api.modelAliases({namespace:selectedTarget.namespace,name:selectedTarget.name,uid:selectedTarget.uid})},enabled:textEnabled&&!!selectedTarget,retry:false});
 const mappings=textMappings(aliases.data?.models??[],{baseline:control,candidate:variant},modelChoices);
 const valid=(!textEnabled||!!textAuthSecret&&!!mappings)&&!!selectedTarget&&!!name&&control?.selectable&&variant?.selectable&&baseline!==candidate&&baseline!==selectedTarget.uid&&candidate!==selectedTarget.uid&&production>=0&&canary>=0&&Number.isInteger(production)&&Number.isInteger(canary)&&production+canary>0&&ack;
 function changed(){setPrepared(null);setError(null)}
 async function prepare(){if(!valid||!selectedTarget||!control||!variant)return;setBusy(true);setError(null);try{
  const base=applyProductionTarget(emptyDraft(),selectedTarget);
  const draft:ExistingDraft={...base,name,namespace,armSource:"existing",targetRef:{...base.targetRef,uid:selectedTarget.uid},traffic:{production,canary},arms:[{name:"baseline",serviceRef:control.serviceRef},{name:"candidate",serviceRef:variant.serviceRef}],compareArms:["baseline","candidate"],route:{...base.route,enabled:true}};
  if(textEnabled&&mappings)draft.requestContract={version:"openai-text-v1",authSecret:textAuthSecret,models:mappings};
  setPrepared(await api.experiments.prepare(draft));
 }catch(e){setError(e instanceof Error?e:new Error(String(e)))}finally{setBusy(false)}}
 async function create(){if(!prepared||!valid)return;setBusy(true);try{const result=await api.experiments.create(prepared.id);navigate(p(`/experiments/${result.id}`))}catch(e){setError(e instanceof Error?e:new Error(String(e)))}finally{setBusy(false)}}
 return <div className="flex min-h-full flex-col"><PageBanner title={t("create.title")} description={t("existing.description")} onBack={()=>navigate(p(""))}/><div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
 {(error||deployments.error||candidates.error||aliases.error)&&<ErrorNotice error={error??deployments.error??candidates.error??aliases.error}/>}
 <SectionCard title={t("create.identity")}><p className="mb-3 text-sm text-muted-foreground">{t("existing.namespaceHint")}</p><div className="grid gap-3 md:grid-cols-2">
 <FloatingField label={t("create.pickTarget")} className="md:col-span-2"><FieldSelect value={target||undefined} options={targets.map(x=>({value:`${x.namespace}/${x.name}`,label:`${x.namespace}/${x.name}`,description:`${x.model??"?"} · ${x.variant??"?"}@${x.version??"?"} · /${x.route??""}`}))} onValueChange={v=>{
  const next=targets.find(x=>`${x.namespace}/${x.name}`===String(v));if(!next)return;
  setName(current=>defaultCanaryName(current,selectedTarget?.name??"",next.name));
  setTarget(String(v));
  if(!namespace){setNamespace(namespaces.includes(next.namespace)?next.namespace:namespaces[0]??"")}
  if(baseline===next.uid)setBaseline("");if(candidate===next.uid)setCandidate("");changed();
 }}/></FloatingField>
 <FloatingField label={t("create.namespace")}><FieldSelect value={namespace||undefined} disabled={!selectedTarget} options={namespaces.map(n=>({label:n,value:n}))} onValueChange={v=>{setNamespace(String(v));setBaseline("");setCandidate("");changed()}}/></FloatingField>
 <FloatingField label={t("create.name")}><FieldInput value={name} disabled={!selectedTarget} placeholder={t("create.selectTargetFirst")} onChange={e=>{setName(e.target.value);changed()}}/></FloatingField>
 </div></SectionCard>
 <SectionCard title={t("create.stepArms")}><div className="flex flex-wrap items-center gap-3 pb-3"><Switch checked={showAll} onCheckedChange={setShowAll}/><span>{t("existing.showUnavailable")}</span><Button variant="outline" onClick={()=>{changed();void candidates.refetch();void deployments.refetch();if(textEnabled)void aliases.refetch()}}>{t("existing.recheck")}</Button><a className="text-primary hover:underline" href="/inferences">{t("existing.deployServices")}</a></div>
 {(["baseline","candidate"] as const).map(arm=>{const value=arm==="baseline"?baseline:candidate;const other=arm==="baseline"?candidate:baseline;return <FloatingField key={arm} label={t(`existing.${arm}`)}><FieldSelect key={`${namespace}/${target}/${arm}`} value={value||undefined} disabled={!selectedTarget} options={(candidates.data??[]).filter(x=>showAll||x.selectable).map(x=>({value:x.serviceRef.uid,label:`${x.serviceRef.namespace}/${x.serviceRef.name}`,description:`${String(x.model?.name??"?")} · ${String(x.model?.engine??"?")} · ${String(x.model?.version??"?")} · GPU ${String((x.snapshot.capacity?.model as Record<string,unknown>|undefined)?.gpus??"?")} × ${String(x.snapshot.capacity?.replicaCount??"?")} · ${x.selectable?t("existing.ready"):x.reasons.join("; ")}`,disabled:!x.selectable||x.serviceRef.uid===other||x.serviceRef.uid===selectedTarget?.uid}))} onValueChange={v=>{(arm==="baseline"?setBaseline:setCandidate)(String(v));changed()}}/></FloatingField>})}
 {(candidates.data?.filter(x=>x.selectable).length??0)<2&&<p className="py-3 text-sm text-muted-foreground">{t("existing.insufficient")}</p>}
 {showAll&&(candidates.data??[]).filter(x=>!x.selectable).map(x=><p className="py-1 text-xs text-muted-foreground" key={x.serviceRef.uid}>{x.serviceRef.namespace}/{x.serviceRef.name}: {x.reasons.join("; ")}</p>)}
 <div className="grid gap-3 md:grid-cols-2">{[control,variant].map((x,i)=>x&&<CodeBlock key={i} language="yaml" value={toYaml({service:x.serviceRef,model:x.model,capacity:x.snapshot.capacity,chart:x.snapshot.chart,entry:x.snapshot.entry,prefix:x.snapshot.prefix})} maxHeight="16rem"/>)}</div>
 </SectionCard>
 <SectionCard title={t("existing.textTitle")}><label className="flex items-center gap-2"><Switch checked={textEnabled} disabled={!textAuthSecret} onCheckedChange={v=>{setTextEnabled(v);changed()}}/>{t("existing.textEnable")}</label><p className="my-2 text-sm text-muted-foreground">{t("existing.textHint")}</p>
 {textEnabled&&<><p className="mb-3 text-sm">{t("existing.textAuth")}: {textAuthSecret}</p>{aliases.isFetching&&<p>{t("existing.loading")}</p>}{(["baseline","candidate"] as const).map(arm=>{const service=arm==="baseline"?control:variant;return service&&(aliases.data?.models??[]).map(id=>{const key=`${arm}:${service.serviceRef.uid}:${id}`;const options=service.snapshot.apiModels??[];const value=modelChoices[key]??(options.length===1?options[0]:"");return <FloatingField key={key} label={`${t(`existing.${arm}`)} · ${id} →`}><FieldSelect value={value||undefined} options={options.map(model=>({label:model,value:model}))} onValueChange={v=>{setModelChoices(prev=>({...prev,[key]:String(v)}));changed()}}/></FloatingField>})})}</>}
 </SectionCard>
 <SectionCard title={t("create.stepTraffic")}><div className="grid gap-3 md:grid-cols-2"><FloatingField label={t("existing.productionWeight")}><FieldNumber value={production} min={0} max={1000000} onValueChange={v=>{setProduction(Number(v));changed()}}/></FloatingField><FloatingField label={t("existing.canaryWeight")}><FieldNumber value={canary} min={0} max={1000000} onValueChange={v=>{setCanary(Number(v));changed()}}/></FloatingField></div></SectionCard>
 <SectionCard title={t("existing.retentionTitle")}><p className="mb-2 text-sm">{t("existing.retention")}</p><p className="mb-2 text-sm">{t("existing.metrics")}</p><label className="flex items-start gap-2 text-sm"><Switch checked={ack} onCheckedChange={v=>{setAck(v);changed()}}/>{t(textEnabled?"existing.textAcknowledge":"existing.acknowledge")}</label></SectionCard>
 <div className="flex gap-2"><Button disabled={!valid||busy||!canWrite} onClick={()=>void prepare()}>{t("experiments.prepare")}</Button><Button disabled={!prepared||!valid||busy||!canWrite} onClick={()=>void create()}>{t("existing.create")}</Button></div>
 {prepared&&<SectionCard title={t("experiments.prepared")}><p className="mb-2 text-xs">{prepared.id}</p>{prepared.warnings.map(w=><p key={w} className="mb-2 text-sm">{w}</p>)}<CodeBlock language="yaml" value={toYaml({services:prepared.services,economics:prepared.economics,canary:prepared.canary})} maxHeight="35rem"/></SectionCard>}
 </div></div>
}
