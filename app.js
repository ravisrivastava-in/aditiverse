/**
 * AditiVerse — app.js
 * Auth: Firebase (dedicated aditiverse-gallary project).
 * Backend: a single dedicated Worker at api.aditiverse.in — handles both
 * the management API (list/upload/delete/...) and public file serving
 * (GET/HEAD on any other path). See aditiverse-api-worker.js.
 * Endpoints used:
 *   GET  /list                         -> { items:[{path,type,size,sha,cdnUrl}] }
 *   POST /upload        (FormData)     -> file[, folder, duplicateMode, newName]
 *   POST /upload-url     (json)        -> {url[, folder, duplicateMode, newName]}
 *   POST /delete          {path}
 *   POST /delete-batch    {paths}
 *   POST /folder/delete   {path}
 *   POST /rename          {oldPath,newPath}
 *   POST /folder/rename   {oldPath,newPath}
 *   POST /folder/create   {path}
 *   POST /move            {items,destFolder}
 *   POST /copy            {items,destFolder}
 *   GET  /download?path=
 *
 * Notes on honesty about scope:
 *  - The backend has no per-file upload timestamp, so Home is a flat,
 *    sorted grid rather than fake "month" sections with invented dates.
 *  - There's no share-link/password/expiry backend, so Share copies the
 *    direct CDN link(s) / opens the device share sheet instead of a
 *    fictitious password-protected link.
 *  - There's no soft-delete, so Delete is a real, permanent action with
 *    a clear confirmation — no make-believe 30-day Trash.
 *  - Favorites are stored locally (per browser) since there's no
 *    favorite flag in the backend schema.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getAnalytics, isSupported as analyticsSupported } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js';

const FB = {apiKey:"AIzaSyCX2t3rdm_H-W3oemVldyLy6RDK2q9qqXE",authDomain:"aditiverse-gallary.firebaseapp.com",projectId:"aditiverse-gallary",storageBucket:"aditiverse-gallary.firebasestorage.app",messagingSenderId:"634381829802",appId:"1:634381829802:web:96494e89440e65646072d3",measurementId:"G-66LD4MR0PF"};
const WORKER_URL = 'https://api.aditiverse.in';
const CONFIG = { CDN_BASE: 'https://api.aditiverse.in/' };
// Public files are served from the same domain's root by the merged
// Worker's file-serving fallback — no folder prefix in the public URL.
const IMG_RE   = /\.(jpe?g|png|gif|webp|svg|avif|bmp|ico|tiff?)$/i;
const VID_RE   = /\.(mp4|mov|webm|mkv|avi|m4v)$/i;
const FAV_KEY  = 'aditiverse_favs';

const app  = getApps().length ? getApps()[0] : initializeApp(FB);
const auth = getAuth(app);
// Analytics is optional and only loads in supported contexts (e.g. not in some in-app browsers) — never blocks auth/gallery.
analyticsSupported().then(ok=>{ if(ok){ try{ getAnalytics(app); }catch{} } }).catch(()=>{});

const $ = id => document.getElementById(id);
const show = el => el && (el.style.display = '');
const hide = el => el && (el.style.display = 'none');

/* ── Helpers ── */
function itemUrl(item){ return CONFIG.CDN_BASE + item.path; }
function basename(p){ const parts=p.split('/'); return parts[parts.length-1]; }
function dirname(p){ const parts=p.split('/'); parts.pop(); return parts.join('/'); }
function joinRel(...segs){ return segs.map(s=>String(s||'').replace(/^\/+|\/+$/g,'')).filter(Boolean).join('/'); }
function fmtBytes(b){ if(!b) return '0 B'; const u=['B','KB','MB','GB']; const i=Math.floor(Math.log(b)/Math.log(1024)); return `${(b/Math.pow(1024,i)).toFixed(1)} ${u[i]}`; }
function isImage(path){ return IMG_RE.test(path); }
function isVideo(path){ return VID_RE.test(path); }
function kindOf(path){ return isImage(path) ? 'image' : isVideo(path) ? 'video' : 'file'; }
function extLabel(path){ const m = path.split('?')[0].match(/\.([^.]+)$/); return m ? m[1].toUpperCase() : 'FILE'; }

let _tt;
function toast(msg, type=''){
  const el = $('toast');
  el.textContent = msg; el.className = `toast${type?' '+type:''}`;
  clearTimeout(_tt);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
  _tt = setTimeout(()=>el.classList.remove('show'), 2600);
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); toast('Copied to clipboard','ok'); }
  catch{ toast('Could not copy','err'); }
}

