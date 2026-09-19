const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../expertDecisionController.js','utf8');
const first=source.indexOf('\t\t\tconst candidateAnchors = [anchor];');
const last=source.indexOf('\t\t\tconst woodService = ',first);
assert(first>0&&last>first);
const anchors=new Function('anchor','sources','action','gameState','sourceIds','entityPosition','SquareVectorDistance','PlayerID','SUPPLY_ID',
  source.slice(first,last)+'\nreturn candidateAnchors;');
const dist=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
const supply={position:()=>[10,10]};
const cutter={position:()=>[25,10],getMetadata:(_p,k)=>k==='expertDecisionSupplyId'?7:undefined};
const unrelated={position:()=>[40,10],getMetadata:()=>9};
const result=anchors([0,0],[supply],{resourceGeneric:'wood'},
  {getOwnUnits:()=>new Map([[1,cutter],[2,unrelated]])},[7],e=>e.position(),dist,2,'expertDecisionSupplyId');
assert(result.some(p=>p[0]===25&&p[1]===10),'active cutter adds a search anchor');
assert(!result.some(p=>p[0]===40&&p[1]===10),'other district cannot move the anchor');
assert(!anchors([0,0],[supply],{resourceGeneric:'stone'},
  {getOwnUnits:()=>new Map([[1,cutter]])},[7],e=>e.position(),dist,2,'expertDecisionSupplyId').some(p=>p[0]===25));
const begin=source.indexOf('\n\tresearchExpertP1EcoSweep(');
const stop=source.indexOf('\n\t\tif (this.primaryEcoTechBusy',begin);
assert(begin>0&&stop>begin);
const gate=new Function('gameState','queues','mergePolicy',
 source.slice(begin,stop).trim().replace(/^researchExpertP1EcoSweep\(/,'function gate(')+
 '\nreturn true;\n}\nreturn gate.call(this,gameState,queues);');
for(const doctrine of ['p2_tech_push','p3_boom_all_in','late_p1_rush'])
 for(const time of [239,240,329,330]) {
  const allowed=doctrine!=='late_p1_rush'&&time>=240;
  const actual=gate.call({ensureStrategicDoctrine:()=>({id:doctrine,p1EcoSweepBeforeP2:doctrine!=='late_p1_rush'}),strategyPolicyOverrides:()=>({}),strategyWoodPivot:false},
   {currentPhase:()=>1,ai:{elapsedTime:time,queueManager:{}}},{},()=>({p1EcoSweepStartTime:330}));
  assert.equal(!!actual,allowed,`${doctrine} at ${time}`);
 }
assert(source.includes('remaining.food -= Number(cost.food) || 0;'),'Town food reservation preserved');
assert(source.includes('remaining.wood -= Number(cost.wood) || 0;'),'Town wood reservation preserved');
console.log('PASS: owned active woodsite search and early long-game eco sweep with phase reservation.');
