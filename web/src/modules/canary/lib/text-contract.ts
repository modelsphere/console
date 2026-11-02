import type { ArmCandidate } from "../types";

export function textMappings(aliases:string[],services:Record<string,ArmCandidate|undefined>,choices:Record<string,string>):Record<string,Record<string,string>>|null {
 if(!aliases.length)return null;
 const result:Record<string,Record<string,string>>=Object.create(null);
 for(const arm of ["baseline","candidate"]){
  const service=services[arm];if(!service)return null;
  const models=service.snapshot.apiModels??[];
  const mapping:Record<string,string>=Object.create(null);
  for(const alias of aliases){const model=choices[`${arm}:${service.serviceRef.uid}:${alias}`]??(models.length===1?models[0]:"");if(!models.includes(model))return null;mapping[alias]=model}
  result[arm]=mapping;
 }
 return result;
}