function loadFavs(){ try{ return new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]')); }catch{ return new Set(); } }
function saveFavs(set){ try{ localStorage.setItem(FAV_KEY, JSON.stringify([...set])); }catch{} }
let favs = loadFavs();
function isFav(path){ return favs.has(path); }
function toggleFav(path){
  if(favs.has(path)) favs.delete(path); else favs.add(path);
  saveFavs(favs);
}

/* ══════════════════════ AUTH ══════════════════════ */
$('loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  $('authErr').classList.remove('show');
  const email = $('authEmail').value.trim();
  const pass  = $('authPass').value;
  $('authBtn').disabled = true;
  hide($('authBtnLabel')); show($('authSpinner'));
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(ex){
    $('authErrMsg').textContent = 'Invalid email or password.';
    $('authErr').classList.add('show');
    $('authBtn').disabled = false;
    show($('authBtnLabel')); hide($('authSpinner'));
  }
});
$('signOutBtn').addEventListener('click', ()=> signOut(auth));

onAuthStateChanged(auth, user=>{
  if(user){
    hide($('authView')); show($('appView')); $('appView').style.display='flex';
    $('profileEmail').textContent = user.email || 'Signed in';
    boot();
  }else{
    show($('authView')); $('authView').style.display='flex';
    hide($('appView'));
    $('authBtn').disabled=false; show($('authBtnLabel')); hide($('authSpinner'));
  }
});

/* ══════════════════════ STATE ══════════════════════ */
let allItems = [];        // flat items from /list
let currentFolder = '';   // Home scope
let homeFilter = 'all';
let searchFilter = { type:'all', size:'all', folder:'__all', sort:'name-asc' };
let searchQuery = '';
let selectMode = false;
let selected = new Set();
let currentGridSource = []; // paths in the order last rendered, for viewer nav
let viewerIndex = 0;
let booted = false;

function foldersIn(folder){ return allItems.filter(i=>i.type==='folder' && dirname(i.path)===folder); }
function filesIn(folder){ return allItems.filter(i=>i.type==='file' && dirname(i.path)===folder); }
function allFolders(){ return allItems.filter(i=>i.type==='folder'); }
function allFiles(){ return allItems.filter(i=>i.type==='file'); }
function findItem(path){ return allItems.find(i=>i.path===path); }

/* ══════════════════════ LOAD ══════════════════════ */
async function loadFiles(){
  show($('homeLoading')); hide($('homeError')); hide($('homeEmpty')); hide($('homeGrid'));
  try{
    const res = await fetch(`${WORKER_URL}/list`, {cache:'no-store'});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    allItems = data.items || [];
    hide($('homeLoading'));
    populateFolderSelects();
    renderHome();
    renderAlbums();
    renderStorageSummary();
  }catch(e){
    hide($('homeLoading'));
    $('homeErrorMsg').textContent = e.message;
    show($('homeError'));
  }
}
$('homeRetryBtn').addEventListener('click', loadFiles);

function populateFolderSelects(){
  const folders = allFolders().map(f=>f.path).sort();
  const searchSel = $('searchFolderSelect');
  const uploadSel = $('uploadDestSelect');
  searchSel.innerHTML = '<option value="__all">All albums</option>';
  uploadSel.innerHTML = '<option value="">Home (root)</option>';
  for(const p of folders){
    const o1 = document.createElement('option'); o1.value=p; o1.textContent='/'+p; searchSel.appendChild(o1);
    const o2 = document.createElement('option'); o2.value=p; o2.textContent='/'+p; uploadSel.appendChild(o2);
  }
}

/* ══════════════════════ TILE BUILDING ══════════════════════ */
function buildTile(item){
  const tile = document.createElement('div');
  tile.className = 'tile' + (selectMode ? ' selectable' : '');
  tile.dataset.path = item.path;

  const kind = kindOf(item.path);
  if(kind === 'image'){
    const img = document.createElement('img');
    img.src = itemUrl(item); img.loading = 'lazy'; img.alt = basename(item.path);
    tile.appendChild(img);
  } else if(kind === 'video'){
    const wrap = document.createElement('div'); wrap.className='tile-file';
    wrap.innerHTML = `<i class="bi bi-play-circle-fill"></i><span>${extLabel(item.path)}</span>`;
    tile.appendChild(wrap);
    const b = document.createElement('span'); b.className='tile-badge'; b.textContent='VIDEO';
    tile.appendChild(b);
  } else {
    const wrap = document.createElement('div'); wrap.className='tile-file';
    wrap.innerHTML = `<i class="bi bi-file-earmark-fill"></i><span>${extLabel(item.path)}</span>`;
    tile.appendChild(wrap);
  }

  if(isFav(item.path)){
    const f = document.createElement('i'); f.className='bi bi-heart-fill tile-fav'; tile.appendChild(f);
  }

  const chk = document.createElement('div'); chk.className='tile-check';
  chk.innerHTML = `<i class="bi ${selected.has(item.path)?'bi-check-circle-fill':'bi-circle'}"></i>`;
  tile.appendChild(chk);
  if(selected.has(item.path)) tile.classList.add('selected');

  attachTileEvents(tile, item);
  return tile;
}

