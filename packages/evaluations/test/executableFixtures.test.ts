import{mkdtemp,rm,writeFile}from"node:fs/promises";
import{tmpdir}from"node:os";
import{join}from"node:path";
import{spawn}from"node:child_process";
import{describe,expect,it}from"vitest";
import{executableFixtures,modelFixture,type FixtureLanguage}from"../src/executableFixtures.js";
import{executableFixtureGold}from"../src/executableGold.js";

const commands=(language:FixtureLanguage):Array<[string,string[]]>=>language==="typescript"?[[process.execPath,["--experimental-strip-types","test.ts"]]]:language==="python"?[["python3",["-m","unittest","test_limit.py"]]]:[["javac",["Limit.java","LimitTest.java"]],["java",["LimitTest"]]];
async function run(executable:string,args:string[],cwd:string){return await new Promise<number>((resolve,reject)=>{const child=spawn(executable,args,{cwd,env:{PATH:process.env.PATH??""},stdio:"ignore",shell:false});child.once("error",reject);child.once("exit",code=>resolve(code??-1))})}
async function execute(language:FixtureLanguage,files:Record<string,string>){const root=await mkdtemp(join(tmpdir(),"buildit-eval-"));try{await Promise.all(Object.entries(files).map(([name,content])=>writeFile(join(root,name),content,{encoding:"utf8",mode:0o600})));for(const[executable,args]of commands(language)){const exit=await run(executable,args,root);if(exit!==0)return exit}return 0}finally{await rm(root,{recursive:true,force:true})}}

describe("executable accuracy fixtures",()=>{
  it("keeps labels out of the model-facing fixture",()=>{for(const gold of executableFixtureGold){const visible=JSON.stringify(modelFixture(gold.id));expect(visible).not.toContain(gold.classification);expect(visible).not.toContain(gold.defectFamily)}});
  it.each(executableFixtures)("executes $id in $language and matches independently stored gold",async fixture=>{const gold=executableFixtureGold.find(item=>item.id===fixture.id)!;expect(await execute(fixture.language,fixture.baseFiles)).toBe(0);const headExit=await execute(fixture.language,fixture.headFiles);expect(headExit===0?"unchanged_pass":"introduced").toBe(gold.classification)},30_000);
});
