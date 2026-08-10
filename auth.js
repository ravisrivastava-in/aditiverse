/**
 * AditiVerse — auth.js
 * Runs only on auth.html. Builds the login form with JS (rather than
 * hardcoding it in the HTML) and injects it into #authFormRoot, wires up
 * Firebase sign-in, and redirects to index.html once authenticated.
 *
 * index.html has its own guard (in app.js) that redirects back here if
 * there's no signed-in user — the two pages don't share any DOM, only
 * the same Firebase project and the redirect contract between them.
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';
import { getAnalytics, isSupported as analyticsSupported } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-analytics.js';

const FB = {apiKey:"AIzaSyCX2t3rdm_H-W3oemVldyLy6RDK2q9qqXE",authDomain:"aditiverse-gallary.firebaseapp.com",projectId:"aditiverse-gallary",storageBucket:"aditiverse-gallary.firebasestorage.app",messagingSenderId:"634381829802",appId:"1:634381829802:web:96494e89440e65646072d3",measurementId:"G-66LD4MR0PF"};
const INDEX_PAGE = 'index.html';

const app  = getApps().length ? getApps()[0] : initializeApp(FB);
const auth = getAuth(app);
analyticsSupported().then(ok=>{ if(ok){ try{ getAnalytics(app); }catch{} } }).catch(()=>{});

// Already signed in? Skip the form entirely and go straight to the app.
onAuthStateChanged(auth, user => {
  if (user) window.location.replace(INDEX_PAGE);
});

let _tt;
function toast(msg, type=''){
  const el = document.getElementById('toast');
  if(!el) return;
  el.textContent = msg; el.className = `toast${type?' '+type:''}`;
  clearTimeout(_tt);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('show')));
  _tt = setTimeout(()=>el.classList.remove('show'), 2600);
}

// ── Forgot password — real flow: sends an actual Firebase password-reset
// email. There's no signed-in session on this page (that's the whole
// point of "forgot"), so this can't reauthenticate with a current
// password like Profile's Change Password does — sendPasswordResetEmail
// is Firebase's real equivalent for a logged-out flow. ──
function buildForgotPasswordModal(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'forgotOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">Mera Sugnuuuu Puchkuu Password Bhul??</div>
      <div class="modal-sub">Enter your account email — I'll send a real reset link.</div>
      <input class="modal-input" id="forgotEmailInput" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email">
      <div class="modal-actions">
        <button class="modal-cancel" id="forgotCancelBtn">Cancel</button>
        <button class="modal-confirm" id="forgotSendBtn"><span class="modal-btn-text">Send reset link</span><span class="modal-spinner"></span></button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = ()=>{
    overlay.classList.remove('open');
    document.getElementById('forgotSendBtn').classList.remove('loading');
    document.getElementById('forgotSendBtn').disabled = false;
  };
  document.getElementById('forgotCancelBtn').addEventListener('click', close);
  overlay.addEventListener('click', e=>{ if(e.target===overlay) close(); });
  document.getElementById('forgotEmailInput').addEventListener('keydown', e=>{
    if(e.key==='Enter') document.getElementById('forgotSendBtn').click();
  });
  document.getElementById('forgotSendBtn').addEventListener('click', async ()=>{
    const email = document.getElementById('forgotEmailInput').value.trim();
    if(!email){ toast('Email daal de pehle, sugnnu', 'err'); return; }
    const btn = document.getElementById('forgotSendBtn');
    btn.classList.add('loading'); btn.disabled = true;
    try{
      await sendPasswordResetEmail(auth, email);
      close();
      toast('Reset link bhej diya, sugnnu — check your email!', 'ok');
    }catch(ex){
      btn.classList.remove('loading'); btn.disabled = false;
      toast('Vo email nahi mila, sugnnu', 'err');
    }
  });

  return overlay;
}
let _forgotOverlay = null;
function openForgotPasswordModal(prefillEmail){
  if(!_forgotOverlay) _forgotOverlay = buildForgotPasswordModal();
  document.getElementById('forgotEmailInput').value = prefillEmail || '';
  _forgotOverlay.classList.add('open');
  setTimeout(()=> document.getElementById('forgotEmailInput').focus(), 60);
}

function buildLoginForm(){
  const root = document.getElementById('authFormRoot');
  if(!root) return;
  root.innerHTML = '';

  const err = document.createElement('div');
  err.className = 'auth-err';
  err.id = 'authErr';
  err.innerHTML = '<i class="bi bi-exclamation-circle"></i><span id="authErrMsg">Invalid credentials</span>';
  root.appendChild(err);

  const form = document.createElement('form');
  form.className = 'auth-form';
  form.autocomplete = 'on';
  form.noValidate = true;
  form.innerHTML = `
    <div class="ig">
      <label>Email</label>
      <input type="email" class="inp" id="authEmail" name="email" placeholder="you@example.com" autocomplete="email" inputmode="email" required>
    </div>
    <div class="ig">
      <label>Password</label>
      <input type="password" class="inp" id="authPass" name="password" placeholder="••••••••" autocomplete="current-password" required>
    </div>
    <button type="submit" class="btn-verse btn-full" id="authBtn">
      <span id="authBtnLabel"><i class="bi bi-stars"></i> Enter AditiVerse</span>
      <span class="spinner" id="authSpinner" style="display:none"></span>
    </button>
  `;
  root.appendChild(form);

  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.id = 'forgotPasswordBtn';
  forgot.className = 'forgot-password-link';
  forgot.textContent = 'Forgot password?';
  root.appendChild(forgot);
  forgot.addEventListener('click', ()=> openForgotPasswordModal(document.getElementById('authEmail').value.trim()));

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    err.classList.remove('show');

    const email = document.getElementById('authEmail').value.trim();
    const pass  = document.getElementById('authPass').value;
    const btn     = document.getElementById('authBtn');
    const label   = document.getElementById('authBtnLabel');
    const spinner = document.getElementById('authSpinner');

    btn.disabled = true;
    label.style.display = 'none';
    spinner.style.display = '';

    try{
      await signInWithEmailAndPassword(auth, email, pass);
      window.location.replace(INDEX_PAGE);
    }catch(ex){
      document.getElementById('authErrMsg').textContent = 'Invalid email or password.';
      err.classList.add('show');
      btn.disabled = false;
      label.style.display = '';
      spinner.style.display = 'none';
    }
  });
}

buildLoginForm();