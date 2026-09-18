const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../expertDecisionController.js','utf8');
function method(name,next) {
  const start=source.indexOf('\n\t'+name+'('),end=source.indexOf('\n\t'+next+'(',start);
  assert(start>=0&&end>start);
  return source.slice(start,end).trim().replace(new RegExp('^'+name+'\\('),'function '+name+'(');
}
let issued=0;
const ctx=vm.createContext({PlayerID:2,entityPosition:e=>e&&e.position(),hasClass:(e,c)=>e.hasClass(c),
 ensureGatherOrder:()=>{issued++;return {status:'ISSUED'};}});
vm.runInContext(method('ensureLegalGatherOrder','neutralWoodRescueCount')+'\nthis.order=ensureLegalGatherOrder;',ctx);
const owner={HQ:{territoryMap:{getOwner:p=>p[0]}}};
const worker=classes=>({hasClass:c=>classes.includes(c)});
const supply=(territory,resource)=>({position:()=>[territory,0],resourceSupplyType:()=>({generic:resource})});
for(const classes of [['Civilian'],['CitizenSoldier'],['CitizenSoldier','Cavalry']]) {
 for(const territory of [0,1,2]) for(const resource of ['food','wood','stone','metal']) {
  const legal=territory===2&&!(classes.includes('CitizenSoldier')&&!classes.includes('Cavalry')&&resource==='food');
  const before=issued,result=ctx.order.call(owner,{},worker(classes),supply(territory,resource));
  assert.equal(result.status,legal?'ISSUED':'FAILED');assert.equal(issued-before,legal?1:0);
 }
}
vm.runInContext(method('economySafetyAllowsNeutralWood','ensureLegalGatherOrder')+'\nthis.neutral=economySafetyAllowsNeutralWood;',ctx);
assert.equal(ctx.neutral.call({economicSafety:{active:true,resource:'wood',neutralWoodRescue:true}},{}),false);
// Execute the actual soldier handoff prefix; it must choose productive non-food work.
const start=source.indexOf('\n\tassignFoodWorker('),end=source.indexOf('\n\t\tconst network',start);
const handoff=source.slice(start,end).trim().replace(/^assignFoodWorker\(/,'function handoff(')+'\n}';
const metadata=[],jobs=[];
Object.assign(ctx,{FARM_LOCK:'farm',NATURAL_FOOD_LOCK:'natural',JOB_METADATA:'job'});
vm.runInContext(handoff+'\nthis.handoff=handoff;',ctx);
const soldier={...worker(['CitizenSoldier']),setMetadata:(_p,k,v)=>metadata.push([k,v])};
assert.equal(ctx.handoff.call({assignSafeFallback:(_g,_e,_a,resources)=>{jobs.push(...resources);return true;}},{},soldier,{},1),true);
assert.deepEqual(jobs,['wood','metal','stone']);assert(metadata.some(([k,v])=>k==='job'&&v==='citizenSoldierWood'));
const farmStart=source.indexOf('\n\tassignFarmWorker('),farmEnd=source.indexOf('\n\t\tconst policy',farmStart);
vm.runInContext(source.slice(farmStart,farmEnd).trim().replace(/^assignFarmWorker\(/,'function farm(')+'\n}\nthis.farm=farm;',ctx);
assert.equal(ctx.farm({},soldier,1),false);
assert.equal((source.match(/ensureGatherOrder\(/g)||[]).length,1,'controller gather orders all route through the final gate');
console.log('PASS: 36 role/territory/resource combinations, emergency neutral exclusion, soldier handoff and farm exclusion.');
