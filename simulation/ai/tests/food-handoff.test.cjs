const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname+'/../petra/expertDecision/';
const clean=p=>fs.readFileSync(root+p,'utf8').replace(/^import .*\n/gm,'').replace(/export\s*\{[^}]*\};?/g,'');
const ctx=vm.createContext({console});
vm.runInContext(fs.readFileSync(__dirname+'/state-fixture.js','utf8').replace(/export\s*\{[^}]*\};?/g,'')+'\n'+clean('policy.js')+'\n'+clean('economyPlanner.js')+'\n'+clean('petraMechanicalCollector.js')+'\nthis.api={mergePolicy,fieldDemand,collectWorkerMetrics,planEconomy};',ctx);
const {mergePolicy,fieldDemand,collectWorkerMetrics}=ctx.api;
const unit=(job,gather,state,civilian=true)=>({hasClass:c=>civilian?c==='Civilian':c==='CitizenSoldier',getMetadata:(_p,k)=>k==='expertDecisionJob'?job:k==='gather-type'?gather:undefined,isIdle:()=>false,unitAIState:()=>state});
const units=[unit('wood','wood','INDIVIDUAL.GATHER.APPROACHING'),unit('wood','wood','INDIVIDUAL.RETURNRESOURCE.APPROACHING'),unit('wood','wood','INDIVIDUAL.GATHER.GATHERING'),unit('food_owned','wood','INDIVIDUAL.RETURNRESOURCE.APPROACHING'),unit('citizenSoldierWood','wood','INDIVIDUAL.GATHER.GATHERING',false),unit('food','food','INDIVIDUAL.GATHER.GATHERING')];
const metrics=collectWorkerMetrics({getOwnUnits:()=>units});
assert.equal(metrics.woodCivilians,4,'travel, return and overflow count; soldiers do not');
const policy=mergePolicy({targetWoodCivilians:20});
const state={time:180,population:{used:43},workers:{woodCivilians:20,food:5,farm:0},structures:{barracks:1,farmstead:2,field:0},foundations:{barracks:0,farmstead:0,field:0},queued:{barracks:0,farmstead:0,field:0},resources:{food:89,wood:500},food:{totalNaturalRemaining:1200,territoryNaturalRatio:0.6,naturalRunwaySeconds:240,averageFarmerRate:0.7,preferredFarmersPerField:4,measuredFoodIncomeRate:4,naturalIncomeRate:4,farmIncomeRate:0,ccFoodBurnRate:6.3,oneBarracksFoodBurnRate:12.3,twoBarracksFoodBurnRate:18.3},flags:{}};
let result=fieldDemand(state,policy);
assert.equal(result.naturalFirstHold,false);
assert(result.desiredFields>=6,'request farm backbone despite remaining natural food');
assert.equal(result.prebuild,true);
result=fieldDemand({...state,workers:{...state.workers,woodCivilians:19}},policy);
assert.equal(result.naturalFirstHold,true,'before tranche, existing natural-food contract remains');
result=fieldDemand({...state,structures:{...state.structures,barracks:0}},policy);
assert.equal(result.naturalFirstHold,true,'do not change pre-barracks opening');
console.log('PASS: assigned wood counts and post-barracks farm handoff.');
// Full planner: reproduce two hubs, two fields, zero legal slots, remaining fruit.
const blocked={...state,time:303,resources:{food:210,wood:1231,stone:200,metal:120},
  workers:{...state.workers,woodCivilians:18,idle:8,overflowWood:15},structures:{...state.structures,field:2},
  food:{...state.food,fieldCapacityKnown:true,openFieldSlots:0,supportedFieldSlots:2,
    maxSaturatedHubFields:2,foodInfrastructureDeficitSeconds:163}};
let plan=ctx.api.planEconomy(blocked,{targetWoodCivilians:20});
assert(plan.actions.some(a=>a.type==='BUILD'&&a.kind==='farmstead'&&a.role==='farm_hub_deadlock'),
  'full planner must authorize capacity hub with fruit remaining');