function attachTileEvents(tile, item){
  let pressTimer = null, longPressed = false;
  const start = (e)=>{
    longPressed = false;
    pressTimer = setTimeout(()=>{
      longPressed = true;
      if(!selectMode) enterSelectMode();
      toggleSelection(item.path);
    }, 480);
  };
  const cancel = ()=>{ clearTimeout(pressTimer); };
  tile.addEventListener('pointerdown', start);
  tile.addEventListener('pointerup', cancel);
  tile.addEventListener('pointerleave', cancel);
  tile.addEventListener('pointercancel', cancel);
  tile.addEventListener('click', ()=>{
    if(longPressed){ longPressed=false; return; }
    if(selectMode){ toggleSelection(item.path); return; }
    openViewerFor(item.path, currentGridSource);
  });
}

/* ══════════════════════ SELECTION ══════════════════════ */
function enterSelectMode(){
  selectMode = true;
  $('bottomnav').style.display='none';
  hide($('topbar')); show($('selbar')); $('selbar').style.display='flex';
  $('fab').style.display='none';
  $('seltoolbar').classList.add('show');
  renderActiveView();
}
function exitSelectMode(){
  selectMode = false; selected.clear();
  $('bottomnav').style.display='flex';
  show($('topbar')); $('topbar').style.display='flex'; hide($('selbar'));
  $('fab').style.display='flex';
  $('seltoolbar').classList.remove('show');
  renderActiveView();
}
function toggleSelection(path){
  if(selected.has(path)) selected.delete(path); else selected.add(path);
  $('selCountLabel').textContent = `${selected.size} selected`;
  if(selected.size===0){ exitSelectMode(); return; }
  refreshSelectionVisuals();
}
function refreshSelectionVisuals(){
  document.querySelectorAll('[data-path]').forEach(el=>{
    const on = selected.has(el.dataset.path);
    el.classList.toggle('selected', on);
    const icon = el.querySelector('.tile-check i');
    if(icon) icon.className = 'bi ' + (on ? 'bi-check-circle-fill' : 'bi-circle');
  });
}
$('selCancelBtn').addEventListener('click', exitSelectMode);
$('selAllBtn').addEventListener('click', ()=>{
  currentGridSource.forEach(p=>selected.add(p));
  $('selCountLabel').textContent = `${selected.size} selected`;
  refreshSelectionVisuals();
});

/* ══════════════════════ VIEW SWITCHING ══════════════════════ */
function activeViewName(){ return document.querySelector('.view.active').id.replace('view-',''); }
function renderActiveView(){
  const v = activeViewName();
  if(v==='home') renderHome();
  else if(v==='search') renderSearch();
  else if(v==='favorites') renderFavorites();
  else if(v==='albums') renderAlbums();
}
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    $('view-'+btn.dataset.view).classList.add('active');
    if(selectMode) exitSelectMode();
    renderCrumb();
    renderActiveView();
    window.scrollTo(0,0);
  });
});
$('topSearchBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active', 'search'));
  document.querySelector('.nav-btn[data-view="search"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-search').classList.add('active');
  renderCrumb();
  $('searchInput').focus();
});

function renderCrumb(){
  const el = $('crumbwrap');
  el.innerHTML = '';
  if(activeViewName()!=='home' || !currentFolder){ return; }
  const root = document.createElement('button'); root.className='crumb'; root.innerHTML='<i class="bi bi-house"></i> Home';
  root.addEventListener('click', ()=>{ currentFolder=''; renderCrumb(); renderHome(); });
  el.appendChild(root);
  const parts = currentFolder.split('/'); let acc='';
  parts.forEach((p,i)=>{
    acc = acc ? acc+'/'+p : p;
    const sep=document.createElement('span'); sep.className='crumb-sep'; sep.textContent='›'; el.appendChild(sep);
    const b=document.createElement('button'); b.className='crumb'+(i===parts.length-1?' current':''); b.textContent=p;
    const target=acc;
    if(i!==parts.length-1) b.addEventListener('click', ()=>{ currentFolder=target; renderCrumb(); renderHome(); });
    el.appendChild(b);
  });
}

