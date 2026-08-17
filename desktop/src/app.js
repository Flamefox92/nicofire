'use strict';
const { invoke } = window.__TAURI__.core;
const { listen  } = window.__TAURI__.event;

// ── State ─────────────────────────────────────────────────────────────────────
let creds = [], editId = null, editTags = [], health = null, settings = {};
let lockSecs = 300, lockTimer = null, currentFolder = null;
let totpTimers = [];

const AVATAR_COLORS = [
  ['#7c5cff','#a98bff'], ['#ff6b2c','#ff8c55'], ['#3ddc84','#5eeaa0'],
  ['#ffb648','#ffce7a'], ['#ff5470','#ff8095'], ['#38bdf8','#7dd3fc'],
  ['#c084fc','#d8b4fe'], ['#fb7185','#fda4af'],
];
function avatarStyle(name){
  let h=0; for(const c of name) h=(h*31+c.charCodeAt(0))>>>0;
  const [a,b]=AVATAR_COLORS[h%AVATAR_COLORS.length];
  return `background:linear-gradient(135deg,${a},${b})`;
}
function initials(s){ return (s||'?').replace(/^https?:\/\//,'').replace(/^www\./,'').substring(0,2).toUpperCase(); }

// ── Boot ──────────────────────────────────────────────────────────────────────
addEventListener('DOMContentLoaded', async () => {
  wire();
  const st = await invoke('get_status');
  q('#lockHint').textContent = st.vaultExists ? 'Enter your master password' : '✨ First run — create your master password';
  if (st.unlocked) await enterApp();
});

async function tryUnlock() {
  const pw = q('#master').value;
  q('#lockErr').textContent = '';
  q('#unlockBtn').textContent = 'Unlocking…';
  const r = await invoke('unlock', { password: pw });
  q('#unlockBtn').textContent = 'Unlock Vault';
  if (r.success) { q('#master').value=''; await enterApp(); }
  else q('#lockErr').textContent = r.error || 'Wrong password';
}

async function enterApp() {
  q('#lock').style.display='none';
  q('#app').classList.add('show');
  settings = await invoke('get_settings');
  applyTheme(settings.theme || 'dark');
  q('#setTheme').value = settings.theme || 'dark';
  q('#setLock').value  = String(settings.auto_lock_mins ?? 5);
  q('#setClip').value  = String(settings.clip_clear_secs ?? 20);
  await refresh();
  startLockTimer();
}

async function refresh() {
  const r = await invoke('get_all');
  creds = r.credentials || [];
  health = await invoke('get_health');
  renderAll();
  renderDashboard();
  renderFolders();
  q('#ctAll').textContent = creds.length;
  q('#ctFav').textContent = creds.filter(c=>c.favorite).length;
  startTotpTimers();
}

// ── Lock timer ─────────────────────────────────────────────────────────────────
function startLockTimer(){
  clearInterval(lockTimer);
  const mins = settings.auto_lock_mins ?? 5;
  if (mins===0){ q('#lockCountdown').textContent='∞'; return; }
  lockSecs = mins*60;
  lockTimer = setInterval(()=>{
    lockSecs=Math.max(0,lockSecs-1);
    q('#lockCountdown').textContent = `${Math.floor(lockSecs/60)}:${String(lockSecs%60).padStart(2,'0')}`;
    if(lockSecs===0) doLock();
  },1000);
}
function resetLockTimer(){ const m=settings.auto_lock_mins??5; if(m>0) lockSecs=m*60; }
async function doLock(){
  clearInterval(lockTimer); stopTotpTimers();
  await invoke('lock');
  q('#app').classList.remove('show');
  q('#lock').style.display='flex';
  q('#master').focus();
}

// ── Render: dashboard ───────────────────────────────────────────────────────────
function renderDashboard(){
  const s = health.score;
  q('#scoreNum').textContent = s;
  const arc=q('#scoreArc'); const circ=327; arc.style.strokeDashoffset = circ-(circ*s/100);
  q('#stTotal').textContent  = health.total;
  q('#stWeak').textContent   = health.weak.length;
  q('#stReused').textContent = health.reused.length;
  q('#stOld').textContent    = health.old.length;

  let title, msg;
  if(health.total===0){ title='Empty vault'; msg='Add your first credential to start building your secure vault.'; }
  else if(s>=85){ title='Excellent 🎉'; msg='Your vault is in great shape. Passwords are strong, unique, and current.'; }
  else if(s>=60){ title='Good, with room to improve'; msg='A few passwords could be stronger or need refreshing. Check the items below.'; }
  else { title='Needs attention'; msg='Several passwords are weak, reused, or old. Updating them will boost your security score.'; }
  q('#healthTitle').textContent=title; q('#healthMsg').textContent=msg;

  const flagged = new Set([...health.weak,...health.reused,...health.old]);
  const issues = creds.filter(c=>flagged.has(c.id));
  const grid=q('#issueGrid');
  if(issues.length===0){ grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="e">✅</div><p>No issues found. Everything looks secure!</p></div>'; }
  else grid.innerHTML=''; issues.forEach(c=>grid.appendChild(credCard(c, flagReason(c))));
}
function flagReason(c){
  const r=[];
  if(health.weak.includes(c.id)) r.push('Weak');
  if(health.reused.includes(c.id)) r.push('Reused');
  if(health.old.includes(c.id)) r.push('Old');
  return r;
}

// ── Render: lists ────────────────────────────────────────────────────────────────
function renderAll(){
  fill(q('#allGrid'), creds);
  fill(q('#favGrid'), creds.filter(c=>c.favorite));
}
function fill(grid, list){
  if(list.length===0){ grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div class="e">🗝️</div><p>Nothing here yet.</p></div>'; return; }
  grid.innerHTML=''; list.forEach(c=>grid.appendChild(credCard(c)));
}
function renderFolders(){
  const folders=[...new Set(creds.map(c=>c.folder).filter(Boolean))].sort();
  const nav=q('#folderNav');
  nav.querySelectorAll('.nav-item').forEach(e=>e.remove());
  folders.forEach(f=>{
    const b=document.createElement('button');
    b.className='nav-item'; b.dataset.folder=f;
    b.innerHTML=`<span class="ic">📁</span>${esc(f)}<span class="ct">${creds.filter(c=>c.folder===f).length}</span>`;
    b.onclick=()=>{ currentFolder=f; showFolder(f); setActiveNav(b); };
    nav.appendChild(b);
  });
  nav.style.display = folders.length? 'block':'none';
}
function showFolder(f){
  q('#secTitle').textContent=f; q('#secSub').textContent=`Folder · ${creds.filter(c=>c.folder===f).length} items`;
  showSection('folderSec');
  fill(q('#folderGrid'), creds.filter(c=>c.folder===f));
}

// ── Credential card ──────────────────────────────────────────────────────────────
function credCard(c, flags){
  const el=document.createElement('div');
  el.className='cred';
  const fav = c.favorite?'on':'';
  el.innerHTML=`
    <button class="fav ${fav}" data-fav="${attr(c.id)}">${c.favorite?'⭐':'☆'}</button>
    <div class="cred-top">
      <div class="avatar" style="${avatarStyle(c.website||c.label||'?')}">${esc(initials(c.label||c.website))}</div>
      <div class="cred-name"><div class="t">${esc(c.label||c.website)}</div><div class="u">${esc(c.username)}</div></div>
    </div>
    ${c.totp_secret?`<div class="totp-chip"><span class="totp-code" data-totp="${esc(c.totp_secret)}" data-id="${attr(c.id)}">------</span><svg class="totp-ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" stroke-width="2"/><circle class="tr" data-id="${attr(c.id)}" cx="10" cy="10" r="8" fill="none" stroke="var(--ember)" stroke-width="2" stroke-dasharray="50" stroke-linecap="round" transform="rotate(-90 10 10)"/></svg></div>`:''}
    ${(flags&&flags.length)?`<div class="cred-tags">${flags.map(f=>`<span class="tag" style="border-color:var(--warn);color:var(--warn)">${esc(f)}</span>`).join('')}</div>`:''}
    ${(c.tags&&c.tags.length)?`<div class="cred-tags">${c.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
    <div class="cred-acts">
      <button class="mini" data-cu="${attr(c.id)}">👤 User</button>
      <button class="mini" data-cp="${attr(c.id)}">🔑 Pass</button>
      <button class="mini" data-ed="${attr(c.id)}">✏️</button>
    </div>`;
  el.querySelector('[data-fav]').onclick=async e=>{ e.stopPropagation(); await invoke('toggle_favorite',{id:c.id}); await refresh(); };
  el.querySelector('[data-cu]').onclick=e=>{ e.stopPropagation(); copyText(c.username, e.currentTarget); };
  el.querySelector('[data-cp]').onclick=e=>{ e.stopPropagation(); copyText(c.password, e.currentTarget); };
  el.querySelector('[data-ed]').onclick=e=>{ e.stopPropagation(); openEdit(c); };
  el.onclick=()=>openEdit(c);
  return el;
}

// ── TOTP live update ─────────────────────────────────────────────────────────────
function stopTotpTimers(){ totpTimers.forEach(t=>clearInterval(t)); totpTimers=[]; }
function startTotpTimers(){
  stopTotpTimers();
  const nodes=document.querySelectorAll('[data-totp]');
  if(!nodes.length) return;
  const tick=async()=>{
    for(const n of nodes){
      const r=await invoke('get_totp',{secret:n.dataset.totp});
      if(r.success){
        n.textContent = r.code.slice(0,3)+' '+r.code.slice(3);
        const ring=document.querySelector(`.tr[data-id="${n.dataset.id}"]`);
        if(ring){ const frac=r.remaining/30; ring.style.strokeDashoffset=String(50*(1-frac)); }
      }
    }
  };
  tick();
  totpTimers.push(setInterval(tick,1000));
}

// ── Copy with auto-clear ─────────────────────────────────────────────────────────
async function copyText(text, btn){
  await invoke('copy_clipboard',{text});
  resetLockTimer();
  if(btn){ const o=btn.innerHTML; btn.innerHTML='✓ Copied'; btn.classList.add('ok');
    setTimeout(()=>{btn.innerHTML=o;btn.classList.remove('ok');},1400); }
  const secs = settings.clip_clear_secs ?? 20;
  if(secs>0){ setTimeout(()=>invoke('clear_clipboard'), secs*1000); toast(`Copied — clipboard clears in ${secs}s`); }
  else toast('Copied to clipboard');
}

// ── Edit modal ───────────────────────────────────────────────────────────────────
function openEdit(c){
  editId = c?c.id:null;
  editTags = c?[...(c.tags||[])]:[];
  q('#editTitle').textContent = c?'Edit credential':'Add credential';
  q('#eSite').value  = c?c.website:'';
  q('#eLabel').value = c?(c.label||''):'';
  q('#eUser').value  = c?c.username:'';
  q('#ePass').value  = c?c.password:'';
  q('#eFolder').value= c?(c.folder||''):'';
  q('#eTotp').value  = c?(c.totp_secret||''):'';
  q('#eNotes').value = c?(c.notes||''):'';
  q('#editErr').textContent='';
  q('#ePass').type='password'; q('#eTog').textContent='👁';
  renderChips(); updateStr(q('#ePass').value);
  q('#editModal').classList.add('show');
  q('#eSite').focus();
}
function renderChips(){
  q('#eChips').innerHTML = editTags.map((t,i)=>`<span class="chip">${esc(t)}<button data-ti="${i}">✕</button></span>`).join('');
  q('#eChips').querySelectorAll('[data-ti]').forEach(b=>b.onclick=()=>{editTags.splice(+b.dataset.ti,1);renderChips();});
}
async function saveEdit(){
  const site=q('#eSite').value.trim(), user=q('#eUser').value.trim(), pass=q('#ePass').value;
  if(!site||!user||!pass){ q('#editErr').textContent='Website, username and password are required.'; return; }
  const totp=q('#eTotp').value.trim();
  if(totp){ const t=await invoke('get_totp',{secret:totp}); if(!t.success){ q('#editErr').textContent='Invalid 2FA secret (must be base32).'; return; } }
  const cred={ id:editId||'', website:site, username:user, password:pass,
    label:q('#eLabel').value.trim(), folder:q('#eFolder').value.trim(),
    tags:editTags, totp_secret:totp, notes:q('#eNotes').value.trim(),
    favorite: editId? (creds.find(c=>c.id===editId)?.favorite||false):false };
  const r = editId? await invoke('update_credential',{cred}) : await invoke('save_credential',{cred});
  if(r.success){ q('#editModal').classList.remove('show'); await refresh(); toast(editId?'Updated':'Saved'); }
  else q('#editErr').textContent=r.error||'Save failed';
}
async function deleteCurrent(){
  if(!editId) return;
  if(!confirm('Delete this credential permanently?')) return;
  await invoke('delete_credential',{id:editId});
  q('#editModal').classList.remove('show'); await refresh(); toast('Deleted');
}

// ── Password strength ────────────────────────────────────────────────────────────
function strengthOf(pw){
  let s=0; if(pw.length>=8)s++; if(pw.length>=12)s++;
  if(/[A-Z]/.test(pw)&&/[a-z]/.test(pw))s++; if(/[0-9]/.test(pw))s++; if(/[^A-Za-z0-9]/.test(pw))s++;
  return s;
}
function updateStr(pw){
  const s=strengthOf(pw);
  const cols=['','#ff5470','#ffb648','#ffce7a','#3ddc84','#7c5cff'];
  const lbls=['','Weak','Fair','Good','Strong','Very strong'];
  q('#eStr').style.cssText=`width:${s*20}%;background:${cols[s]||'#ff5470'}`;
  q('#eStrLbl').textContent=lbls[s]||''; q('#eStrLbl').style.color=cols[s]||'';
}

// ── Generator ────────────────────────────────────────────────────────────────────
async function genRun(){
  const r=await invoke('gen_password',{
    length:+q('#genLen').value, upper:q('#genUp').checked, lower:q('#genLo').checked,
    digits:q('#genDi').checked, symbols:q('#genSy').checked });
  q('#genOut').textContent=r.password;
}

// ── Spotlight ────────────────────────────────────────────────────────────────────
let spotSel=0, spotList=[];
function openSpot(){ q('#spot').classList.add('show'); q('#spotIn').value=''; q('#spotIn').focus(); spotSearch(''); }
function closeSpot(){ q('#spot').classList.remove('show'); }
function spotSearch(term){
  const t=term.toLowerCase();
  spotList = t? creds.filter(c=>(c.website+c.username+(c.label||'')+(c.tags||[]).join('')).toLowerCase().includes(t)) : creds.slice(0,8);
  spotSel=0;
  const res=q('#spotResults');
  if(spotList.length===0){ res.innerHTML='<div class="spot-empty">No matches</div>'; return; }
  res.innerHTML=spotList.map((c,i)=>`
    <div class="spot-item ${i===0?'sel':''}" data-i="${i}">
      <div class="avatar av" style="${avatarStyle(c.website||c.label)}">${esc(initials(c.label||c.website))}</div>
      <div class="txt"><div class="t">${esc(c.label||c.website)}</div><div class="u">${esc(c.username)}</div></div>
      <div class="hint">↵ copy password</div>
    </div>`).join('');
  res.querySelectorAll('.spot-item').forEach(el=>{
    el.onclick=()=>spotPick(+el.dataset.i);
  });
}
function spotMove(d){
  spotSel=(spotSel+d+spotList.length)%spotList.length;
  q('#spotResults').querySelectorAll('.spot-item').forEach((e,i)=>e.classList.toggle('sel',i===spotSel));
  q('#spotResults').children[spotSel]?.scrollIntoView({block:'nearest'});
}
async function spotPick(i){
  const c=spotList[i]; if(!c) return;
  closeSpot();
  await invoke('copy_clipboard',{text:c.password});
  const secs=settings.clip_clear_secs??20;
  if(secs>0) setTimeout(()=>invoke('clear_clipboard'),secs*1000);
  toast(`🔑 Password for ${c.label||c.website} copied`);
}

// ── Settings actions ─────────────────────────────────────────────────────────────
async function saveSettings(){
  settings={ theme:q('#setTheme').value, auto_lock_mins:+q('#setLock').value, clip_clear_secs:+q('#setClip').value };
  await invoke('set_settings',{settings});
  applyTheme(settings.theme); startLockTimer();
}
async function changeMaster(){
  const cur=q('#mpCur').value,nw=q('#mpNew').value,cf=q('#mpCf').value;
  q('#mpErr').textContent='';
  if(!cur||!nw){ q('#mpErr').textContent='All fields required.'; return; }
  if(nw!==cf){ q('#mpErr').textContent='New passwords do not match.'; return; }
  if(nw.length<8){ q('#mpErr').textContent='Use at least 8 characters.'; return; }
  const r=await invoke('change_password',{current:cur,new:nw});
  if(r.success){ ['#mpCur','#mpNew','#mpCf'].forEach(s=>q(s).value=''); q('#setModal').classList.remove('show'); toast('Master password updated'); }
  else q('#mpErr').textContent=r.error||'Failed';
}
async function exportEncrypted(){
  const pass = prompt("Choose a passphrase for this encrypted backup (min 8 characters).\nYou will need it to restore. It is separate from your master password.");
  if(pass===null) return;
  if(pass.length<8){ toast("Passphrase too short (min 8)"); return; }
  const r = await invoke('export_encrypted',{passphrase:pass});
  if(!r.success){ toast(r.error||'Export failed'); return; }
  const blob=new Blob([r.blob],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:`nicofire-encrypted-backup-${new Date().toISOString().slice(0,10)}.ncf`});
  a.click(); URL.revokeObjectURL(url);
  toast('🔒 Encrypted backup saved');
}
async function importEncrypted(e){
  const f=e.target.files[0]; if(!f) return;
  const pass=prompt("Enter the passphrase for this encrypted backup:");
  if(pass===null){ e.target.value=''; return; }
  try{
    const blob=await f.text();
    const r=await invoke('import_encrypted',{blob,passphrase:pass});
    if(r.success){ await refresh(); toast(`🔓 Restored ${r.added} items`); }
    else toast(r.error||'Restore failed');
  }catch(err){ toast('Could not read file'); }
  e.target.value='';
}
async function exportVault(){
  if(!confirm("⚠ WARNING: Plain JSON export is NOT encrypted.\nAnyone who opens the file can read every password.\n\nUse 'Encrypted backup' instead unless you are sure.\n\nContinue with unencrypted export?")) return;
  const r=await invoke('export_vault');
  if(!r.success){ toast('Export failed'); return; }
  const blob=new Blob([JSON.stringify(r.credentials,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=Object.assign(document.createElement('a'),{href:url,download:`nicofire-backup-${new Date().toISOString().slice(0,10)}.json`});
  a.click(); URL.revokeObjectURL(url); toast('Exported');
}
async function importVault(e){
  const f=e.target.files[0]; if(!f) return;
  try{
    const data=JSON.parse(await f.text());
    const arr=Array.isArray(data)?data:(data.credentials||[]);
    const r=await invoke('import_vault',{credentials:arr});
    if(r.success){ await refresh(); toast(`Imported ${r.added} items`); }
    else toast('Import failed');
  }catch(err){ toast('Invalid file'); }
  e.target.value='';
}

// ── Navigation ────────────────────────────────────────────────────────────────────
function showSection(id){ document.querySelectorAll('.section').forEach(s=>s.classList.toggle('active',s.id===id)); }
function setActiveNav(el){ document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); el.classList.add('active'); }
const SEC_META={ dashSec:['Dashboard','Your vault at a glance'], allSec:['All Items','Every saved credential'], favSec:['Favorites','Your starred logins'] };

// ── Wire everything ────────────────────────────────────────────────────────────────
function wire(){
  q('#unlockBtn').onclick=tryUnlock;
  q('#master').onkeydown=e=>{ if(e.key==='Enter') tryUnlock(); };

  document.querySelectorAll('.nav-item[data-sec]').forEach(b=>b.onclick=()=>{
    currentFolder=null; showSection(b.dataset.sec); setActiveNav(b);
    const m=SEC_META[b.dataset.sec]; if(m){ q('#secTitle').textContent=m[0]; q('#secSub').textContent=m[1]; }
  });

  q('#addBtn').onclick=()=>openEdit(null);
  q('#genBtn').onclick=()=>{ q('#genModal').classList.add('show'); genRun(); };
  q('#setBtn').onclick=()=>q('#setModal').classList.add('show');
  q('#lockAppBtn').onclick=doLock;

  // Edit modal
  q('#editClose').onclick=q('#editCancel').onclick=()=>q('#editModal').classList.remove('show');
  q('#editSave').onclick=saveEdit;
  q('#eTog').onclick=()=>{ const i=q('#ePass'); i.type=i.type==='password'?'text':'password'; q('#eTog').textContent=i.type==='password'?'👁':'🙈'; };
  q('#eGen').onclick=async()=>{ const r=await invoke('gen_password',{length:20,upper:true,lower:true,digits:true,symbols:true}); q('#ePass').type='text'; q('#ePass').value=r.password; updateStr(r.password); };
  q('#ePass').oninput=()=>updateStr(q('#ePass').value);
  q('#eTagIn').onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); const v=e.target.value.trim(); if(v&&!editTags.includes(v)){editTags.push(v);renderChips();} e.target.value=''; } };

  // Delete button injected into edit footer when editing
  q('#editModal').addEventListener('show', ()=>{});

  // Generator modal
  q('#genClose').onclick=()=>q('#genModal').classList.remove('show');
  q('#genLen').oninput=()=>{ q('#genLenV').textContent=q('#genLen').value; genRun(); };
  ['genUp','genLo','genDi','genSy'].forEach(id=>q('#'+id).onchange=genRun);
  q('#genRefresh').onclick=genRun;
  q('#genCopy').onclick=async()=>{ await invoke('copy_clipboard',{text:q('#genOut').textContent}); toast('Copied'); const s=settings.clip_clear_secs??20; if(s>0) setTimeout(()=>invoke('clear_clipboard'),s*1000); };

  // Settings modal
  q('#setClose').onclick=()=>q('#setModal').classList.remove('show');
  q('#setTheme').onchange=q('#setLock').onchange=q('#setClip').onchange=saveSettings;
  q('#mpBtn').onclick=changeMaster;
  q('#expBtn').onclick=exportVault;
  q('#impBtn').onclick=()=>q('#impFile').click();
  q('#impFile').onchange=importVault;
  q('#expEncBtn').onclick=exportEncrypted;
  q('#impEncBtn').onclick=()=>q('#impEncFile').click();
  q('#impEncFile').onchange=importEncrypted;

  // Spotlight
  q('#openSpot').onclick=openSpot;
  q('#spotIn').oninput=e=>spotSearch(e.target.value);
  q('#spotIn').onkeydown=e=>{
    if(e.key==='ArrowDown'){e.preventDefault();spotMove(1);}
    else if(e.key==='ArrowUp'){e.preventDefault();spotMove(-1);}
    else if(e.key==='Enter'){e.preventDefault();spotPick(spotSel);}
    else if(e.key==='Escape') closeSpot();
  };
  q('#spot').onclick=e=>{ if(e.target===q('#spot')) closeSpot(); };

  // Global shortcuts
  addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key==='k'){ e.preventDefault(); openSpot(); }
    if((e.ctrlKey||e.metaKey)&&e.key==='n'){ e.preventDefault(); openEdit(null); }
    if(e.key==='Escape'){ document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show')); }
  });
  // reset lock timer on activity
  ['click','keydown','mousemove'].forEach(ev=>addEventListener(ev,resetLockTimer,{passive:true}));

  listen('locked',()=>doLock());

  // Add delete button to edit modal footer dynamically
  const foot=q('#editModal .modal-foot');
  const del=document.createElement('button');
  del.className='btn-ghost'; del.id='editDelete'; del.textContent='🗑'; del.style.flex='0 0 auto';
  del.onclick=deleteCurrent;
  foot.insertBefore(del, foot.firstChild);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function applyTheme(t){ document.documentElement.dataset.theme=t; }
function q(s){ return document.querySelector(s); }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Attribute-safe: strips anything not in a safe id/charset. Used for values placed in HTML attributes.
function attr(s){ return String(s??'').replace(/[^a-zA-Z0-9_\-]/g,''); }
function toast(msg,icon='✓'){ const t=q('#toast'); t.innerHTML=`<span>${icon}</span>${esc(msg)}`; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),2600); }
