'use strict';
// Web version — talks to the Docker vault REST API instead of Tauri invoke.
const BASE = '';  // same origin (served by the container)

// Thin wrapper mimicking the Tauri invoke signature so the rest of the code matches v2
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opts);
  return r.json().catch(() => ({}));
}

// ── State ─────────────────────────────────────────────────────────────────────
let creds = [], editId = null, editTags = [], health = null, settings = {};
let lockSecs = 300, lockTimer = null, currentFolder = null, totpTimers = [];

const AVATAR_COLORS = [
  ['#7c5cff','#a98bff'], ['#ff6b2c','#ff8c55'], ['#3ddc84','#5eeaa0'],
  ['#ffb648','#ffce7a'], ['#ff5470','#ff8095'], ['#38bdf8','#7dd3fc'],
  ['#c084fc','#d8b4fe'], ['#fb7185','#fda4af'],
];
function avatarStyle(name){ let h=0; for(const c of (name||'?')) h=(h*31+c.charCodeAt(0))>>>0;
  const [a,b]=AVATAR_COLORS[h%AVATAR_COLORS.length]; return `background:linear-gradient(135deg,${a},${b})`; }
function initials(s){ return (s||'?').replace(/^https?:\/\//,'').replace(/^www\./,'').substring(0,2).toUpperCase(); }

addEventListener('DOMContentLoaded', async () => {
  wire();
  const st = await api('GET','/status');
  q('#lockHint').textContent = st.vaultExists ? 'Enter your master password' : '✨ First run — create your master password';
  if (st.unlocked) await enterApp();
});

async function tryUnlock() {
  const pw = q('#master').value;
  q('#lockErr').textContent=''; q('#unlockBtn').textContent='Unlocking…';
  const r = await api('POST','/unlock',{ masterPassword: pw });
  q('#unlockBtn').textContent='Unlock Vault';
  if (r.success) { q('#master').value=''; await enterApp(); }
  else q('#lockErr').textContent = r.error || 'Wrong password';
}

async function enterApp() {
  q('#lock').style.display='none'; q('#app').classList.add('show');
  settings = await api('GET','/settings');
  applyTheme(settings.theme || 'dark');
  q('#setTheme').value = settings.theme || 'dark';
  q('#setLock').value  = String(settings.auto_lock_mins ?? 5);
  q('#setClip').value  = String(settings.clip_clear_secs ?? 20);
  await refresh(); startLockTimer();
}

async function refresh() {
  const r = await api('GET','/passwords'); creds = r.passwords || [];
  health = await api('GET','/health');
  renderAll(); renderDashboard(); renderFolders();
  q('#ctAll').textContent = creds.length;
  q('#ctFav').textContent = creds.filter(c=>c.favorite).length;
  startTotpTimers();
}

// ── Lock timer ─────────────────────────────────────────────────────────────────
function startLockTimer(){ clearInterval(lockTimer); const m=settings.auto_lock_mins??5;
  if(m===0){q('#lockCountdown').textContent='∞';return;} lockSecs=m*60;
  lockTimer=setInterval(()=>{ lockSecs=Math.max(0,lockSecs-1);
    q('#lockCountdown').textContent=`${Math.floor(lockSecs/60)}:${String(lockSecs%60).padStart(2,'0')}`;
    if(lockSecs===0) doLock(); },1000); }
function resetLockTimer(){ const m=settings.auto_lock_mins??5; if(m>0) lockSecs=m*60; }
async function doLock(){ clearInterval(lockTimer); stopTotpTimers(); await api('POST','/lock');
  q('#app').classList.remove('show'); q('#lock').style.display='flex'; q('#master').focus(); }

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard(){
  const s=health.score; q('#scoreNum').textContent=s;
  const circ=327; q('#scoreArc').style.strokeDashoffset=circ-(circ*s/100);
  q('#stTotal').textContent=health.total; q('#stWeak').textContent=health.weak.length;
  q('#stReused').textContent=health.reused.length; q('#stOld').textContent=health.old.length;
  let title,msg;
  if(health.total===0){title='Empty vault';msg='Add your first credential to start building your secure vault.';}
  else if(s>=85){title='Excellent 🎉';msg='Your vault is in great shape. Passwords are strong, unique, and current.';}
  else if(s>=60){title='Good, with room to improve';msg='A few passwords could be stronger or need refreshing.';}
  else{title='Needs attention';msg='Several passwords are weak, reused, or old. Updating them boosts your score.';}
  q('#healthTitle').textContent=title; q('#healthMsg').textContent=msg;
  const flagged=new Set([...health.weak,...health.reused,...health.old]);
  const issues=creds.filter(c=>flagged.has(c.id));
  const grid=q('#issueGrid');
  if(issues.length===0){grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="e">✅</div><p>No issues found. Everything looks secure!</p></div>';}
  else{grid.innerHTML=''; issues.forEach(c=>grid.appendChild(credCard(c,flagReason(c))));}
}
function flagReason(c){const r=[];if(health.weak.includes(c.id))r.push('Weak');if(health.reused.includes(c.id))r.push('Reused');if(health.old.includes(c.id))r.push('Old');return r;}

function renderAll(){ fill(q('#allGrid'),creds); fill(q('#favGrid'),creds.filter(c=>c.favorite)); }
function fill(grid,list){ if(list.length===0){grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="e">🗝️</div><p>Nothing here yet.</p></div>';return;} grid.innerHTML=''; list.forEach(c=>grid.appendChild(credCard(c))); }

function renderFolders(){
  const folders=[...new Set(creds.map(c=>c.folder).filter(Boolean))].sort();
  const nav=q('#folderNav'); nav.querySelectorAll('.nav-item').forEach(e=>e.remove());
  folders.forEach(f=>{ const b=document.createElement('button'); b.className='nav-item';
    b.innerHTML=`<span class="ic">📁</span>${esc(f)}<span class="ct">${creds.filter(c=>c.folder===f).length}</span>`;
    b.onclick=()=>{currentFolder=f;showFolder(f);setActiveNav(b);}; nav.appendChild(b); });
  nav.style.display=folders.length?'block':'none';
}
function showFolder(f){ q('#secTitle').textContent=f; q('#secSub').textContent=`Folder · ${creds.filter(c=>c.folder===f).length} items`;
  showSection('folderSec'); fill(q('#folderGrid'),creds.filter(c=>c.folder===f)); }

function credCard(c,flags){
  const el=document.createElement('div'); el.className='cred';
  el.innerHTML=`
    <button class="fav ${c.favorite?'on':''}" data-fav="${c.id}">${c.favorite?'⭐':'☆'}</button>
    <div class="cred-top">
      <div class="avatar" style="${avatarStyle(c.website||c.label)}">${esc(initials(c.label||c.website))}</div>
      <div class="cred-name"><div class="t">${esc(c.label||c.website)}</div><div class="u">${esc(c.username)}</div></div>
    </div>
    ${c.totp_secret?`<div class="totp-chip"><span class="totp-code" data-totp="${esc(c.totp_secret)}" data-id="${c.id}">------</span><svg class="totp-ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" stroke-width="2"/><circle class="tr" data-id="${c.id}" cx="10" cy="10" r="8" fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="50" stroke-linecap="round" transform="rotate(-90 10 10)"/></svg></div>`:''}
    ${(flags&&flags.length)?`<div class="cred-tags">${flags.map(f=>`<span class="tag" style="border-color:var(--warn);color:var(--warn)">${f}</span>`).join('')}</div>`:''}
    ${(c.tags&&c.tags.length)?`<div class="cred-tags">${c.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
    <div class="cred-acts">
      <button class="mini" data-cu="${c.id}">👤 User</button>
      <button class="mini" data-cp="${c.id}">🔑 Pass</button>
      <button class="mini" data-ed="${c.id}">✏️</button>
    </div>`;
  el.querySelector('[data-fav]').onclick=async e=>{e.stopPropagation(); await api('POST',`/credential/${c.id}/favorite`); await refresh();};
  el.querySelector('[data-cu]').onclick=e=>{e.stopPropagation(); copyText(c.username,e.currentTarget);};
  el.querySelector('[data-cp]').onclick=e=>{e.stopPropagation(); copyText(c.password,e.currentTarget);};
  el.querySelector('[data-ed]').onclick=e=>{e.stopPropagation(); openEdit(c);};
  el.onclick=()=>openEdit(c);
  return el;
}

// ── TOTP ─────────────────────────────────────────────────────────────────────
function stopTotpTimers(){ totpTimers.forEach(t=>clearInterval(t)); totpTimers=[]; }
function startTotpTimers(){
  stopTotpTimers();
  const nodes=document.querySelectorAll('[data-totp]'); if(!nodes.length) return;
  const tick=async()=>{ for(const n of nodes){ const r=await api('GET',`/totp?secret=${encodeURIComponent(n.dataset.totp)}`);
    if(r.success){ n.textContent=r.code.slice(0,3)+' '+r.code.slice(3);
      const ring=document.querySelector(`.tr[data-id="${n.dataset.id}"]`);
      if(ring) ring.style.strokeDashoffset=String(50*(1-r.remaining/30)); } } };
  tick(); totpTimers.push(setInterval(tick,1000));
}

// ── Clipboard (browser API + auto-clear) ────────────────────────────────────────
async function copyText(text,btn){
  try{ await navigator.clipboard.writeText(text); }catch{}
  resetLockTimer();
  if(btn){const o=btn.innerHTML;btn.innerHTML='✓ Copied';btn.classList.add('ok');setTimeout(()=>{btn.innerHTML=o;btn.classList.remove('ok');},1400);}
  const secs=settings.clip_clear_secs??20;
  if(secs>0){ setTimeout(()=>navigator.clipboard.writeText(' ').catch(()=>{}),secs*1000); toast(`Copied — clipboard clears in ${secs}s`);}
  else toast('Copied to clipboard');
}

// ── Edit ─────────────────────────────────────────────────────────────────────
function openEdit(c){
  editId=c?c.id:null; editTags=c?[...(c.tags||[])]:[];
  q('#editTitle').textContent=c?'Edit credential':'Add credential';
  q('#eSite').value=c?c.website:''; q('#eLabel').value=c?(c.label||''):'';
  q('#eUser').value=c?c.username:''; q('#ePass').value=c?c.password:'';
  q('#eFolder').value=c?(c.folder||''):''; q('#eTotp').value=c?(c.totp_secret||''):'';
  q('#eNotes').value=c?(c.notes||''):''; q('#editErr').textContent='';
  q('#ePass').type='password'; q('#eTog').textContent='👁';
  renderChips(); updateStr(q('#ePass').value);
  q('#editModal').classList.add('show'); q('#eSite').focus();
}
function renderChips(){ q('#eChips').innerHTML=editTags.map((t,i)=>`<span class="chip">${esc(t)}<button data-ti="${i}">✕</button></span>`).join('');
  q('#eChips').querySelectorAll('[data-ti]').forEach(b=>b.onclick=()=>{editTags.splice(+b.dataset.ti,1);renderChips();}); }
async function saveEdit(){
  const site=q('#eSite').value.trim(),user=q('#eUser').value.trim(),pass=q('#ePass').value;
  if(!site||!user||!pass){q('#editErr').textContent='Website, username and password are required.';return;}
  const totp=q('#eTotp').value.trim();
  if(totp){const t=await api('GET',`/totp?secret=${encodeURIComponent(totp)}`); if(!t.success){q('#editErr').textContent='Invalid 2FA secret (must be base32).';return;}}
  const body={ website:site,username:user,password:pass,label:q('#eLabel').value.trim()||null,
    folder:q('#eFolder').value.trim()||null,tags:editTags,totp_secret:totp||null,notes:q('#eNotes').value.trim()||null,
    favorite: editId?(creds.find(c=>c.id===editId)?.favorite||false):false };
  const r = editId? await api('PUT',`/credential/${editId}`,body) : await api('POST','/credential',body);
  if(r.success){ q('#editModal').classList.remove('show'); await refresh(); toast(editId?'Updated':'Saved'); }
  else q('#editErr').textContent=r.error||'Save failed';
}
async function deleteCurrent(){ if(!editId)return; if(!confirm('Delete this credential permanently?'))return;
  await api('DELETE',`/credential/${editId}`); q('#editModal').classList.remove('show'); await refresh(); toast('Deleted'); }

function strengthOf(pw){let s=0;if(pw.length>=8)s++;if(pw.length>=12)s++;if(/[A-Z]/.test(pw)&&/[a-z]/.test(pw))s++;if(/[0-9]/.test(pw))s++;if(/[^A-Za-z0-9]/.test(pw))s++;return s;}
function updateStr(pw){const s=strengthOf(pw);const c=['','#ff5470','#ffb648','#ffce7a','#3ddc84','#7c5cff'];const l=['','Weak','Fair','Good','Strong','Very strong'];
  q('#eStr').style.cssText=`width:${s*20}%;background:${c[s]||'#ff5470'}`;q('#eStrLbl').textContent=l[s]||'';q('#eStrLbl').style.color=c[s]||'';}

// ── Generator ─────────────────────────────────────────────────────────────────
async function genRun(){ const r=await api('GET',`/generate?length=${q('#genLen').value}&upper=${q('#genUp').checked}&lower=${q('#genLo').checked}&digits=${q('#genDi').checked}&symbols=${q('#genSy').checked}`); q('#genOut').textContent=r.password; }

// ── Spotlight ─────────────────────────────────────────────────────────────────
let spotSel=0,spotList=[];
function openSpot(){q('#spot').classList.add('show');q('#spotIn').value='';q('#spotIn').focus();spotSearch('');}
function closeSpot(){q('#spot').classList.remove('show');}
function spotSearch(term){const t=term.toLowerCase();
  spotList=t?creds.filter(c=>(c.website+c.username+(c.label||'')+(c.tags||[]).join('')).toLowerCase().includes(t)):creds.slice(0,8);
  spotSel=0; const res=q('#spotResults');
  if(spotList.length===0){res.innerHTML='<div class="spot-empty">No matches</div>';return;}
  res.innerHTML=spotList.map((c,i)=>`<div class="spot-item ${i===0?'sel':''}" data-i="${i}"><div class="avatar av" style="${avatarStyle(c.website||c.label)}">${esc(initials(c.label||c.website))}</div><div class="txt"><div class="t">${esc(c.label||c.website)}</div><div class="u">${esc(c.username)}</div></div><div class="hint">↵ copy password</div></div>`).join('');
  res.querySelectorAll('.spot-item').forEach(el=>el.onclick=()=>spotPick(+el.dataset.i));
}
function spotMove(d){spotSel=(spotSel+d+spotList.length)%spotList.length;q('#spotResults').querySelectorAll('.spot-item').forEach((e,i)=>e.classList.toggle('sel',i===spotSel));q('#spotResults').children[spotSel]?.scrollIntoView({block:'nearest'});}
async function spotPick(i){const c=spotList[i];if(!c)return;closeSpot();try{await navigator.clipboard.writeText(c.password);}catch{}const s=settings.clip_clear_secs??20;if(s>0)setTimeout(()=>navigator.clipboard.writeText(' ').catch(()=>{}),s*1000);toast(`🔑 Password for ${c.label||c.website} copied`);}

// ── Settings ─────────────────────────────────────────────────────────────────
async function saveSettings(){ settings={theme:q('#setTheme').value,auto_lock_mins:+q('#setLock').value,clip_clear_secs:+q('#setClip').value};
  await api('POST','/settings',settings); applyTheme(settings.theme); startLockTimer(); }
async function changeMaster(){ const cur=q('#mpCur').value,nw=q('#mpNew').value,cf=q('#mpCf').value; q('#mpErr').textContent='';
  if(!cur||!nw){q('#mpErr').textContent='All fields required.';return;} if(nw!==cf){q('#mpErr').textContent='New passwords do not match.';return;}
  if(nw.length<8){q('#mpErr').textContent='Use at least 8 characters.';return;}
  const r=await api('POST','/change-password',{currentPassword:cur,newPassword:nw});
  if(r.success){['#mpCur','#mpNew','#mpCf'].forEach(s=>q(s).value='');q('#setModal').classList.remove('show');toast('Master password updated');}
  else q('#mpErr').textContent=r.error||'Failed'; }
async function exportVault(){ const r=await api('GET','/export'); if(!r.credentials){toast('Export failed');return;}
  const blob=new Blob([JSON.stringify(r.credentials,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob);
  Object.assign(document.createElement('a'),{href:url,download:`nicofire-backup-${new Date().toISOString().slice(0,10)}.json`}).click();
  URL.revokeObjectURL(url); toast('Exported'); }
async function importVault(e){ const f=e.target.files[0];if(!f)return; try{const data=JSON.parse(await f.text());
  const arr=Array.isArray(data)?data:(data.credentials||[]); const r=await api('POST','/import',{credentials:arr});
  if(r.success){await refresh();toast(`Imported ${r.added} items`);}else toast('Import failed');}catch{toast('Invalid file');} e.target.value=''; }

function showSection(id){document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===id));}
function setActiveNav(el){document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));el.classList.add('active');}
const SEC_META={dashSec:['Dashboard','Your vault at a glance'],allSec:['All Items','Every saved credential'],favSec:['Favorites','Your starred logins']};

function wire(){
  q('#unlockBtn').onclick=tryUnlock; q('#master').onkeydown=e=>{if(e.key==='Enter')tryUnlock();};
  document.querySelectorAll('.nav-item[data-sec]').forEach(b=>b.onclick=()=>{currentFolder=null;showSection(b.dataset.sec);setActiveNav(b);const m=SEC_META[b.dataset.sec];if(m){q('#secTitle').textContent=m[0];q('#secSub').textContent=m[1];}});
  q('#addBtn').onclick=()=>openEdit(null);
  q('#genBtn').onclick=()=>{q('#genModal').classList.add('show');genRun();};
  q('#setBtn').onclick=()=>q('#setModal').classList.add('show');
  q('#lockAppBtn').onclick=doLock;
  q('#editClose').onclick=q('#editCancel').onclick=()=>q('#editModal').classList.remove('show');
  q('#editSave').onclick=saveEdit;
  q('#eTog').onclick=()=>{const i=q('#ePass');i.type=i.type==='password'?'text':'password';q('#eTog').textContent=i.type==='password'?'👁':'🙈';};
  q('#eGen').onclick=async()=>{const r=await api('GET','/generate?length=20');q('#ePass').type='text';q('#ePass').value=r.password;updateStr(r.password);};
  q('#ePass').oninput=()=>updateStr(q('#ePass').value);
  q('#eTagIn').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();const v=e.target.value.trim();if(v&&!editTags.includes(v)){editTags.push(v);renderChips();}e.target.value='';}};
  q('#genClose').onclick=()=>q('#genModal').classList.remove('show');
  q('#genLen').oninput=()=>{q('#genLenV').textContent=q('#genLen').value;genRun();};
  ['genUp','genLo','genDi','genSy'].forEach(id=>q('#'+id).onchange=genRun);
  q('#genRefresh').onclick=genRun;
  q('#genCopy').onclick=async()=>{try{await navigator.clipboard.writeText(q('#genOut').textContent);}catch{}toast('Copied');const s=settings.clip_clear_secs??20;if(s>0)setTimeout(()=>navigator.clipboard.writeText(' ').catch(()=>{}),s*1000);};
  q('#setClose').onclick=()=>q('#setModal').classList.remove('show');
  q('#setTheme').onchange=q('#setLock').onchange=q('#setClip').onchange=saveSettings;
  q('#mpBtn').onclick=changeMaster; q('#expBtn').onclick=exportVault;
  q('#impBtn').onclick=()=>q('#impFile').click(); q('#impFile').onchange=importVault;
  q('#openSpot').onclick=openSpot; q('#spotIn').oninput=e=>spotSearch(e.target.value);
  q('#spotIn').onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();spotMove(1);}else if(e.key==='ArrowUp'){e.preventDefault();spotMove(-1);}else if(e.key==='Enter'){e.preventDefault();spotPick(spotSel);}else if(e.key==='Escape')closeSpot();};
  q('#spot').onclick=e=>{if(e.target===q('#spot'))closeSpot();};
  addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openSpot();}if((e.ctrlKey||e.metaKey)&&e.key==='n'){e.preventDefault();openEdit(null);}if(e.key==='Escape')document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show'));});
  ['click','keydown','mousemove'].forEach(ev=>addEventListener(ev,resetLockTimer,{passive:true}));
  const foot=q('#editModal .modal-foot'); const del=document.createElement('button');
  del.className='btn-ghost';del.textContent='🗑';del.style.flex='0 0 auto';del.onclick=deleteCurrent;
  foot.insertBefore(del,foot.firstChild);
}
function applyTheme(t){document.documentElement.dataset.theme=t;}
function q(s){return document.querySelector(s);}
function esc(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(msg,icon='✓'){const t=q('#toast');t.innerHTML=`<span>${icon}</span>${esc(msg)}`;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),2600);}