/* ══════════════════════ HOME ══════════════════════ */
document.querySelectorAll('#filterChips .chip').forEach(chip=>{
  chip.addEventListener('click', ()=>{
    document.querySelectorAll('#filterChips .chip').forEach(c=>c.classList.remove('active'));
    chip.classList.add('active');
    homeFilter = chip.dataset.filter;
    renderHome();
  });
});
function renderHome(){
  if(!allItems.length && !$('homeError').style.display) { /* still loading or errored */ }
  const grid = $('homeGrid'); grid.innerHTML='';
  let files = filesIn(currentFolder);
  if(homeFilter!=='all') files = files.filter(f=>kindOf(f.path)===homeFilter);
  files = [...files].sort((a,b)=>basename(a.path).localeCompare(basename(b.path)));
  currentGridSource = files.map(f=>f.path);

  if(!allItems.length){ return; } // loading/error states own the screen
  if(files.length===0 && foldersIn(currentFolder).length===0){
    show($('homeEmpty')); hide($('homeGrid'));
  } else {
    hide($('homeEmpty')); show($('homeGrid'));
    for(const f of files) grid.appendChild(buildTile(f));
  }
  renderCrumb();
}

/* ══════════════════════ SEARCH ══════════════════════ */
$('searchInput').addEventListener('input', ()=>{
  searchQuery = $('searchInput').value.trim().toLowerCase();
  $('searchClearBtn').style.display = searchQuery ? '' : 'none';
  renderSearch();
});
$('searchClearBtn').addEventListener('click', ()=>{ $('searchInput').value=''; searchQuery=''; hide($('searchClearBtn')); renderSearch(); });
document.querySelectorAll('[data-ftype]').forEach(c=>c.addEventListener('click', ()=>{
  document.querySelectorAll('[data-ftype]').forEach(x=>x.classList.remove('active')); c.classList.add('active');
  searchFilter.type = c.dataset.ftype; renderSearch();
}));
document.querySelectorAll('[data-fsize]').forEach(c=>c.addEventListener('click', ()=>{
  document.querySelectorAll('[data-fsize]').forEach(x=>x.classList.remove('active')); c.classList.add('active');
  searchFilter.size = c.dataset.fsize; renderSearch();
}));
$('searchFolderSelect').addEventListener('change', e=>{ searchFilter.folder = e.target.value; renderSearch(); });
$('sortSelect').addEventListener('change', e=>{ searchFilter.sort = e.target.value; renderSearch(); });

function renderSearch(){
  let files = allFiles();
  if(searchFilter.folder !== '__all') files = files.filter(f=>dirname(f.path)===searchFilter.folder);
  if(searchFilter.type !== 'all') files = files.filter(f=>kindOf(f.path)===searchFilter.type);
  if(searchFilter.size !== 'all'){
    files = files.filter(f=>{
      const mb = (f.size||0)/1048576;
      if(searchFilter.size==='s') return mb < 1;
      if(searchFilter.size==='m') return mb >= 1 && mb <= 10;
      if(searchFilter.size==='l') return mb > 10;
      return true;
    });
  }
  if(searchQuery) files = files.filter(f=>basename(f.path).toLowerCase().includes(searchQuery));

  files = [...files].sort((a,b)=>{
    if(searchFilter.sort==='name-asc') return basename(a.path).localeCompare(basename(b.path));
    if(searchFilter.sort==='name-desc') return basename(b.path).localeCompare(basename(a.path));
    if(searchFilter.sort==='size-desc') return (b.size||0)-(a.size||0);
    if(searchFilter.sort==='size-asc') return (a.size||0)-(b.size||0);
    return 0;
  });

  $('searchCount').textContent = `${files.length} result${files.length===1?'':'s'}`;
  const grid = $('searchGrid'); grid.innerHTML='';
  currentGridSource = files.map(f=>f.path);
  for(const f of files) grid.appendChild(buildTile(f));
}

