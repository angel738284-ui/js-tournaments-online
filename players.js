'use strict';
const crypto=require('crypto');
const COOKIE='js_tournaments_player';
const MAX_AGE=30*24*60*60*1000;
const RG=new Set(['SAC','BR','US','NA','SG','IND','ID','EU','TH','VN','BD','ME']);
const validUID=x=>typeof x==='string'&&/^[0-9]{5,15}$/.test(x);
function digest(v){return crypto.createHash('sha256').update(v).digest('hex')}
function derive(pass,salt){return crypto.scryptSync(pass,salt,64,{N:16384,r:8,p:1}).toString('hex')}
function secureCompare(a,b){
 const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');
 return aa.length===bb.length && aa.length>0 && crypto.timingSafeEqual(aa,bb);
}
function credentials(pass){
 if(typeof pass!=='string'||pass.length<8||pass.length>128)throw new Error('Usá una contraseña de 8 a 128 caracteres.');
 const salt=crypto.randomBytes(24).toString('hex');
 return 'scrypt-v1$'+salt+'$'+derive(pass,salt);
}
function checkCredentials(pass,record){
 if(typeof pass!=='string'||!record || pass.length<8||pass.length>128)return false;
 const parts=record.split('$');
 if(parts.length!==3||parts[0]!=='scrypt-v1')return false;
 return secureCompare(derive(pass,parts[1]),parts[2]);
}
module.exports=function setupPlayerRoutes(app,{pool,findPlayer,limited,fail}){
 async function init(){
   await pool.query("create table if not exists player_accounts (id bigserial primary key,uid text not null,region text not null,nickname text not null,level int not null default 0,password_hash text not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(uid,region))");
   await pool.query("create table if not exists player_sessions (token_hash text primary key,player_id bigint not null references player_accounts(id) on delete cascade,expires_at timestamptz not null)");
   await pool.query("create index if not exists player_sessions_exp_idx on player_sessions(expires_at)");
 }
 function cleanPlayer(p){
  return {id:p.id,uid:p.uid,region:p.region,nickname:p.nickname,level:p.level,createdAt:p.created_at};
 }
 async function loadUser(req){
   const all=req.headers.cookie||'';
   const item=all.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
   if(!item)return null;
   const token=item.slice(COOKIE.length+1);
   if(!/^[0-9a-f]{64}$/.test(token))return null;
   const q=await pool.query('select a.id,a.uid,a.region,a.nickname,a.level,a.created_at from player_accounts a join player_sessions s on s.player_id=a.id where s.token_hash=$1 and s.expires_at>now()', [digest(token)]);
   return q.rows[0]||null;
 }
 async function auth(req,res,next){
   try{req.player=await loadUser(req);if(!req.player)return fail(res,401,'Iniciá sesión en tu cuenta para anotarte.');next()}
   catch(e){next(e)}
 }
 async function issueSession(user,res){
   const token=crypto.randomBytes(32).toString('hex');
   await pool.query("insert into player_sessions(token_hash,player_id,expires_at) values($1,$2,now() + interval '30 days')",[digest(token),user.id]);
   res.cookie(COOKIE,token,{path:'/',httpOnly:true,secure:true,sameSite:'lax',maxAge:MAX_AGE});
 }
 app.get('/api/player/me',async(req,res,next)=>{
   try{const user=await loadUser(req);res.json({authenticated:!!user,player:user?cleanPlayer(user):null})}
   catch(e){next(e)}
 });
 app.post('/api/player/register',async(req,res,next)=>{
   if(limited(req,'player-register',5,30*60000))return fail(res,429,'Demasiados registros. Probá más tarde.');
   const uid=String(req.body?.uid||''),region=String(req.body?.region||'');
   const password=req.body?.password;
   if(!validUID(uid)||!RG.has(region))return fail(res,400,'ID o región inválidos.');
   if(typeof password!=='string'||password.length<8||password.length>128)return fail(res,400,'Contraseña de 8 a 128 caracteres.');
   try{
     const existing=await pool.query('select 1 from player_accounts where uid=$1 and region=$2',[uid,region]);
     if(existing.rowCount)return fail(res,409,'Este ID ya tiene una cuenta. Entrá con tu contraseña.');
     const data=await findPlayer(uid,region);
     const passhash=credentials(password);
     const q=await pool.query('insert into player_accounts(uid,region,nickname,level,password_hash) values($1,$2,$3,$4,$5) returning id,uid,region,nickname,level,created_at',[uid,region,data.nickname,data.level,passhash]);
     await issueSession(q.rows[0],res);
     res.status(201).json({ok:true,player:cleanPlayer(q.rows[0]),ownershipVerified:false});
   }catch(e){
     if(e.code==='23505')return fail(res,409,'Este ID ya está registrado.');
     if(/jugador|servicio|consultar|disponible|región|encontramos/i.test(e.message||''))return fail(res,502,'No pudimos verificar el nickname: '+e.message);
     next(e);
   }
 });
 app.post('/api/player/login',async(req,res,next)=>{
   if(limited(req,'player-login',12,15*60000))return fail(res,429,'Demasiados intentos. Probá más tarde.');
   const uid=String(req.body?.uid||''),region=String(req.body?.region||''),password=req.body?.password;
   if(!validUID(uid)||!RG.has(region)||typeof password!=='string')return fail(res,400,'Credenciales inválidas.');
   try{
     const q=await pool.query('select id,uid,region,nickname,level,created_at,password_hash from player_accounts where uid=$1 and region=$2',[uid,region]);
     if(!q.rowCount||!checkCredentials(password,q.rows[0].password_hash))return fail(res,401,'ID, región o contraseña incorrectos.');
     const user=q.rows[0];await issueSession(user,res);
     res.json({ok:true,player:cleanPlayer(user)});
   }catch(e){next(e)}
 });
 app.post('/api/player/logout',async(req,res,next)=>{
   try{
     const item=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
     if(item){const token=item.slice(COOKIE.length+1);if(/^[0-9a-f]{64}$/.test(token))await pool.query('delete from player_sessions where token_hash=$1',[digest(token)])}
     res.clearCookie(COOKIE,{path:'/',secure:true,sameSite:'lax'});
     res.json({ok:true});
   }catch(e){next(e)}
 });
 app.get('/api/player/tournaments',auth,async(req,res,next)=>{
   try{
     const q=await pool.query("select t.slug,t.title,t.region,t.capacity,t.status,t.created_at,count(allr.id)::int as count,(mine.uid is not null) as joined from tournaments t left join registrations allr on allr.tournament_id=t.id left join registrations mine on mine.tournament_id=t.id and mine.uid=$1 where t.region=$2 group by t.id,mine.uid order by t.created_at desc limit 100",[req.player.uid,req.player.region]);
     res.json({tournaments:q.rows});
   }catch(e){next(e)}
 });
 return {init,auth,loadUser};
};
