import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTextBands} from './text-regions.mjs';

test('album typography regions detected, flat artwork stays unzoomed',()=>{
  const n=128,gray=new Uint8Array(n*n);
  assert.deepEqual(analyzeTextBands(gray,n),[]);
  for(let y=16;y<25;y++)for(let x=15;x<110;x++)if(x%5<2)gray[y*n+x]=255;
  const regions=analyzeTextBands(gray,n);
  assert.ok(regions.length>0);
  assert.equal(regions[0].type,'text');
  assert.ok(regions[0].y<25);
});