/* ══════════════════════ ALBUMS ══════════════════════ */
function renderAlbums(){
  const grid = $('albumGrid'); grid.innerHTML='';
  const folders = allFolders();
  if(folders.length===0){ show($('albumsEmpty')); } else { hide($('albumsEmpty')); }
  for(const folder of folders){
    const items = filesIn(folder.path).filter(f=>isImage(f.path)).slice(0,2);
    const card = document.createElement('div'); card.className='album-card';
    const cover = document.createElement('div'); cover.className='album-cover' + (items.length<=1?' single':'');
    if(items.length===0){
      cover.innerHTML = `<div class="album-cover-empty"><i class="bi bi-folder2"></i></div>`;
    } else {
      for(const it of items){ const img=document.createElement('img'); img.src=itemUrl(it); img.loading='lazy'; cover.appendChild(img); }
    }
    const meta = document.createElement('div'); meta.className='album-meta';
    const count = filesIn(folder.path).length;
    meta.innerHTML = `<div class="album-name">${basename(folder.path)}</div><div class="album-count">${count} item${count===1?'':'s'}</div>`;
    card.appendChild(cover); card.appendChild(meta);
    card.addEventListener('click', ()=>{
      currentFolder = folder.path;
      document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
      document.querySelector('.nav-btn[data-view="home"]').classList.add('active');
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      $('view-home').classList.add('active');
      renderHome();
    });
    grid.appendChild(card);
  }
}
$('newAlbumBtn').addEventListener('click', ()=>openPrompt({
  title:'New album', sub:'Name your new album.', placeholder:'Album name', confirmLabel:'Create',
  onConfirm: async (name)=>{
    const path = joinRel(currentFolder, name);
    const res = await fetch(`${WORKER_URL}/folder/create`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast('Album created','ok');
    await loadFiles();
  }
}));

/* ══════════════════════ FAVORITES ══════════════════════ */
function renderFavorites(){
  const grid = $('favGrid'); grid.innerHTML='';
  const items = allFiles().filter(f=>isFav(f.path)).sort((a,b)=>basename(a.path).localeCompare(basename(b.path)));
  currentGridSource = items.map(f=>f.path);
  if(items.length===0) show($('favEmpty')); else hide($('favEmpty'));
  for(const it of items) grid.appendChild(buildTile(it));
}

/* ══════════════════════ VIEWER ══════════════════════ */
function openViewerFor(path, list){
  currentGridSource = list && list.length ? list : currentGridSource;
  viewerIndex = currentGridSource.indexOf(path);
  if(viewerIndex === -1) viewerIndex = 0;
  showViewerAt(viewerIndex);
  $('viewer').classList.add('open');
}
function showViewerAt(idx){
  const path = currentGridSource[idx];
  const item = findItem(path);
  if(!item) return;
  viewerIndex = idx;
  $('viewerCounter').textContent = `${idx+1} / ${currentGridSource.length}`;
  const favIcon = $('viewerFav').querySelector('i');
  favIcon.className = 'bi ' + (isFav(path) ? 'bi-heart-fill' : 'bi-heart');
  if(isImage(path)){
    show($('viewerImg')); hide($('viewerFileCard'));
    $('viewerImg').src = itemUrl(item);
  } else {
    hide($('viewerImg')); show($('viewerFileCard'));
    $('viewerFileCard').style.display='flex';
    $('viewerFileName').textContent = basename(path);
    $('viewerFileCard').querySelector('i').className = 'bi ' + (isVideo(path) ? 'bi-play-circle' : 'bi-file-earmark-richtext');
  }
}
$('viewerClose').addEventListener('click', ()=> $('viewer').classList.remove('open'));
$('viewerFav').addEventListener('click', ()=>{
  const path = currentGridSource[viewerIndex];
  toggleFav(path);
  showViewerAt(viewerIndex);
  renderActiveView();
});
$('viewerMore').addEventListener('click', ()=> openDetailFor(currentGridSource[viewerIndex]));
$('viewerInfoBtn').addEventListener('click', ()=> openDetailFor(currentGridSource[viewerIndex]));
$('viewerShareBtn').addEventListener('click', ()=> openShare([findItem(currentGridSource[viewerIndex])]));
$('viewerDownloadBtn').addEventListener('click', ()=> downloadItem(findItem(currentGridSource[viewerIndex])));
$('viewerDeleteBtn').addEventListener('click', ()=> confirmDelete([findItem(currentGridSource[viewerIndex])], ()=>{ $('viewer').classList.remove('open'); }));

// swipe navigation
(function(){
  const stage = $('viewerStage');
  let startX=0, startY=0, dx=0, dragging=false;
  stage.addEventListener('touchstart', e=>{ const t=e.touches[0]; startX=t.clientX; startY=t.clientY; dx=0; dragging=true; }, {passive:true});
  stage.addEventListener('touchmove', e=>{ if(!dragging) return; const t=e.touches[0]; dx = t.clientX-startX; }, {passive:true});
  stage.addEventListener('touchend', ()=>{
    if(!dragging) return; dragging=false;
    if(Math.abs(dx) > 60){
      if(dx < 0 && viewerIndex < currentGridSource.length-1) showViewerAt(viewerIndex+1);
      else if(dx > 0 && viewerIndex > 0) showViewerAt(viewerIndex-1);
    }
  });
})();

/* ══════════════════════ DETAIL SHEET ══════════════════════ */
let _detailItem = null;
function openDetailFor(path){
  const item = findItem(path);
  if(!item) return;
  _detailItem = item;
  $('detailName').textContent = basename(item.path);
  $('detailSize').textContent = fmtBytes(item.size);
  $('detailFolder').textContent = dirname(item.path) ? '/'+dirname(item.path) : '/ (Home)';
  $('detailType').textContent = extLabel(item.path) + ' · ' + kindOf(item.path);
  $('detailUrl').textContent = itemUrl(item);
  if(isImage(item.path)){ $('detailThumb').src = itemUrl(item); $('detailThumb').style.display=''; }
  else { $('detailThumb').style.display='none'; }
  $('detailOverlay').classList.add('open');
}
$('detailClose').addEventListener('click', ()=> $('detailOverlay').classList.remove('open'));
$('detailCloseBtn').addEventListener('click', ()=> $('detailOverlay').classList.remove('open'));
$('detailOverlay').addEventListener('click', e=>{ if(e.target===$('detailOverlay')) $('detailOverlay').classList.remove('open'); });
$('detailCopyBtn').addEventListener('click', ()=> copyText($('detailUrl').textContent));
$('detailDownloadBtn').addEventListener('click', ()=> downloadItem(_detailItem));
$('detailShareBtn').addEventListener('click', ()=> openShare([_detailItem]));
$('detailMoveBtn').addEventListener('click', ()=> openPicker([_detailItem], ()=>{ $('detailOverlay').classList.remove('open'); }));
$('detailRenameBtn').addEventListener('click', ()=> openPrompt({
  title:'Rename file', sub:'Enter a new file name.', value:basename(_detailItem.path), confirmLabel:'Save',
  onConfirm: async (newName)=>{
    const newPath = joinRel(dirname(_detailItem.path), newName);
    const res = await fetch(`${WORKER_URL}/rename`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oldPath:_detailItem.path,newPath})});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    toast('Renamed','ok'); $('detailOverlay').classList.remove('open');
    await loadFiles();
  }
}));
$('detailDeleteBtn').addEventListener('click', ()=> confirmDelete([_detailItem], ()=> $('detailOverlay').classList.remove('open')));

