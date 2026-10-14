'use strict';
let playerSelf=null,verifiedSignup=null,signupTimer=null,signupBusy=false;
let playerFocusEvent=(new URLSearchParams(location.search)).get('event');
function playerSplash(message){
  root.innerHTML='<div class="panel center"><span class="spinner"></span><p style="margin-top:10px">'+esc(message||'Cargando perfil...')+'</p></div>';
}
function choiceRegion(selected){
 return '<select id="playerRegion">'+
 [['SAC','SAC · Argentina / Región Sur'],['US','US · Región Norte'],['BR','Brasil'],['NA','Norteamérica'],['SG','Singapur']].
 map(([r,label])=>'<option value="'+r+'" '+(r===selected?'selected':'')+'>'+label+'</option>').join('')+'</select>';
}
function playerAuthForm(which){
 playerSelf=null;verifiedSignup=null;clearTimeout(signupTimer);
 const isSignup=which==='register';
 const maybeEvent=playerFocusEvent?'Torneo seleccionado: después de ingresar podrás inscribirte automáticamente.':'Tu perfil guardará tu ID y nickname para futuros torneos.';
 root.innerHTML=hero(isSignup?'Creá tu cuenta':'Bienvenido, jugador','Tu ID de Free Fire será tu identidad en JS Family.','💎 JS FAMILY · JUGADORES')+
 '<div class="panel" style="max-width:570px;margin:0 auto">'+
 '<div class="btnrow" style="margin-bottom:16px">'+
 '<button class="btn '+(isSignup?'':'primary')+'" onclick="playerAuthForm(\'login\')">Iniciar sesión</button>'+
 '<button class="btn '+(isSignup?'primary':'')+'" onclick="playerAuthForm(\'register\')">Crear cuenta</button></div>'+
 '<form onsubmit="'+(isSignup?'playerRegister(event)':'playerLogin(event)')+'">'+
 '<div class="field"><label>ID de Free Fire</label><input id="playerUID" inputmode="numeric" pattern="[0-9]{5,15}" maxlength="15" placeholder="Ejemplo: 4557022548" required autocomplete="username" '+(isSignup?'oninput="queuePlayerLookup()"':'')+'></div>'+
 '<div class="field"><label>Región</label>'+choiceRegion('SAC')+'</div>'+
 (isSignup?'<div class="note" id="signupName">Escribí tu ID y verificaremos tu nickname automáticamente.</div><button class="btn full" type="button" onclick="fetchSignupNickname()" style="margin-bottom:14px">🔎 Buscar mi nombre de Free Fire</button>':'')+
 '<div class="field"><label>Contraseña de tu cuenta JS Family</label><input id="playerPassword" type="password" minlength="8" maxlength="128" autocomplete="'+(isSignup?'new-password':'current-password')+'" placeholder="Mínimo 8 caracteres" required></div>'+
 (isSignup?'<div class="field"><label>Repetir contraseña</label><input id="playerConfirm" type="password" minlength="8" maxlength="128" autocomplete="new-password" placeholder="Repetí la contraseña" required></div>':'')+
 '<button class="btn primary full" type="submit">'+(isSignup?'Crear mi perfil':'Entrar a mis torneos')+'</button></form>'+
 '<div class="note">'+esc(maybeEvent)+(isSignup?'<br>La consulta del nickname no verifica la propiedad del ID. No ingreses tu contraseña de Garena, solo una nueva para esta app.':'')+'</div>'+
 '</div>';
 if(isSignup)document.getElementById('playerRegion').addEventListener('change',queuePlayerLookup);
}
function queuePlayerLookup(){
 verifiedSignup=null;clearTimeout(signupTimer);
 const value=document.getElementById('playerUID')?.value.trim()||'';
 const el=document.getElementById('signupName');
 if(el)el.textContent='Escribí el ID y buscaremos el nickname...';
 if(/^[0-9]{7,15}$/.test(value))signupTimer=setTimeout(fetchSignupNickname,950);
}
async function fetchSignupNickname(){
 clearTimeout(signupTimer);
 const uid=document.getElementById('playerUID')?.value.trim(),region=document.getElementById('playerRegion')?.value;
 if(!/^[0-9]{5,15}$/.test(uid))return tip('Colocá tu ID de Free Fire.');
 if(signupBusy)return;
 signupBusy=true;
 const el=document.getElementById('signupName');el.textContent='🔎 Buscando jugador en '+region+'...';
 try{
  const info=await api('/lookup',{method:'POST',body:JSON.stringify({uid,region})});
  if(document.getElementById('playerUID')?.value.trim()!==uid||document.getElementById('playerRegion')?.value!==region)return;
  verifiedSignup=info;el.className='note success';el.textContent='✅ '+info.nickname+' · Región '+info.region+' · Nivel '+info.level;
 }catch(e){verifiedSignup=null;el.className='note error';el.textContent=e.message}
 finally{signupBusy=false}
}
async function playerRegister(event){
 event.preventDefault();
 const uid=document.getElementById('playerUID').value.trim();
 const region=document.getElementById('playerRegion').value,password=document.getElementById('playerPassword').value;
 if(password!==document.getElementById('playerConfirm').value)return tip('Las contraseñas no coinciden.');
 if(!verifiedSignup||verifiedSignup.uid!==uid||verifiedSignup.region!==region){
  tip('Primero verificá el nickname');return fetchSignupNickname();
 }
 if(!confirm('¿Crear el perfil JS Family para '+verifiedSignup.nickname+' (ID '+uid+')?'))return;
 try{
  const result=await api('/player/register',{method:'POST',body:JSON.stringify({uid,region,password})});
  playerSelf=result.player;tip('✅ Cuenta creada');await playerDashboard();
 }catch(e){tip(e.message)}
}
async function playerLogin(event){
 event.preventDefault();
 const uid=document.getElementById('playerUID').value.trim();
 const region=document.getElementById('playerRegion').value;
 const password=document.getElementById('playerPassword').value;
 try{
  const result=await api('/player/login',{method:'POST',body:JSON.stringify({uid,region,password})});
  playerSelf=result.player;tip('Bienvenido, '+result.player.nickname);await playerDashboard();
 }catch(e){tip(e.message)}
}
async function playerLogout(){
 try{await api('/player/logout',{method:'POST',body:JSON.stringify({})})}
 catch(e){tip(e.message)}
 playerSelf=null;playerAuthForm('login');
}
async function playerStart(){
 document.getElementById('adminLink').hidden=true;
 playerSplash('Cargando tu cuenta de Free Fire...');
 try{
  const d=await api('/player/me');
  if(!d.authenticated)return playerAuthForm('login');
  playerSelf=d.player;return playerDashboard();
 }catch(e){root.innerHTML=empty('⚠','No se pudo conectar',e.message)+'<button class="btn" onclick="playerStart()">Reintentar</button>'}
}
function playerTournamentCard(t){
 const canJoin=t.status==='open'&&!!playerSelf?.verified&&!t.joined&&t.count<t.capacity;
 const href='/t/'+encodeURIComponent(t.slug);
 return '<div class="panel event"><div class="between"><span class="eyebrow">⚔ FREE FIRE · '+esc(t.region)+'</span>'+badge(t.status)+'</div>'+
 '<h2>'+esc(t.title)+'</h2>'+
 '<div class="row"><span class="muted small">👥 '+t.count+'/'+t.capacity+' jugadores</span>'+(t.joined?'<span class="badge">✓ Ya inscripto</span>':'')+'</div>'+
 '<div class="eventFoot">'+(canJoin?button('💎 Anotarme','playerJoin(\''+t.slug+'\')','primary small'):'<span class="muted small">'+(t.joined?'Tu plaza está confirmada':!playerSelf?.verified?'Activá tu cuenta primero':'Ver enfrentamientos')+'</span>')+
 '<a class="btn small" href="'+href+'">Ver torneo ↗</a></div></div>';
}
async function playerDashboard(){
 if(!playerSelf)return playerAuthForm('login');
 playerSplash('Buscando torneos para tu región...');
 try{
  const response=await api('/player/tournaments');
  const t=response.tournaments||[];
  const active=t.filter(x=>x.status!=='finished'),end=t.filter(x=>x.status==='finished');
  const me=playerSelf;
  root.innerHTML=hero('Hola, '+me.nickname,me.verified?'Tu perfil está listo. Elegí un torneo y tocá «Anotarme» para participar.':'Tu perfil está creado. Introducí el código exclusivo de tu organizador para activar las inscripciones.','🎮 JS FAMILY · MI PERFIL',
    '<div class="btnrow"><button class="btn" onclick="playerDashboard()">↻ Actualizar</button><button class="btn outline" onclick="playerLogout()">Cerrar sesión</button></div>')+
    '<div class="panel"><div class="between"><div><span class="eyebrow">CUENTA DE FREE FIRE</span><h2 style="margin:9px 0 0">'+esc(me.nickname)+'</h2><div class="muted small">ID '+esc(me.uid)+' · Región '+esc(me.region)+' · Nivel '+me.level+'</div></div><span class="logo">JS</span></div><div class="note">El nombre proviene de una consulta pública. La propiedad de la cuenta Free Fire todavía no está comprobada.</div></div>'+
    '<div class="between"><h2>🏆 Torneos de mi región</h2><span class="muted small">'+active.length+' activos</span></div>'+
    (active.length?'<div class="grid">'+active.map(playerTournamentCard).join('')+'</div>':empty('⚔','Sin torneos abiertos','El administrador todavía no creó un torneo para tu región.'))+
    (end.length?'<h2>Historial de torneos</h2><div class="grid">'+end.map(playerTournamentCard).join('')+'</div>':'');
  if(!me.verified){
   const activation='<section class="panel" id="activationPanel"><span class="eyebrow">🔐 ACTIVACIÓN JS FAMILY</span><h2 style="margin-top:9px">Validación pendiente</h2>'+
      '<p class="muted small">Pedile al organizador un código para tu ID '+esc(me.uid)+' y región '+esc(me.region)+'. Solo funciona para este perfil y se usa una vez.</p>'+
      '<div class="field"><label>Mi código exclusivo</label><input id="activationInput" type="text" maxlength="15" spellcheck="false" autocomplete="off" placeholder="JS-XXXXXXXXXXXX" style="text-transform:uppercase"></div>'+
      '<button class="btn primary full" onclick="activatePlayer()">Activar mi cuenta</button><div class="note">El código caduca a los 15 minutos. El organizador debe entregártelo por un canal donde haya comprobado que controlás ese ID.</div></section>';
   root.querySelector('.hero').insertAdjacentHTML('afterend',activation);
  }else{
   root.querySelector('.hero').insertAdjacentHTML('afterend','<div class="note success">✓ Cuenta autorizada por JS Family. Podés inscribirte en torneos de tu región.</div>');
  }

  if(playerFocusEvent){
   const focus=t.find(x=>x.slug===playerFocusEvent);
   if(focus){
    const note=document.createElement('div');note.className='panel alt';
    note.innerHTML='<h2>⚔ Torneo que elegiste</h2>'+playerTournamentCard(focus);
    root.insertBefore(note,root.children[2]||null);
   }else tip('El torneo solicitado no está disponible en tu región.');
  }
 }catch(e){root.innerHTML=empty('⚠','No se pudieron cargar torneos',e.message)+'<button class="btn" onclick="playerDashboard()">Reintentar</button>'}
}
async function playerJoin(slug){
 if(!playerSelf)return playerStart();
 if(!playerSelf.verified)return tip('Necesitás activar tu cuenta con un código del administrador.');
 if(!confirm('¿Anotarte con '+playerSelf.nickname+' · ID '+playerSelf.uid+'?'))return;
 try{
  await api('/tournaments/'+encodeURIComponent(slug)+'/register',{method:'POST',body:JSON.stringify({})});
  tip('✅ Ya estás participando en el torneo.');
  playerFocusEvent=null;
  await playerDashboard();
 }catch(e){tip(e.message)}
}

async function activatePlayer(){
 if(!playerSelf)return playerStart();
 const code=(document.getElementById('activationInput')?.value||'').trim().toUpperCase().replace(/\\s+/g,'');
 if(!/^JS-[0-9A-F]{12}$/.test(code))return tip('Código incorrecto. Debe tener el formato JS-XXXXXXXXXXXX.');
 const btn=document.querySelector('#activationPanel button');if(btn)btn.disabled=true;
 try{
  await api('/player/activate',{method:'POST',body:JSON.stringify({code})});
  const result=await api('/player/me');playerSelf=result.player;
  tip('✅ ¡Tu cuenta fue activada! El código ya no sirve de nuevo.');
  await playerDashboard();
 }catch(e){tip(e.message)}
 finally{if(btn)btn.disabled=false}
}
