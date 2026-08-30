import{mkdtemp,rm,writeFile}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{spawn}from"node:child_process";
import{describe,expect,it}from"vitest";
import{executableFixtures,modelFixture,type FixtureLanguage}from"../src/executableFixtures.js";
import{executableFixtureGold}from"../src/executableGold.js";

function commands(language:FixtureLanguage,files:Record<string,string>):Array<[string,string[]]>{if(language==="typescript")return[[process.execPath,["--experimental-strip-types","test.ts"]]];if(language==="python"){const test=Object.hasOwn(files,"test_limit.py")?"test_limit.py":Object.hasOwn(files,"test_approval.py")?"test_approval.py":"test_validation.py";return[["python3",["-m","unittest",test]]]}const unit=Object.hasOwn(files,"Approval.java")?"Approval":Object.hasOwn(files,"Validation.java")?"Validation":"Limit";return[["javac",[`${unit}.java`,`${unit}Test.java`]],["java",[`${unit}Test`]]]}
async function run(executable:string,args:string[],cwd:string){return await new Promise<number>((resolve,reject)=>{const child=spawn(executable,args,{cwd,env:{PATH:process.env.PATH??""},stdio:"ignore",shell:false});child.once("error",reject);child.once("exit",code=>resolve(code??-1))})}
async function execute(language:FixtureLanguage,files:Record<string,string>){const root=await mkdtemp(join(tmpdir(),"buildit-eval-"));try{await Promise.all(Object.entries(files).map(([name,content])=>writeFile(join(root,name),content,{encoding:"utf8",mode:0o600})));for(const[executable,args]of commands(language,files)){const exit=await run(executable,args,root);if(exit!==0)return exit}return 0}finally{await rm(root,{recursive:true,force:true})}}

describe("executable accuracy fixtures",()=>{
  it("has one separate label per unique input and a positive/negative pair per language and defect family",()=>{const inputIds=executableFixtures.map(item=>item.id),goldIds=executableFixtureGold.map(item=>item.id);expect(new Set(inputIds).size).toBe(inputIds.length);expect(new Set(goldIds).size).toBe(goldIds.length);expect([...inputIds].sort()).toEqual([...goldIds].sort());for(const language of ["typescript","python","java"] as const){const ids=new Set(executableFixtures.filter(item=>item.language===language).map(item=>item.id)),labels=executableFixtureGold.filter(item=>ids.has(item.id));for(const defectFamily of ["requirement_boundary","authorization_bypass","input_validation"] as const)expect(labels.some(item=>item.classification==="introduced"&&item.defectFamily===defectFamily)).toBe(true);expect(labels.filter(item=>item.classification==="unchanged_pass")).toHaveLength(3)}});
  it("keeps labels out of the model-facing fixture",()=>{for(const gold of executableFixtureGold){const visible=JSON.stringify(modelFixture(gold.id));expect(visible).not.toContain(gold.classification);expect(visible).not.toContain(gold.defectFamily)}});
  it.each(executableFixtures)("executes $id in $language and matches independently stored gold",async fixture=>{const gold=executableFixtureGold.find(item=>item.id===fixture.id)!;expect(await execute(fixture.language,fixture.baseFiles)).toBe(0);const headExit=await execute(fixture.language,fixture.headFiles);expect(headExit===0?"unchanged_pass":"introduced").toBe(gold.classification)},30_000);
});