/* ══════════════════════ DOWNLOAD ══════════════════════ */
function downloadItem(item){
  if(!item) return;
  const a = document.createElement('a');
  a.href = `${WORKER_URL}/download?path=${encodeURIComponent(item.path)}`;
  a.download = basename(item.path);
  document.body.appendChild(a); a.click(); a.remove();
}

/* ══════════════════════ SHARE ══════════════════════ */
function openShare(items){
  const links = items.filter(Boolean).map(itemUrl);
  const box = $('shareLinks'); box.innerHTML='';
  for(const l of links){ const row=document.createElement('div'); row.className='share-link-row'; row.textContent=l; box.appendChild(row); }
  $('shareCopyPlural').textContent = links.length>1 ? `s (${links.length})` : '';
  $('shareOverlay').classList.add('open');
  $('shareOverlay')._links = links;
}
$('shareCloseBtn').addEventListener('click', ()=> $('shareOverlay').classList.remove('open'));
$('shareOverlay').addEventListener('click', e=>{ if(e.target===$('shareOverlay')) $('shareOverlay').classList.remove('open'); });
$('shareCopyAllBtn').addEventListener('click', ()=> copyText(($('shareOverlay')._links||[]).join('\n')));
$('shareNativeBtn').addEventListener('click', async ()=>{
  const links = $('shareOverlay')._links || [];
  if(navigator.share){
    try{ await navigator.share({ title:'AditiVerse', text:'Shared from AditiVerse', url:links[0] }); }catch{}
  } else {
    copyText(links.join('\n'));
  }
});

/* ══════════════════════ SELECTION TOOLBAR ══════════════════════ */
$('selShareBtn').addEventListener('click', ()=> openShare([...selected].map(findItem)));
$('selDownloadBtn').addEventListener('click', ()=> [...selected].forEach(p=>downloadItem(findItem(p))));
$('selAlbumBtn').addEventListener('click', ()=> openPicker([...selected].map(findItem), exitSelectMode));
$('selDeleteBtn').addEventListener('click', ()=> confirmDelete([...selected].map(findItem), exitSelectMode, true));

/* ══════════════════════ DELETE ══════════════════════ */
function confirmDelete(items, onDone, isBatch=false){
  items = items.filter(Boolean);
  if(!items.length) return;
  $('deleteTitle').textContent = items.length>1 ? `Delete ${items.length} items?` : `Delete "${basename(items[0].path)}"?`;
  $('deleteSub').textContent = "This permanently removes the file from your CDN — it can't be undone.";
  $('deleteModal').classList.add('open');
  const btn = $('deleteConfirmBtn');
  const handler = async ()=>{
    btn.classList.add('loading'); btn.disabled=true;
    try{
      if(isBatch || items.length>1){
        const res = await fetch(`${WORKER_URL}/delete-batch`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paths:items.map(i=>i.path)})});
        const data = await res.json(); if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
      } else {
        const res = await fetch(`${WORKER_URL}/delete`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:items[0].path})});
        const data = await res.json(); if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
      }
      toast('Deleted','ok');
      closeDeleteModal();
      if(onDone) onDone();
      await loadFiles();
    }catch(e){
      toast('Delete failed: '+e.message,'err');
      btn.classList.remove('loading'); btn.disabled=false;
    }
  };
  btn.onclick = handler;
}
function closeDeleteModal(){ $('deleteModal').classList.remove('open'); $('deleteConfirmBtn').classList.remove('loading'); $('deleteConfirmBtn').disabled=false; }
$('deleteCancelBtn').addEventListener('click', closeDeleteModal);
$('deleteModal').addEventListener('click', e=>{ if(e.target===$('deleteModal')) closeDeleteModal(); });