plan=ctx.api.planEconomy({...blocked,food:{...blocked.food,openFieldSlots:4,supportedFieldSlots:6}}, {targetWoodCivilians:20});
assert(plan.actions.some(a=>a.type==='BUILD'&&a.kind==='field'),'use existing field slots first');
assert(!plan.actions.some(a=>a.kind==='farmstead'&&a.role==='farm_hub_deadlock'),'no extra hub when slots exist');
plan=ctx.api.planEconomy({...blocked,foundations:{...blocked.foundations,field:1}}, {targetWoodCivilians:20});
assert(!plan.actions.some(a=>a.kind==='farmstead'&&a.role==='farm_hub_deadlock'),'pending fields prevent duplicate hub');
// Execute actual no-local-work branch; it must fall through instead of returning false.
const controller=fs.readFileSync(__dirname+'/../petra/expertDecisionController.js','utf8');
const start=controller.indexOf('\t\t\t\t\tconst local = this.assignFoodHomeLocalWork');
const end=controller.indexOf('\n\t\t\t\t}',start);
assert(start>0&&end>start);
const localBranch=new Function('ent','localSuccess', 'const gameState={},home={},accessIndex=1,homeId=2,PlayerID=2,FOOD_HOME_FARMSTEAD="home",FOOD_HOME_PERMANENT="permanent";\n'+controller.slice(start,end)+'\nreturn "continue-food-search";');
for(const success of [true,false]){
  const writes=[];
  assert.equal(localBranch.call({assignFoodHomeLocalWork:()=>success,diagnoseWorkerOrder:()=>{}},{setMetadata:(_p,k,v)=>writes.push(k)},success),success?true:'continue-food-search');
  assert.equal(writes.length,success?0:2);
}
console.log('PASS: full planner capacity recovery and exhausted-home fallthrough.');
plan=ctx.api.planEconomy({...blocked,time:351,population:{used:77},resources:{food:813,wood:244,stone:200,metal:30},
  structures:{...blocked.structures,field:6},workers:{...blocked.workers,idle:0},
  food:{...blocked.food,measuredFoodIncomeRate:16.1,foodInfrastructureDeficitSeconds:0,supportedFieldSlots:6}}, {targetWoodCivilians:20});
assert(!plan.actions.some(a=>a.kind==='farmstead'&&a.type==='BUILD'),'adequate income and food bank must not buy third hub');
// Execute the entire production metal-rebalance method with actual candidate filtering.
const metalStart=controller.indexOf('\n\tapplyStrategicMetalRebalance(gameState, openingEnd)');
const metalEnd=controller.indexOf('\n\tworkerActualResource(',metalStart);
const method=controller.slice(metalStart,metalEnd).replace('applyStrategicMetalRebalance(gameState, openingEnd)','function rebalance(gameState, openingEnd)');
const constants=['TASK_KEY','PENDING_JOB_METADATA','EXPERT_DEFENSE','EXPERT_CIVILIAN_EVAC','JOB_METADATA','FARM_LOCK','CIVILIAN_ORDINAL','FOOD_HOME_FARMSTEAD','FOOD_HOME_PERMANENT'];
const metalContext=vm.createContext({mergePolicy});
vm.runInContext(constants.map(k=>'const '+k+'='+JSON.stringify(k)+';').join('\n')+'\nconst PlayerID=2,entityPosition=e=>e.position(),hasClass=(e,c)=>e.hasClass(c),aiWarn=()=>{};\n'+method+'\nthis.rebalance=rebalance;',metalContext);
for(const civilian of [true,false]) for(const donorCount of [8,12]) {
  const miners=Array.from({length:donorCount},(_,i)=>({id:()=>i+1,position:()=>[i,0],hasClass:c=>civilian?c==='Civilian':c==='CitizenSoldier',
    getMetadata:(_p,k)=>k==='JOB_METADATA'?(civilian?'wood':'citizenSoldierWood'):undefined}));
  const moves=[];
  const owner={resourceForecast:{resources:{metal:{status:'critical'}}},builtByClass:(_g,c)=>c==='Barracks'?[{}]:[],
    ensureStrategicDoctrine:()=>({id:'early_p1_rush'}),isExpertEconomyEntity:()=>true,attackPlanAllowsEconomicWork:()=>true,
    setDesiredJob:(_g,e,j,o)=>{moves.push({j,force:o&&o.force});return true;}};
  metalContext.rebalance.call(owner,{ai:{elapsedTime:351},currentPhase:()=>1,getPopulation:()=>77,getOwnUnits:()=>new Map(miners.map(e=>[e.id(),e])),getResources:()=>({food:813,wood:244,stone:200,metal:30})},28);
  assert.equal(moves.length,donorCount===8?0:civilian?1:2,'bounded metal reassignment preserves eight wood donors');
  assert(moves.every(m=>m.j==='metal'&&m.force),'critical metal overrides job lease without wholesale reassignment');
}
console.log('PASS: surplus-food hub suppression and early-P1 critical metal assignments.');
