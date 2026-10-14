'use strict';
const crypto=require('crypto');
const codeHash=value=>crypto.createHash('sha256').update(value).digest('hex');
const allowedRegions=new Set(['SAC','BR','US','NA','SG','IND','ID','EU','TH','VN','BD','ME']);
module.exports=function activationRoutes(app,{pool,loadUser,admin,limited,fail}){
 async function init(){
  await pool.query('alter table player_accounts add column if not exists verified_at timestamptz');
  await pool.query("create table if not exists activation_codes (id bigserial primary key,code_hash text not null unique,uid text not null,region text not null,issued_at timestamptz not null default now(),expires_at timestamptz not null,used_at timestamptz,used_by bigint references player_accounts(id),revoked_at timestamptz)");
  await pool.query('create index if not exists activation_codes_uid_region_idx on activation_codes(uid,region)');
 }
 app.get('/api/admin/players',admin,async(req,res,next)=>{
  try{
   const q=await pool.query('select uid,region,nickname,level,created_at,verified_at from player_accounts order by created_at desc limit 200');
   res.json({players:q.rows.map(x=>({...x,verified:!!x.verified_at}))});
  }catch(e){next(e)}
 });
 app.post('/api/admin/codes',admin,async(req,res,next)=>{
  if(limited(req,'codes-create',35,15*60000))return fail(res,429,'Generaste demasiados códigos. Probá más tarde.');
  const uid=String(req.body?.uid||'');
  const region=String(req.body?.region||'').toUpperCase();
  if(!/^[0-9]{5,15}$/.test(uid)||!allowedRegions.has(region))return fail(res,400,'ID o región inválidos');
  const client=await pool.connect();
  try{
    await client.query('begin');
    const target=await client.query('select uid,region,nickname,verified_at from player_accounts where uid=$1 and region=$2 for update',[uid,region]);
    if(!target.rowCount)throw Object.assign(new Error('Primero el jugador debe crear su cuenta JS TOURNAMENTS.'),{status:404});
    if(target.rows[0].verified_at)throw Object.assign(new Error('Esta cuenta ya está activada.'),{status:409});
    await client.query("update activation_codes set revoked_at=now() where uid=$1 and region=$2 and used_at is null and revoked_at is null",[uid,region]);
    const token='JS-'+crypto.randomBytes(6).toString('hex').toUpperCase();
    const q=await client.query("insert into activation_codes(code_hash,uid,region,expires_at) values($1,$2,$3,now()+interval '15 minutes') returning expires_at",[codeHash(token),uid,region]);
    await client.query('commit');
    res.status(201).json({ok:true,code:token,uid,region,nickname:target.rows[0].nickname,expiresAt:q.rows[0].expires_at,oneTime:true});
  }catch(e){
    await client.query('rollback').catch(()=>{});
    if(e.status)return fail(res,e.status,e.message);
    next(e);
  }finally{client.release()}
 });
 app.post('/api/player/activate',async(req,res,next)=>{
  if(limited(req,'codes-redeem',12,15*60000))return fail(res,429,'Demasiados intentos. Volvé a probar más tarde.');
  let user;try{user=await loadUser(req)}catch(e){return next(e)}
  if(!user)return fail(res,401,'Primero iniciá sesión con tu cuenta de jugador.');
  const code=String(req.body?.code||'').trim().toUpperCase().replace(/\s+/g,'');
  if(!/^JS-[A-F0-9]{12}$/.test(code))return fail(res,400,'El código no tiene el formato correcto.');
  const client=await pool.connect();
  try{
   await client.query('begin');
   const q=await client.query('select id,verified_at from player_accounts where id=$1 for update',[user.id]);
   if(!q.rowCount)throw Object.assign(new Error('La cuenta no existe.'),{status:404});
   if(q.rows[0].verified_at)throw Object.assign(new Error('Esta cuenta ya está activada.'),{status:409});
   const used=await client.query("update activation_codes set used_at=now(),used_by=$1 where code_hash=$2 and uid=$3 and region=$4 and used_at is null and revoked_at is null and expires_at>now() returning id",[user.id,codeHash(code),user.uid,user.region]);
   if(!used.rowCount)throw Object.assign(new Error('Código inválido, vencido, usado o asignado a otro ID.'),{status:400});
   await client.query('update player_accounts set verified_at=now(),updated_at=now() where id=$1',[user.id]);
   await client.query('commit');res.json({ok:true,verified:true,message:'Cuenta activada con éxito'});
  }catch(e){
   await client.query('rollback').catch(()=>{});
   if(e.status)return fail(res,e.status,e.message);
   next(e);
  }finally{client.release()}
 });
 return {init};
};
