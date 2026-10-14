'use strict';
const root=document.getElementById('app'),toast=document.getElementById('toast');
let current=null,lookupResult=null,uidTyped='',lookupTimer=null,busyLookup=false,adminMode=false;
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function tip(s){toast.textContent=s;toast.style.display='block';clearTimeout(tip.timer);tip.timer=setTimeout(()=>toast.style.display='none',3400)}
async function api(endpoint,opts){
  const options=opts||{};
  const res=await fetch('/api'+endpoint,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.headers||{})}});
  let data={};try{data=await res.json()}catch{}
  if(!res.ok)throw new Error(data.error||'No se pudo conectar al servidor');
  return data;
}
function stateLabel(status){return ({open:'Inscripciones abiertas',closed:'Inscripciones cerradas',started:'En juego',finished:'Finalizado'})[status]||status}
function badge(status){return '<span class="badge '+(status==='open'?'':status==='closed'?'closed':'started')+'">'+esc(stateLabel(status))+'</span>'}
function button(label,fn,extra){return '<button class="btn '+(extra||'')+'" onclick="'+fn+'">'+label+'</button>'}
function empty(emoji,title,description){return '<div class="empty"><div class="big">'+emoji+'</div><strong>'+esc(title)+'</strong>'+esc(description)+'</div>'}
function eventCard(t,asAdmin){
  const count=t.count??t.players?.length??0;
  const fn=asAdmin?'/admin?event='+t.slug:'/t/'+t.slug;
  return '<div class="panel event"><div class="between"><span class="eyebrow">⚔ FREE FIRE · '+esc(t.region)+'</span>'+badge(t.status)+'</div><h2>'+esc(t.title)+'</h2><p class="muted small">'+count+' de '+t.capacity+' participantes</p><div class="eventFoot"><span class="muted small">'+(asAdmin?'Tu torneo':'JS Family')+'</span><a class="btn primary small" href="'+fn+'">'+(asAdmin?'Administrar':'Ver torneo')+' →</a></div></div>';
}
function hero(title,desc,eyebrow,extra){
  return '<div class="hero"><div class="eyebrow">'+eyebrow+'</div><h1>'+esc(title)+'</h1><p class="lead">'+desc+'</p>'+(extra||'')+'</div>';
}
async function showHome(){
  adminMode=false;document.getElementById('adminLink').hidden=false;
  root.innerHTML=hero('JUGÁ. COMPETÍ. GANÁ.','Todos los torneos de JS Family en un solo lugar. Elegí tu torneo e inscribite con tu ID de Free Fire.','🏆 TORNEOS DE LA COMUNIDAD');
  try{
    const d=await api('/tournaments');const active=d.tournaments.filter(t=>t.status!=='finished');
    const done=d.tournaments.filter(t=>t.status==='finished');
    root.innerHTML+='<div class="between"><h2>Torneos disponibles</h2><span class="muted small">'+active.length+' eventos</span></div>'+
      (active.length?'<div class="grid">'+active.map(t=>eventCard(t,false)).join('')+'</div>':empty('⚔','Próximamente','Todavía no hay torneos publicados.'))+
      (done.length?'<h2>Finalizados</h2><div class="grid">'+done.map(t=>eventCard(t,false)).join('')+'</div>':'');
  }catch(e){root.innerHTML+='<div class="note">'+esc(e.message)+'</div>'}
}
function playerCard(p,i){
  return '<div class="player"><div class="avatar">'+(i+1)+'</div><div class="player-body"><div class="player-name">'+esc(p.nickname)+'</div><small>ID '+esc(p.uid)+' · '+esc(p.region)+(p.level?' · Nivel '+p.level:'')+'</small></div><span class="good small">✓</span></div>';
}
function matchUI(match,organizer){
  function fighter(uid,name){
    if(!uid)return '<div class="fighter emptySlot"><span>Libre / pendiente</span></div>';
    const winner=match.winner===uid;
    return '<div class="fighter '+(winner?'win ':'')+(organizer&&match.a&&match.b?'pick':'')+'"'+
      (organizer&&match.a&&match.b?' onclick="win(\''+match.key+'\',\''+uid+'\')"':'')+
      '><span>'+esc(name||uid)+'</span>'+(winner?' <b class="good">✓</b>':'')+'</div>';
  }
  return '<div class="match">'+fighter(match.a,match.aname)+fighter(match.b,match.bname)+'</div>';
}
function bracketUI(t,organizer){
  if(!t.rounds||!t.rounds.length)return empty('⚔','Sorteo pendiente','Los enfrentamientos aparecerán cuando el organizador realice el sorteo.');
  const rounds='<div class="bracketClip"><div class="bracket">'+t.rounds.map((round,i)=>{
    const title=i===t.rounds.length-1?'Final':i===t.rounds.length-2?'Semifinal':i===t.rounds.length-3?'Cuartos':'Ronda '+(i+1);
    return '<div class="round"><div class="roundTitle">'+title+'</div><div class="matches">'+round.map(m=>matchUI(m,organizer)).join('')+'</div></div>';
  }).join('')+'</div></div>';
  const last=t.rounds.at(-1)?.[0]?.winner;
  const champ=last?t.players.find(p=>p.uid===last)?.nickname||last:null;
  return rounds+(champ?'<div class="trophy">🏆 CAMPEÓN<strong>'+esc(champ)+'</strong></div>':'')+
    (organizer?'<div class="note">Tocá sobre el jugador que ganó cada enfrentamiento. Los ganadores avanzan automáticamente.</div>':'');
}
function syncLookupStatus(message,good){
  const el=document.getElementById('lookupState');
  if(el){el.className='note '+(good?'success':'');el.textContent=message}
  const btn=document.getElementById('joinBtn');
  if(btn)btn.disabled=!good;
}
function idChanged(){
  uidTyped=document.getElementById('uidInput').value.trim();
  lookupResult=null;syncLookupStatus('Escribí tu ID y buscaremos tu nombre.',false);
  clearTimeout(lookupTimer);
  if(/^[0-9]{7,15}$/.test(uidTyped))lookupTimer=setTimeout(doLookup,1050);
}
async function doLookup(){
  clearTimeout(lookupTimer);
  const uid=(document.getElementById('uidInput')?.value||'').trim();
  if(!/^[0-9]{5,15}$/.test(uid)){syncLookupStatus('Ingresá un ID numérico válido (5 a 15 dígitos).',false);return}
  if(busyLookup)return;
  busyLookup=true;lookupResult=null;syncLookupStatus('🔎 Consultando el nickname...',false);
  try{
    const player=await api('/lookup',{method:'POST',body:JSON.stringify({uid,region:current.region})});
    if(document.getElementById('uidInput')?.value.trim()!==uid)return;
    lookupResult=player;
    syncLookupStatus('✅ '+player.nickname+' · '+player.region+' · Nivel '+player.level,true);
  }catch(e){syncLookupStatus(e.message,false)}
  finally{busyLookup=false}
}
async function join(){
  const uid=document.getElementById('uidInput')?.value.trim();
  if(!lookupResult||lookupResult.uid!==uid)return tip('Verificá el ID primero.');
  const btn=document.getElementById('joinBtn');if(btn)btn.disabled=true;
  try{
    await api('/tournaments/'+current.slug+'/register',{method:'POST',body:JSON.stringify({uid})});
    lookupResult=null;uidTyped='';
    tip('✅ ¡Te inscribiste correctamente!');
    await loadTournament();
  }catch(e){tip(e.message);syncLookupStatus(e.message,false)}
}
function publicView(t){
  current=t;adminMode=false;
  document.title=t.title+' | JS TOURNAMENTS';
  const n=t.players.length,share=location.origin+'/t/'+t.slug;
  root.innerHTML=hero(t.title, 'Mirá los jugadores y enfrentamientos. ¡Anotate y demostrá quién manda!','⚔ TORNEO FREE FIRE · '+esc(t.region),
    '<div class="btnrow">'+badge(t.status)+'</div>')+
    '<div class="stats"><div class="stat"><strong>'+n+'</strong><span>Inscriptos</span></div>'+
      '<div class="stat"><strong>'+t.capacity+'</strong><span>Cupos</span></div>'+
      '<div class="stat"><strong>'+Math.max(0,t.capacity-n)+'</strong><span>Disponibles</span></div></div>'+
    (t.status==='open'&&n<t.capacity?
      '<div class="panel"><h2>📝 Inscribirme</h2><p class="muted small">Con tu cuenta de jugador de JS Family podés anotarte con un toque, sin escribir el ID cada vez.</p><a class="btn primary full" href="/player?event='+encodeURIComponent(t.slug)+'">Entrar con mi cuenta →</a></div>':
      '<div class="panel">'+empty('🔒','Inscripciones no disponibles',n>=t.capacity?'Cupos completos.':stateLabel(t.status))+'</div>')+
    '<div class="panel"><h2>🔗 Compartir torneo</h2><div class="share"><input id="shareLink" readonly value="'+esc(share)+'">'+button('Copiar','copyLink()','primary')+'</div></div>'+
    '<div class="twocol"><section class="panel"><h2>👥 Participantes ('+n+')</h2>'+ (n?t.players.map(playerCard).join(''):empty('👥','Aún no hay inscriptos','Sé el primero en anotarte.'))+'</section>'+
    '<section class="panel"><h2>🏆 Llaves del torneo</h2>'+bracketUI(t,false)+'</section></div>';
  if(lookupResult&&lookupResult.uid===uidTyped&&t.status==='open')syncLookupStatus('✅ '+lookupResult.nickname+' · '+lookupResult.region+' · Nivel '+lookupResult.level,true);
}
async function loadTournament(){
  const slug=location.pathname.split('/')[2];
  try{
    const t=await api('/tournaments/'+encodeURIComponent(slug));
    publicView(t);
  }catch(e){root.innerHTML=empty('⚠','No se pudo abrir el torneo',e.message)+'<a class="btn" href="/">Volver al inicio</a>'}
}
async function copyLink(){
  const el=document.getElementById('shareLink');if(!el)return;
  try{await navigator.clipboard.writeText(el.value);tip('✓ Enlace copiado')}
  catch(e){el.select();document.execCommand('copy');tip('Enlace seleccionado: podés copiarlo')}
}
async function adminStart(){
  adminMode=true;document.getElementById('adminLink').hidden=true;
  try{const me=await api('/admin/me');if(!me.admin)return adminLogin();await adminHome()}
  catch(e){root.innerHTML=empty('⚠','No se pudo cargar el panel',e.message)}
}
function adminLogin(){
  root.innerHTML=hero('Panel del organizador','Solo el administrador de JS Family puede crear torneos y elegir ganadores.','🔐 ACCESO PRIVADO')+
    '<div class="panel" style="max-width:520px"><form onsubmit="signIn(event)"><div class="field"><label>Contraseña de administrador</label>'+
    '<input id="password" type="password" autocomplete="current-password" placeholder="Tu contraseña de JS Family" required></div>'+
    '<button class="btn primary full" type="submit">Entrar al panel</button></form></div>';
}
async function signIn(e){
  e.preventDefault();
  try{await api('/admin/login',{method:'POST',body:JSON.stringify({password:document.getElementById('password').value})});await adminHome()}
  catch(e){tip(e.message)}
}
async function logout(){await api('/admin/logout',{method:'POST'});adminLogin()}
async function adminHome(){
  const selected=new URLSearchParams(location.search).get('event');
  if(selected)return adminTournament(selected);
  try{
    const d=await api('/tournaments');
    root.innerHTML=hero('Organizá tus torneos','Creá un torneo nuevo, compartí el enlace y los jugadores se registran desde su celular.','⚙ PANEL PRIVADO',
      '<div class="btnrow">'+button('Cerrar sesión','logout()','outline')+'</div>')+
      '<div class="twocol"><div class="panel"><h2>➕ Nuevo torneo</h2><form onsubmit="createTournament(event)">'+
        '<div class="field"><label>Nombre</label><input id="newTitle" maxlength="90" placeholder="Ejemplo: TORNEO PVP 1VS1 JS FAMILY" required></div>'+
        '<div class="field"><label>Región</label><select id="newRegion"><option value="SAC">SAC · Argentina / Región Sur</option><option value="US">US · Región Norte</option><option value="BR">Brasil</option><option value="NA">Norteamérica</option><option value="SG">Singapur</option></select></div>'+
        '<div class="field"><label>Cupos</label><select id="newCap"><option>4</option><option>8</option><option selected>16</option><option>32</option><option>64</option><option>128</option></select></div>'+
        '<button class="btn primary full" type="submit">Crear y obtener enlace</button></form></div>'+
      '<div class="panel"><h2>Cómo funciona</h2><p>① Creás un torneo y copiás su enlace.</p><p>② Cada jugador entra y coloca su ID. El sistema obtiene el nickname.</p><p>③ Cerrás las inscripciones y sorteás las llaves.</p><p>④ Elegís ganadores y aparecen automáticamente en la ronda siguiente.</p>'+
      '<div class="note">La verificación de ID consulta una API comunitaria, no oficial. No comprueba la propiedad de la cuenta.</div></div></div>'+
      '<h2>Mis torneos</h2>'+(d.tournaments.length?'<div class="grid">'+d.tournaments.map(t=>eventCard(t,true)).join('')+'</div>':empty('🏆','Todavía no hay torneos','Creá el primero desde el formulario.'));
  }catch(e){root.innerHTML=empty('⚠','Error del panel',e.message)}
}
async function createTournament(e){
  e.preventDefault();
  const title=document.getElementById('newTitle').value.trim();
  const capacity=+document.getElementById('newCap').value;
  const region=document.getElementById('newRegion').value;
  try{
    const d=await api('/admin/tournaments',{method:'POST',body:JSON.stringify({title,capacity,region})});
    tip('✓ Torneo creado');location.href='/admin?event='+d.slug;
  }catch(e){tip(e.message)}
}
async function adminTournament(slug){
  try{
    const t=await api('/tournaments/'+encodeURIComponent(slug));current=t;adminMode=true;
    const share=location.origin+'/t/'+t.slug,n=t.players.length;
    root.innerHTML=hero(t.title,'Organizá inscripciones, enfrentamientos y resultados en tiempo real.','⚙ ADMINISTRADOR · '+esc(t.region),
      '<div class="btnrow"><a href="/admin" class="btn">← Mis torneos</a>'+badge(t.status)+'</div>')+
      '<div class="stats"><div class="stat"><strong>'+n+'</strong><span>Jugadores</span></div>'+
      '<div class="stat"><strong>'+t.capacity+'</strong><span>Cupos</span></div>'+
      '<div class="stat"><strong>'+Math.max(t.capacity-n,0)+'</strong><span>Disponibles</span></div></div>'+
      '<div class="panel"><h2>🔗 Enlace de inscripción</h2><div class="share"><input id="shareLink" readonly value="'+esc(share)+'">'+button('Copiar','copyLink()','primary')+'</div><p class="muted small" style="margin-top:10px">Compartilo por WhatsApp o en tu comunidad. Nadie necesita instalar la APK.</p></div>'+
      '<div class="panel"><h2>Acciones del organizador</h2><div class="btnrow">'+
      (t.status==='open'?button('Cerrar inscripciones','setState("closed")','outline'):'')+
      (t.status==='closed'?button('Reabrir inscripciones','setState("open")',''):'')+
      ((t.status==='open'||t.status==='closed')?button('⚔ Sortear enfrentamientos','doDraw()','primary'):'')+
      button('↻ Actualizar lista','adminTournament("'+t.slug+'")','')+
      '</div><p class="muted small" style="margin-top:9px">El sorteo se habilita con 2 o más jugadores. Luego de sortear no se aceptan nuevas inscripciones.</p></div>'+
      '<div class="twocol"><section class="panel"><h2>👥 Inscriptos ('+n+')</h2>'+
      (n?t.players.map(playerCard).join(''):empty('👥','Sin participantes','Compartí el enlace para que se anoten.'))+'</section>'+
      '<section class="panel"><h2>🏆 Enfrentamientos</h2>'+bracketUI(t,true)+'</section></div>';
  }catch(e){root.innerHTML=empty('⚠','No se pudo cargar el torneo',e.message)+'<a href="/admin" class="btn">Volver</a>'}
}
async function setState(status){
  try{
    await api('/admin/tournaments/'+current.slug+'/state',{method:'POST',body:JSON.stringify({status})});
    await adminTournament(current.slug);tip('✓ Inscripciones '+(status==='open'?'abiertas':'cerradas'));
  }catch(e){tip(e.message)}
}
async function doDraw(){
  if(current.players.length<2)return tip('Primero se necesitan dos jugadores.');
  if(!confirm('¿Sortear los enfrentamientos y cerrar las inscripciones?'))return;
  try{
    await api('/admin/tournaments/'+current.slug+'/draw',{method:'POST',body:JSON.stringify({})});
    await adminTournament(current.slug);tip('⚔ Enfrentamientos sorteados');
  }catch(e){tip(e.message)}
}
async function win(key,uid){
  const player=current.players.find(p=>p.uid===uid);
  if(!confirm('¿Confirmar como ganador a '+(player?.nickname||uid)+'?'))return;
  try{
    await api('/admin/tournaments/'+current.slug+'/winner',{method:'POST',body:JSON.stringify({key,uid})});
    await adminTournament(current.slug);tip('✓ Ganador registrado');
  }catch(e){tip(e.message)}
}
async function boot(){
  if(location.pathname==='/player')return playerStart();
  if(location.pathname==='/admin')return adminStart();
  if(location.pathname.startsWith('/t/'))return loadTournament();
  return showHome();
}
boot();
setInterval(()=>{
  if(document.visibilityState!=='visible')return;
  if(location.pathname.startsWith('/t/')&&document.activeElement?.id!=='uidInput'&&!busyLookup)return loadTournament();
  if(location.pathname==='/admin'&&new URLSearchParams(location.search).has('event'))return adminTournament(new URLSearchParams(location.search).get('event'));
},25000);
