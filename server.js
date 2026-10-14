'use strict';
const express = require('express');
const {Pool} = require('pg');
const crypto = require('crypto');
const path = require('path');
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({limit:'20kb'}));
app.use((req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','strict-origin-when-cross-origin');
  res.set('X-Frame-Options','DENY');
  next();
});
const DB = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
if(!DB || !ADMIN_PASSWORD || !SESSION_SECRET) throw new Error('Missing required environment variables');
const pool = new Pool({connectionString:DB,max:5,idleTimeoutMillis:15000,connectionTimeoutMillis:12000});
const regions = new Set(['SAC','BR','US','NA','SG','IND','ID','EU','TH','VN','BD','ME']);
const caches = new Map();
const buckets = new Map();
function fail(res,code,message){return res.status(code).json({error:message})}
function limited(req,scope,count,period){
  const key = scope+':'+req.ip;
  const now=Date.now();const r=buckets.get(key)||{n:0,until:now+period};
  if(now>r.until){r.n=0;r.until=now+period}
  r.n++;buckets.set(key,r);
  if(buckets.size>10000) for(const [k,v] of buckets) if(v.until<now)buckets.delete(k);
  return r.n>count;
}
function validUID(uid){return typeof uid==='string' && /^[0-9]{5,15}$/.test(uid)}
function validRegion(r){return typeof r==='string' && regions.has(r)}
function sanitizeTitle(s){return typeof s==='string'?s.trim().slice(0,90):''}
function authHash(value){return crypto.createHmac('sha256',SESSION_SECRET).update(value).digest('hex')}
function cookieValue(){const expiry=(Date.now()+7*86400000).toString(36);return expiry+'.'+authHash(expiry)}
function isAdmin(req){
  const part=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('js_tournaments_admin='));
  if(!part)return false;
  const raw=decodeURIComponent(part.split('=').slice(1).join('='));
  const chunks=raw.split('.');
  if(chunks.length!==2 || chunks[1].length!==64)return false;
  if(parseInt(chunks[0],36)<Date.now())return false;
  return crypto.timingSafeEqual(Buffer.from(chunks[1]),Buffer.from(authHash(chunks[0])));
}
function admin(req,res,next){if(!isAdmin(req))return fail(res,401,'Acceso de organizador requerido');next()}
function cookie(res,value,maxAge){
  res.cookie('js_tournaments_admin',value,{httpOnly:true,secure:true,sameSite:'strict',maxAge:maxAge,path:'/'});
}
function sameOrigin(req,res,next){
  if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
  const origin=req.get('origin');
  if(origin && origin!==req.protocol+'://'+req.get('host'))return fail(res,403,'Origen no permitido');
  next();
}
app.use('/api',sameOrigin);
async function findPlayer(uid,region){
  const key=region+':'+uid;const old=caches.get(key);
  if(old && Date.now()-old.time<180000)return old.player;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
  try{
    const endpoint='https://freefireapis.lat/info-player?uid='+encodeURIComponent(uid)+'&region='+encodeURIComponent(region);
    const response=await fetch(endpoint,{signal:controller.signal,headers:{accept:'application/json','user-agent':'JS-Tournaments/1.0'}});
    if(!response.ok)throw new Error('El servicio de nombres no está disponible');
    const data=await response.json();
    const info=data && data.result && data.result.basicInfo;
    if(!data.success||!info||String(info.accountId)!==uid||typeof info.nickname!=='string'||!info.nickname.trim())throw new Error('No encontramos el jugador en esa región');
    const player={uid,nickname:info.nickname.trim().slice(0,70),region,level:Number(info.level)||0};
    caches.set(key,{player,time:Date.now()});return player;
  }finally{clearTimeout(timer)}
}
async function getTournament(slug){
  const q=await pool.query('select * from tournaments where slug=$1',[slug]);return q.rows[0]||null;
}
async function roster(id){
  return (await pool.query('select uid,nickname,region,level,created_at from registrations where tournament_id=$1 order by created_at,id',[id])).rows;
}
function shuffle(array){
  for(let i=array.length-1;i>0;i--){const j=crypto.randomInt(i+1);[array[i],array[j]]=[array[j],array[i]]}
  return array;
}
function makeBracket(players){
  const ids=shuffle(players.map(p=>p.uid));
  const slots=2**Math.ceil(Math.log2(ids.length));const byes=slots-ids.length;const pairs=[];
  for(let i=0;i<byes;i++)pairs.push([ids.shift(),null]);
  while(ids.length)pairs.push([ids.shift(),ids.shift()||null]);
  return {pairs:shuffle(pairs),results:{}};
}
function buildRounds(bracket){
  if(!bracket)return [];
  let previous=bracket.pairs.map((pair,i)=>buildMatch(0,i,pair[0],pair[1],true,true,bracket.results));
  const rounds=[previous];
  for(let depth=1;previous.length>1;depth++){
    const next=[];
    for(let i=0;i<previous.length;i+=2){
      next.push(buildMatch(depth,i/2,previous[i].winner,previous[i+1].winner,previous[i].settled,previous[i+1].settled,bracket.results));
    }
    rounds.push(next);previous=next;
  }
  return rounds;
}
function buildMatch(r,i,a,b,ak,bk,results){
  let winner=null,settled=false;const key=r+'-'+i;
  if(ak&&bk){
    if(a&&b){if(results[key]===a||results[key]===b){winner=results[key];settled=true}}
    else {winner=a||b||null;settled=true}
  }
  return {key,a,b,winner,settled};
}
function safeTournament(t,players){
  const pmap=new Map(players.map(p=>[p.uid,p]));
  const rounds=buildRounds(t.bracket).map(round=>round.map(m=>({
    ...m,aname:m.a?(pmap.get(m.a)?.nickname||m.a):null,
    bname:m.b?(pmap.get(m.b)?.nickname||m.b):null
  })));
  return {slug:t.slug,title:t.title,region:t.region,capacity:t.capacity,status:t.status,
    createdAt:t.created_at,players,rounds};
}
async function init(){
  await pool.query("create table if not exists tournaments (id bigserial primary key,slug text unique not null,title text not null,region text not null default 'SAC',capacity int not null default 16,status text not null default 'open',bracket jsonb,created_at timestamptz not null default now())");
  await pool.query("create table if not exists registrations (id bigserial primary key,tournament_id bigint not null references tournaments(id) on delete cascade,uid text not null,nickname text not null,region text not null,level int not null default 0,created_at timestamptz not null default now(),unique(tournament_id,uid))");
  await pool.query('create index if not exists registrations_tournament_idx on registrations(tournament_id)');
}
app.get('/health',async(req,res)=>{
  try{await pool.query('select 1');res.json({ok:true})}catch(e){res.status(503).json({ok:false})}
});
app.post('/api/admin/login',(req,res)=>{
  if(limited(req,'login',10,15*60000))return fail(res,429,'Demasiados intentos. Probá más tarde.');
  const attempt=String(req.body?.password||'');
  const a=crypto.createHash('sha256').update(attempt).digest();
  const b=crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if(!crypto.timingSafeEqual(a,b))return fail(res,401,'Contraseña incorrecta');
  cookie(res,cookieValue(),7*86400000);res.json({ok:true});
});
app.post('/api/admin/logout',admin,(req,res)=>{cookie(res,'',0);res.json({ok:true})});
app.get('/api/admin/me',(req,res)=>res.json({admin:isAdmin(req)}));
app.get('/api/tournaments',async(req,res,next)=>{
  try{
    const q=await pool.query("select t.slug,t.title,t.region,t.capacity,t.status,t.created_at,count(r.id)::int as count from tournaments t left join registrations r on r.tournament_id=t.id group by t.id order by t.created_at desc limit 80");
    res.json({tournaments:q.rows});
  }catch(e){next(e)}
});
app.get('/api/tournaments/:slug',async(req,res,next)=>{
  try{const t=await getTournament(req.params.slug);if(!t)return fail(res,404,'Torneo no encontrado');
    res.json(safeTournament(t,await roster(t.id)));
  }catch(e){next(e)}
});
app.post('/api/lookup',async(req,res)=>{
  if(limited(req,'lookup',15,60000))return fail(res,429,'Demasiadas consultas. Probá en un minuto.');
  const uid=String(req.body?.uid||'');const region=String(req.body?.region||'');
  if(!validUID(uid)||!validRegion(region))return fail(res,400,'ID o región inválidos');
  try{res.json(await findPlayer(uid,region))}
  catch(e){fail(res,502,e.message||'No se pudo consultar el jugador')}
});
app.post('/api/tournaments/:slug/register',async(req,res,next)=>{
  if(limited(req,'register',8,10*60000))return fail(res,429,'Demasiados registros desde esta conexión');
  const uid=String(req.body?.uid||'');
  if(!validUID(uid))return fail(res,400,'Ingresá un ID válido');
  let t;try{t=await getTournament(req.params.slug)}catch(e){return next(e)}
  if(!t)return fail(res,404,'Torneo no encontrado');
  if(t.status!=='open')return fail(res,409,'Las inscripciones están cerradas');
  let verified;
  try{verified=await findPlayer(uid,t.region)}catch(e){return fail(res,502,'No se pudo verificar el ID: '+e.message)}
  const client=await pool.connect();
  try{
    await client.query('begin');
    const locked=(await client.query('select * from tournaments where id=$1 for update',[t.id])).rows[0];
    if(locked.status!=='open')throw Object.assign(new Error('Las inscripciones están cerradas'),{status:409});
    const cnt=Number((await client.query('select count(*)::int as n from registrations where tournament_id=$1',[t.id])).rows[0].n);
    if(cnt>=locked.capacity)throw Object.assign(new Error('El torneo está completo'),{status:409});
    await client.query('insert into registrations(tournament_id,uid,nickname,region,level) values ($1,$2,$3,$4,$5)',[t.id,uid,verified.nickname,verified.region,verified.level]);
    await client.query('commit');res.status(201).json({ok:true,player:verified});
  }catch(e){
    await client.query('rollback').catch(()=>{});
    if(e.code==='23505')return fail(res,409,'Este ID ya está inscripto en el torneo');
    if(e.status)return fail(res,e.status,e.message);
    next(e);
  }finally{client.release()}
});
app.post('/api/admin/tournaments',admin,async(req,res,next)=>{
  const title=sanitizeTitle(req.body?.title),region=String(req.body?.region||'SAC'),capacity=Number(req.body?.capacity||16);
  if(title.length<3||!validRegion(region)||![4,8,16,32,64,128].includes(capacity))return fail(res,400,'Datos del torneo inválidos');
  try{
    const slug=crypto.randomBytes(5).toString('hex');
    await pool.query('insert into tournaments(slug,title,region,capacity) values($1,$2,$3,$4)',[slug,title,region,capacity]);
    res.status(201).json({ok:true,slug,link:req.protocol+'://'+req.get('host')+'/t/'+slug});
  }catch(e){next(e)}
});
app.post('/api/admin/tournaments/:slug/state',admin,async(req,res,next)=>{
  if(!['open','closed'].includes(req.body?.status))return fail(res,400,'Estado inválido');
  try{
    const q=await pool.query("update tournaments set status=$1 where slug=$2 and status in ('open','closed') returning slug", [req.body.status,req.params.slug]);
    if(!q.rowCount)return fail(res,409,'No se puede cambiar el estado ahora');
    res.json({ok:true});
  }catch(e){next(e)}
});
app.post('/api/admin/tournaments/:slug/draw',admin,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    await client.query('begin');
    const t=(await client.query('select * from tournaments where slug=$1 for update',[req.params.slug])).rows[0];
    if(!t)throw Object.assign(new Error('Torneo no encontrado'),{status:404});
    if(t.bracket)throw Object.assign(new Error('Este torneo ya tiene un sorteo'),{status:409});
    const players=(await client.query('select uid from registrations where tournament_id=$1',[t.id])).rows;
    if(players.length<2)throw Object.assign(new Error('Se necesitan al menos 2 jugadores'),{status:409});
    await client.query("update tournaments set status='started',bracket=$1::jsonb where id=$2",[JSON.stringify(makeBracket(players)),t.id]);
    await client.query('commit');res.json({ok:true});
  }catch(e){await client.query('rollback').catch(()=>{});if(e.status)return fail(res,e.status,e.message);next(e)}
  finally{client.release()}
});
app.post('/api/admin/tournaments/:slug/winner',admin,async(req,res,next)=>{
  const client=await pool.connect();
  try{
    await client.query('begin');
    const t=(await client.query('select * from tournaments where slug=$1 for update',[req.params.slug])).rows[0];
    if(!t||!t.bracket)throw Object.assign(new Error('Torneo sin sorteo'),{status:404});
    const rounds=buildRounds(t.bracket);
    let chosen;
    for(const round of rounds)for(const match of round)if(match.key===req.body?.key)chosen=match;
    const uid=String(req.body?.uid||'');
    if(!chosen || !chosen.a || !chosen.b || (uid!==chosen.a&&uid!==chosen.b))throw Object.assign(new Error('Ganador inválido'),{status:400});
    const position=chosen.key.split('-').map(Number);let depth=position[0],index=position[1];
    t.bracket.results[chosen.key]=uid;
    while(depth<rounds.length-1){depth++;index=Math.floor(index/2);delete t.bracket.results[depth+'-'+index]}
    const updated=buildRounds(t.bracket);
    const final=updated.at(-1)?.[0]?.winner;
    await client.query('update tournaments set bracket=$1::jsonb,status=$2 where id=$3',[JSON.stringify(t.bracket),final?'finished':'started',t.id]);
    await client.query('commit');res.json({ok:true,finished:!!final});
  }catch(e){await client.query('rollback').catch(()=>{});if(e.status)return fail(res,e.status,e.message);next(e)}
  finally{client.release()}
});
app.use(express.static(path.join(__dirname,'public'),{maxAge:'5m'}));
app.get(['/','/admin','/t/:slug'],(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{console.error('API Error:',err.code||err.message);fail(res,500,'Error temporal del servidor')});
init().then(()=>app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('JS Tournaments online ready'))).catch(e=>{console.error('Database init failed:',e.message);process.exit(1)});
