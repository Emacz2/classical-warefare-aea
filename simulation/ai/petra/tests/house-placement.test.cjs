const fs = require('node:fs');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../expertDecisionController.js', 'utf8');
const square = (a,b) => (a[0]-b[0])**2 + (a[1]-b[1])**2;
// Execute the actual opening-house validation block, not a reimplementation.
const start = source.indexOf('\t\t\tif (kind === "house" && request && request.openingHouse && !request.openingHouseFallbackStage');
const end = source.indexOf('\t\t\tif (kind === "temple"', start);
assert(start > 0 && end > start);
const validate = new Function('position', 'request', 'SquareVectorDistance', 'const kind="house";\n' + source.slice(start,end) + '\nreturn true;');
const base = {openingHouse:true, openingFoodDistrictAnchor:[20,0], openingFoodDistrictReserveRadius:34,
  openingWoodStorehousePosition:[60,0], woodDistrictAnchor:[80,0], minimumStorehouseDistance:10, maximumStorehouseDistance:20};
assert.equal(validate([45,0],base,square), false, 'strict food reserve rejects near miss');
assert.equal(validate([45,0],{...base,openingHouseFallbackStage:1,minimumStorehouseDistance:8,maximumStorehouseDistance:30},square),true);
assert.equal(validate([85,0],base,square),false,'strict forest-side rule');
assert.equal(validate([85,0],{...base,openingHouseFallbackStage:1,maximumStorehouseDistance:30},square),true);
assert.equal(validate([95,0],{...base,openingHouseFallbackStage:1,maximumStorehouseDistance:30},square),false);
assert.equal(validate([95,0],{...base,openingHouseFallbackStage:2},square),true);
// Execute the production same-frame retry block with a mechanical-execution stub.
const retryStart = source.indexOf('\t\t\t\tif (!exec && request.openingHouse)');
const retryEnd = source.indexOf('\t\t\t\tif (!exec)\n',retryStart);
const retry = new Function('request','initial','prepareMechanicalExecution',
  'let exec=initial,prepared={}; const gameState={ai:{elapsedTime:120}},oneFrame={},action={kind:"house"},accessIndex=1,PlayerID=2; const buildKey=()=>"house",aiWarn=()=>{};\n' +
  source.slice(retryStart,retryEnd) + '\nreturn exec;');
for (const successStage of [1,2,3]) {
  const calls=[];
  const result=retry.call({placementPorts:()=>({}),foundationTracker:{}},{openingHouse:true},null,(_g,_f,requests)=>{
    const stage=requests.placements.house.openingHouseFallbackStage;
    calls.push(stage);
    return {execution:{builds:stage===successStage?{house:{position:[45,0]}}:{}}};
  });
  assert.deepEqual(calls,successStage===1?[1]:[1,2]);
  assert.equal(!!result,successStage!==3);
}
assert.equal(retry.call({}, {openingHouse:false},null,()=>{throw Error('non-house retry');}),null);
assert.equal(retry.call({}, {openingHouse:true},{position:[45,0]},()=>{throw Error('successful placement retried');}).position[0],45);
// Ensure fallback does not disable the explicit slot/corridor checks.
assert(source.includes('for (const slot of farmDistrictReservation.reservedSlots)'));
assert(source.includes('pointSegmentDistanceSquared(position, corridor.from, corridor.to)'));
assert(!source.includes('request.strategicFallback = true'));
console.log('PASS: opening-house validation and same-frame retries (13 assertions/scenarios).');
