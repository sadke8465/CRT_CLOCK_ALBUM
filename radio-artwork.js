// Shared, read-only radio artwork resolver. No API keys or proxy services.
const VERSION='crt-art-v1:';
const memory=new Map();
const TTL=30*24*60*60*1000;
export function normalize(value){
 return String(value||'').normalize('NFKD').toLowerCase()
  .replace(/\p{M}/gu,'').replace(/&/g,' and ').replace(/[^\p{L}\p{N}]/gu,'');
}
const bareTitle=s=>normalize(String(s||'').replace(/\s*[\[(](?:\d{4}\s*)?(?:remaster(?:ed)?|original mix|mono|stereo)(?:\s+\d{4})?[\])]/gi,''));
const compilation=s=>/best of|greatest hits|collection|anthology|compilation/i.test(s||'');
function artistScore(expected,actual){
 const a=normalize(expected),b=normalize(actual);
 if(!a||!b)return 0;
 if(a===b)return 100;
 const strip=s=>normalize(String(s).replace(/\s+(?:and|&)\s+(?:his|her|their|the)\s+(?:orchestra|band|ensemble|quartet|trio)$/i,''));
 return strip(expected)===strip(actual)&&strip(expected).length>=5?80:0;
}
export function matchScore(title,artists,track,artist){
 const ts=normalize(title)===normalize(track)?100:bareTitle(title)===bareTitle(track)?90:0;
 const as=Math.max(0,...artists.map(a=>artistScore(a,artist)));
 return ts&&as?ts+as:0;
}
function rank(title,artists,candidates){
 return candidates.map(c=>({...c,score:matchScore(title,artists,c.title,c.artist)}))
  .filter(c=>c.score>=170&&c.image)
  .sort((a,b)=>b.score-a.score||Number(compilation(a.album))-Number(compilation(b.album)));
}
async function json(url,timeout=7000){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{const r=await fetch(url,{signal:c.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(t);}
}
function validImage(url){
 return new Promise(resolve=>{
  let done=false;const img=new Image();
  const finish=ok=>{if(done)return;done=true;clearTimeout(timer);resolve(ok);};
  const timer=setTimeout(()=>finish(false),5000);
  img.onload=()=>finish(img.naturalWidth>0);img.onerror=()=>finish(false);img.src=url;
 });
}
function cacheRead(key){
 try{const value=memory.get(key)||JSON.parse(localStorage.getItem(VERSION+key)||'null');return value&&Date.now()-value.time<TTL?value.match:null;}catch{return null;}
}
function cacheWrite(key,match){
 const value={time:Date.now(),match};memory.set(key,value);
 try{localStorage.setItem(VERSION+key,JSON.stringify(value));}catch{}
}
async function apple(title,artists,country){
 const q=new URLSearchParams({term:artists[0]+' '+title,entity:'song',country,limit:'35'});
 const d=await json('https://itunes.apple.com/search?'+q);
 return rank(title,artists,(d.results||[]).map(r=>({title:r.trackName,artist:r.artistName,album:r.collectionName,image:r.artworkUrl100?.replace('100x100bb','1200x1200bb'),source:'iTunes '+country.toUpperCase()})));
}
async function musicbrainz(title,artists){
 // MusicBrainz public recording search; one request per lookup, only after Apple fails.
 const quote=s=>String(s).replace(/[\\"]/g,'\\$&');
 const q=new URLSearchParams({query:'recording:"'+quote(title)+'" AND artist:"'+quote(artists[0])+'"',fmt:'json',limit:'8'});
 const d=await json('https://musicbrainz.org/ws/2/recording/?'+q,8000);
 const out=[];
 for(const rec of d.recordings||[]){
  const artist=(rec['artist-credit']||[]).map(a=>(a.name||a.artist?.name||'')+(a.joinphrase||'')).join('');
  if(matchScore(title,artists,rec.title,artist)<170)continue;
  for(const rel of (rec.releases||[]).slice(0,4)){
   const gid=rel['release-group']?.id;
   if(gid)out.push({title:rec.title,artist,album:rel.title,image:'https://coverartarchive.org/release-group/'+gid+'/front-500',source:'MusicBrainz / Cover Art Archive'});
   else if(rel.id)out.push({title:rec.title,artist,album:rel.title,image:'https://coverartarchive.org/release/'+rel.id+'/front-500',source:'MusicBrainz / Cover Art Archive'});
  }
 }
 return rank(title,artists,out);
}
async function deezer(title,artists){
 // Public catalog only; if the provider denies cross-origin access, skip it.
 const q=new URLSearchParams({q:artists[0]+' '+title,limit:'20'});
 const d=await json('https://api.deezer.com/search?'+q,6000);
 return rank(title,artists,(d.data||[]).map(r=>({title:r.title,artist:r.artist?.name,album:r.album?.title,image:r.album?.cover_big,source:'Deezer'})));
}
export async function resolveArtwork(title,artists){
 if(!title||!artists?.length)return null;
 const key=normalize(title)+'|'+artists.map(normalize).join('|');
 const cached=cacheRead(key);
 if(cached&&await validImage(cached.image))return {...cached,cached:true};
 const seen=new Set();
 for(const search of [()=>apple(title,artists,'il'),()=>apple(title,artists,'us'),()=>apple(title,artists,'gb'),()=>musicbrainz(title,artists),()=>deezer(title,artists)]){
  try{
   const candidates=await search();
   const unique=candidates.filter(c=>{if(seen.has(c.image))return false;seen.add(c.image);return true;}).slice(0,3);
   const checked=await Promise.all(unique.map(c=>validImage(c.image)));
   const found=unique.find((c,i)=>checked[i]);if(found){cacheWrite(key,found);return found;}
  }catch(err){console.debug('Artwork provider unavailable',err.message);}
 }
 return null;
}