/* ══════════════════════ MOVE / ALBUM PICKER ══════════════════════ */
let _pickItems = null;
function openPicker(items, onDone){
  _pickItems = items.filter(Boolean).map(i=>i.path);
  const box = $('folderPicker'); box.innerHTML='';
  const rootRow = document.createElement('div'); rootRow.className='fp-item active'; rootRow.innerHTML='<i class="bi bi-house"></i> Home (root)';
  rootRow.dataset.dest=''; box.appendChild(rootRow);
  for(const f of allFolders()){
    const row = document.createElement('div'); row.className='fp-item'; row.innerHTML=`<i class="bi bi-folder2"></i> /${f.path}`;
    row.dataset.dest = f.path; box.appendChild(row);
  }
  box.querySelectorAll('.fp-item').forEach(row=>{
    row.addEventListener('click', ()=>{ box.querySelectorAll('.fp-item').forEach(r=>r.classList.remove('active')); row.classList.add('active'); });
  });
  $('pickerModal')._onDone = onDone;
  $('pickerModal').classList.add('open');
}
function closePicker(){ $('pickerModal').classList.remove('open'); $('pickerConfirmBtn').classList.remove('loading'); $('pickerConfirmBtn').disabled=false; }
$('pickerCancelBtn').addEventListener('click', closePicker);
$('pickerModal').addEventListener('click', e=>{ if(e.target===$('pickerModal')) closePicker(); });
$('pickerConfirmBtn').addEventListener('click', async ()=>{
  const active = document.querySelector('#folderPicker .fp-item.active');
  const destFolder = active ? active.dataset.dest : '';
  const btn = $('pickerConfirmBtn'); btn.classList.add('loading'); btn.disabled=true;
  try{
    const res = await fetch(`${WORKER_URL}/move`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:_pickItems, destFolder})});
    const data = await res.json(); if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    toast('Moved','ok');
    const onDone = $('pickerModal')._onDone;
    closePicker();
    if(onDone) onDone();
    await loadFiles();
  }catch(e){
    toast('Move failed: '+e.message,'err');
    btn.classList.remove('loading'); btn.disabled=false;
  }
});

/* ══════════════════════ RENAME / NEW ALBUM PROMPT ══════════════════════ */
function openPrompt({title, sub, value='', placeholder='', confirmLabel='Save', onConfirm}){
  $('promptTitle').textContent = title;
  $('promptSub').textContent = sub || '';
  $('promptInput').value = value;
  $('promptInput').placeholder = placeholder;
  $('promptConfirmLabel').textContent = confirmLabel;
  $('promptModal').classList.add('open');
  setTimeout(()=>{ $('promptInput').focus(); $('promptInput').select(); }, 60);
  $('promptModal')._onConfirm = onConfirm;
}
function closePrompt(){ $('promptModal').classList.remove('open'); $('promptConfirmBtn').classList.remove('loading'); $('promptConfirmBtn').disabled=false; }
$('promptCancelBtn').addEventListener('click', closePrompt);
$('promptModal').addEventListener('click', e=>{ if(e.target===$('promptModal')) closePrompt(); });
$('promptInput').addEventListener('keydown', e=>{ if(e.key==='Enter') $('promptConfirmBtn').click(); });
$('promptConfirmBtn').addEventListener('click', async ()=>{
  const val = $('promptInput').value.trim();
  if(!val) return;
  const btn = $('promptConfirmBtn'); btn.classList.add('loading'); btn.disabled=true;
  try{
    await $('promptModal')._onConfirm(val);
    closePrompt();
  }catch(e){
    toast('Failed: '+e.message,'err');
    btn.classList.remove('loading'); btn.disabled=false;
  }
});

