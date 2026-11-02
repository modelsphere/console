import { describe, expect, it } from "vitest";
import type { ArmCandidate } from "../types";
import { textMappings } from "./text-contract";
const arm=(uid:string,models:string[]):ArmCandidate=>({serviceRef:{name:uid,uid},selectable:true,reasons:[],snapshot:{service:{name:uid,uid},apiModels:models}});
describe("textMappings",()=>{
 it("maps every production alias to each single native model",()=>{expect(textMappings(["mock","business"],{baseline:arm("a",["Qwen"]),candidate:arm("b",["Other"])},{})).toEqual({baseline:{mock:"Qwen",business:"Qwen"},candidate:{mock:"Other",business:"Other"}})});
 it("requires explicit choices for multiple models and ignores choices from another service",()=>{const services={baseline:arm("a",["Qwen","Other"]),candidate:arm("b",["Qwen"])};expect(textMappings(["mock"],services,{})).toBeNull();expect(textMappings(["mock"],services,{"baseline:old:mock":"Other"})).toBeNull();expect(textMappings(["mock"],services,{"baseline:a:mock":"Other"})).toEqual({baseline:{mock:"Other"},candidate:{mock:"Qwen"}})});
 it("blocks empty discovery, missing services and stale native names",()=>{expect(textMappings([],{baseline:arm("a",["Qwen"])},{})).toBeNull();expect(textMappings(["mock"],{baseline:arm("a",["Qwen"])},{})).toBeNull();expect(textMappings(["mock"],{baseline:arm("a",["Qwen"]),candidate:arm("b",["Qwen"])},{"baseline:a:mock":"Gone"})).toBeNull()});
});