/* ══════════════════════ STORAGE OVERVIEW ══════════════════════ */
function renderStorageSummary(){
  const files = allFiles();
  const photos = files.filter(f=>isImage(f.path)).reduce((s,f)=>s+(f.size||0),0);
  const videos = files.filter(f=>isVideo(f.path)).reduce((s,f)=>s+(f.size||0),0);
  const others = files.filter(f=>!isImage(f.path)&&!isVideo(f.path)).reduce((s,f)=>s+(f.size||0),0);
  const total = photos+videos+others;

  $('meStorageSub').textContent = `${fmtBytes(total)} used · ${files.length} files`;
  $('storageBig').textContent = fmtBytes(total);
  $('legPhotos').textContent = fmtBytes(photos);
  $('legVideos').textContent = fmtBytes(videos);
  $('legOthers').textContent = fmtBytes(others);
  $('countFiles').textContent = files.length;
  $('countAlbums').textContent = allFolders().length;

  const CIRC = 2*Math.PI*52;
  const pPhotos = total ? photos/total : 0;
  const pVideos = total ? videos/total : 0;
  const pOthers = total ? others/total : 0;
  const ringPhotos = $('ringPhotos'), ringVideos = $('ringVideos'), ringOthers = $('ringOthers');
  ringPhotos.style.strokeDasharray = `${CIRC*pPhotos} ${CIRC}`;
  ringPhotos.style.strokeDashoffset = 0;
  ringVideos.style.strokeDasharray = `${CIRC*pVideos} ${CIRC}`;
  ringVideos.style.strokeDashoffset = -CIRC*pPhotos;
  ringOthers.style.strokeDasharray = `${CIRC*pOthers} ${CIRC}`;
  ringOthers.style.strokeDashoffset = -CIRC*(pPhotos+pVideos);
}
$('meStorageBtn').addEventListener('click', ()=> $('storageOverlay').classList.add('open'));
$('storageCloseBtn').addEventListener('click', ()=> $('storageOverlay').classList.remove('open'));
$('storageOverlay').addEventListener('click', e=>{ if(e.target===$('storageOverlay')) $('storageOverlay').classList.remove('open'); });

/* ══════════════════════ UPLOAD ══════════════════════ */
$('uploadFab').addEventListener('click', ()=>{
  $('uploadDestSelect').value = currentFolder || '';
  $('uploadOverlay').classList.add('open');
});
$('uploadCloseBtn').addEventListener('click', ()=> $('uploadOverlay').classList.remove('open'));
$('uploadOverlay').addEventListener('click', e=>{ if(e.target===$('uploadOverlay')) $('uploadOverlay').classList.remove('open'); });
$('uploadDrop').addEventListener('click', ()=> $('uploadInput').click());
$('uploadInput').addEventListener('change', ()=>{
  queueUploads([...$('uploadInput').files]);
  $('uploadInput').value='';
});
['dragover','dragenter'].forEach(ev=> $('uploadDrop').addEventListener(ev, e=>{ e.preventDefault(); }));
$('uploadDrop').addEventListener('drop', e=>{
  e.preventDefault();
  if(e.dataTransfer.files.length) queueUploads([...e.dataTransfer.files]);
});

function queueUploads(files){
  for(const file of files) uploadOne(file);
}
function uploadOne(file){
  const row = document.createElement('div'); row.className='uq-item';
  const icon = document.createElement('div'); icon.className='uq-icon';
  if(IMG_RE.test(file.name)){ const img=document.createElement('img'); img.src=URL.createObjectURL(file); icon.appendChild(img); }
  else icon.innerHTML = `<i class="bi bi-file-earmark"></i>`;
  const info = document.createElement('div'); info.className='uq-info';
  info.innerHTML = `<div class="uq-name">${file.name}</div><div class="uq-bar"><div class="uq-fill"></div></div><div class="uq-status">${fmtBytes(file.size)} · Waiting…</div>`;
  row.appendChild(icon); row.appendChild(info);
  $('uploadQueue').prepend(row);
  const fill = info.querySelector('.uq-fill');
  const status = info.querySelector('.uq-status');

  const folder = $('uploadDestSelect').value || '';
  const form = new FormData();
  form.append('file', file);
  if(folder) form.append('folder', folder);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${WORKER_URL}/upload`);
  xhr.upload.addEventListener('progress', e=>{
    if(e.lengthComputable){ const pct = Math.round((e.loaded/e.total)*100); fill.style.width = pct+'%'; status.textContent = `${pct}% uploaded`; }
  });
  xhr.onload = ()=>{
    if(xhr.status>=200 && xhr.status<300){
      fill.style.width='100%'; status.textContent='Uploaded'; status.classList.add('ok');
      loadFiles();
    } else {
      status.textContent='Upload failed'; status.classList.add('err');
    }
  };
  xhr.onerror = ()=>{ status.textContent='Upload failed'; status.classList.add('err'); };
  xhr.send(form);
}

/* ══════════════════════ MENU BUTTON (quick nav) ══════════════════════ */
$('menuBtn').addEventListener('click', ()=>{
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.nav-btn[data-view="me"]').classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-me').classList.add('active');
});

/* ══════════════════════ BOOT ══════════════════════ */
function boot(){
  if(booted) return; booted = true;
  loadFiles();
}