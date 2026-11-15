/* AhmaMart — optional customer login (Supabase email auth).
   The store works exactly as before without logging in; this page only adds an optional account. */
const sb = supabase.createClient('https://wfdedrzkqtndnqulvpos.supabase.co','sb_publishable_zbw6qV6FQARxUcuWi9vtrw_brjtRecp');
const $ = id => document.getElementById(id);
const card = $('card'), alertBox = $('alert'), alertTxt = $('alertTxt');
const VIEWS = ['signin','signup','forgot','recovery','confirm','success','signedin'];
const COPY = {
  signin:   ['Welcome back','Sign in to check out faster. Or continue as a guest.'],
  signup:   ['Create your account','It takes less than a minute. Totally optional.'],
  forgot:   ['Reset your password','Enter your email and we will send you a reset link.'],
  recovery: ['Choose a new password','Pick a password you have not used before.'],
  confirm:  ['',''], success:['',''], signedin:['','']
};
let mode = 'signin', pendingEmail = '', redirectTimer = null;

/* where to go after login: only same-site pages are allowed */
function safeNext(){
  const n = new URLSearchParams(location.search).get('next') || '';
  return /^[a-z0-9_-]+\.html(\?[\w=&%.\-]*)?$/i.test(n) && !/^login\.html/i.test(n) ? n : 'index.html';
}
const NEXT = safeNext();
['backLink','guestBtn','okNow','siContinue'].forEach(id=>{ $(id).href = NEXT; });

function showAlert(msg, type, html){
  alertBox.className = 'alert ' + (type||'err');
  alertBox.querySelector('use').setAttribute('href', type==='ok' ? '#i-okc' : '#i-alert');
  if(html){ alertTxt.innerHTML = ''; alertTxt.append(html); } else alertTxt.textContent = msg;
  void alertBox.offsetWidth; alertBox.classList.add('show');
  if((type||'err')==='err'){ card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
}
function clearAlert(){ alertBox.className = 'alert'; document.querySelectorAll('.fld input.bad').forEach(i=>i.classList.remove('bad')); }

function setMode(m){
  mode = m; clearAlert(); clearTimeout(redirectTimer);
  VIEWS.forEach(v=>{ const el = $('v-'+v); el.hidden = v!==m; el.classList.remove('in'); });
  const view = $('v-'+m); void view.offsetWidth; view.classList.add('in');
  const tabbed = m==='signin' || m==='signup';
  $('tabs').hidden = !tabbed; $('guestBox').hidden = !(tabbed || m==='forgot');
  $('tabs').dataset.mode = m;
  $('tabSignin').setAttribute('aria-selected', m==='signin'); $('tabSignup').setAttribute('aria-selected', m==='signup');
  const [t,s] = COPY[m]; $('head').hidden = !t; $('hTitle').textContent = t; $('hSub').textContent = s;
  const first = view.querySelector('input'); if(first && matchMedia('(hover:hover)').matches) setTimeout(()=>first.focus({preventScroll:true}),350);
}
document.addEventListener('click', e=>{
  const g = e.target.closest('[data-go]'); if(g){ e.preventDefault(); setMode(g.dataset.go); }
  const eye = e.target.closest('.eye');
  if(eye){ const inp = eye.parentElement.querySelector('input'); const show = inp.type==='password'; inp.type = show?'text':'password'; eye.classList.toggle('on',show); eye.setAttribute('aria-label', show?'Hide password':'Show password'); }
});

function busy(btn, on){ btn.classList.toggle('loading', on); btn.disabled = on; }
function bad(...ids){ ids.forEach(id=>$(id).classList.add('bad')); }
function validEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
document.querySelectorAll('.fld input').forEach(i=>i.addEventListener('input',()=>{ i.classList.remove('bad'); if(alertBox.classList.contains('show') && alertBox.classList.contains('err')) alertBox.classList.remove('show'); }));

function friendly(err){
  const m = String(err && err.message || err || '').toLowerCase(), st = err && err.status;
  if(m.includes('invalid login')) return 'Email or password is incorrect.';
  if(m.includes('not confirmed')) return 'Please confirm your email first. Check your inbox for the link.';
  if(m.includes('already registered') || m.includes('already been registered')) return 'This email is already registered. Try signing in instead.';
  if(st===429 || m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Too many attempts. Please wait a minute and try again.';
  if(m.includes('at least') && m.includes('password')) return 'Password is too short. Use at least 8 characters.';
  if(m.includes('same password') || m.includes('different from the old')) return 'Please choose a password you have not used before.';
  if(m.includes('failed to fetch') || m.includes('network')) return 'Cannot reach the server. Please check your internet and try again.';
  if(m.includes('signups not allowed') || m.includes('signup is disabled')) return 'New sign-ups are switched off right now. You can still continue as a guest.';
  return 'Something went wrong. Please try again.';
}

/* password strength */
function strength(p){
  let s = 0; if(p.length>=8) s++; if(p.length>=12) s++; if(/[a-z]/.test(p)&&/[A-Z]/.test(p)) s++; if(/\d/.test(p)&&/[^A-Za-z0-9]/.test(p) || (/\d/.test(p)&&p.length>=10)) s++;
  return p ? Math.max(1, Math.min(4, s)) : 0;
}
$('su-pass').addEventListener('input', e=>{
  const p = e.target.value, s = strength(p);
  $('meter').dataset.s = s;
  $('meterHint').textContent = !p ? 'Use at least 8 characters.' : p.length<8 ? 'Keep going — at least 8 characters.' : ['','Weak — add more characters or numbers.','Okay — a bit more variety makes it stronger.','Good password.','Strong password.'][s];
});

function goSuccess(title, text, delay){
  setMode('success'); $('okTitle').textContent = title; $('okTxt').textContent = text;
  $('okBar').style.setProperty('--dur', delay+'ms'); $('okBar').style.animation='none'; void $('okBar').offsetWidth; $('okBar').style.animation='';
  redirectTimer = setTimeout(()=>{ location.href = NEXT; }, delay);
}

/* ---- Sign in ---- */
$('v-signin').addEventListener('submit', async e=>{
  e.preventDefault(); clearAlert();
  const email = $('si-email').value.trim(), password = $('si-pass').value, btn = e.target.querySelector('.btn');
  if(!validEmail(email)){ bad('si-email'); return showAlert('Please enter a valid email address.'); }
  if(!password){ bad('si-pass'); return showAlert('Please enter your password.'); }
  busy(btn,true);
  const {data,error} = await sb.auth.signInWithPassword({email,password}).catch(err=>({error:err}));
  busy(btn,false);
  if(error){
    pendingEmail = email; bad('si-pass');
    if(/not confirmed/i.test(error.message||'')){
      const b = document.createElement('span'); b.append(friendly(error)+' ');
      const r = document.createElement('button'); r.type='button'; r.className='lnk'; r.textContent='Resend email'; r.onclick=resend; b.append(r);
      return showAlert('', 'err', b);
    }
    return showAlert(friendly(error));
  }
  const name = (data.user.user_metadata||{}).full_name;
  goSuccess(name ? 'Welcome back, '+name.split(' ')[0]+'!' : 'Welcome back!', 'Signed in. Taking you back to the store…', 1500);
});

/* ---- Create account ---- */
$('v-signup').addEventListener('submit', async e=>{
  e.preventDefault(); clearAlert();
  const full_name = $('su-name').value.trim(), email = $('su-email').value.trim(), phone = $('su-phone').value.trim(), password = $('su-pass').value, btn = e.target.querySelector('.btn');
  if(full_name.length<2){ bad('su-name'); return showAlert('Please enter your full name.'); }
  if(!validEmail(email)){ bad('su-email'); return showAlert('Please enter a valid email address.'); }
  if(phone && phone.replace(/\D/g,'').length<10){ bad('su-phone'); return showAlert('That phone number looks too short. Leave it empty if you prefer.'); }
  if(password.length<8){ bad('su-pass'); return showAlert('Password must be at least 8 characters.'); }
  busy(btn,true);
  const {data,error} = await sb.auth.signUp({email,password,options:{data:{full_name,phone},emailRedirectTo:new URL('login.html',location.href).href}}).catch(err=>({error:err}));
  busy(btn,false);
  if(error){ if(/already/i.test(error.message||'')) bad('su-email'); return showAlert(friendly(error)); }
  /* Supabase returns an empty identities list (and no error) when the email is already registered and confirmation is on */
  if(data.user && Array.isArray(data.user.identities) && data.user.identities.length===0){ bad('su-email'); return showAlert('This email is already registered. Try signing in instead.'); }
  if(data.session){ return goSuccess('Account created!','Welcome to AhmaMart. Taking you back to the store…',1700); }
  pendingEmail = email; $('resendBtn').hidden = false;
  setMode('confirm'); $('confirmTxt').textContent = 'We sent a confirmation link to ' + email + '. Open it to activate your account, then sign in.';
});

async function resend(){
  if(!pendingEmail) return;
  const {error} = await sb.auth.resend({type:'signup',email:pendingEmail,options:{emailRedirectTo:new URL('login.html',location.href).href}}).catch(err=>({error:err}));
  if(mode==='confirm'){ showAlert(error ? friendly(error) : 'Email sent again. Please check your inbox (and spam).', error?'err':'ok'); }
  else showAlert(error ? friendly(error) : 'Confirmation email sent. Please check your inbox (and spam).', error?'err':'ok');
}
$('resendBtn').addEventListener('click', async ()=>{ const b=$('resendBtn'); busy(b,true); await resend(); busy(b,false); });

/* ---- Forgot password ---- */
$('v-forgot').addEventListener('submit', async e=>{
  e.preventDefault(); clearAlert();
  const email = $('fg-email').value.trim(), btn = e.target.querySelector('.btn');
  if(!validEmail(email)){ bad('fg-email'); return showAlert('Please enter a valid email address.'); }
  busy(btn,true);
  const {error} = await sb.auth.resetPasswordForEmail(email,{redirectTo:new URL('login.html',location.href).href}).catch(err=>({error:err}));
  busy(btn,false);
  if(error && (error.status===429 || /failed to fetch|network|rate limit|security purposes/i.test(error.message||''))) return showAlert(friendly(error));
  pendingEmail = email; setMode('confirm');
  $('confirmTxt').textContent = 'If an account exists for ' + email + ', a password reset link is on its way. Please check your inbox (and spam).';
  $('resendBtn').hidden = true;
});

/* ---- New password (opened from the reset email) ---- */
$('v-recovery').addEventListener('submit', async e=>{
  e.preventDefault(); clearAlert();
  const password = $('rc-pass').value, btn = e.target.querySelector('.btn');
  if(password.length<8){ bad('rc-pass'); return showAlert('Password must be at least 8 characters.'); }
  busy(btn,true);
  const {error} = await sb.auth.updateUser({password}).catch(err=>({error:err}));
  busy(btn,false);
  if(error) return showAlert(friendly(error));
  history.replaceState(null,'',location.pathname+location.search);
  goSuccess('Password updated','You are signed in. Taking you back to the store…',1700);
});

/* ---- Already signed in ---- */
function showSignedIn(user, justConfirmed){
  const meta = user.user_metadata || {}, name = meta.full_name || (user.email||'').split('@')[0] || 'there';
  setMode('signedin');
  $('avatar').textContent = name.trim().charAt(0).toUpperCase() || 'A';
  $('siName').textContent = justConfirmed ? 'Email confirmed!' : 'Hi, ' + name.split(' ')[0];
  $('siMail').textContent = (justConfirmed ? 'Your account is ready. ' : 'You are signed in as ') + (user.email||'');
}
$('siLogout').addEventListener('click', async ()=>{ const b=$('siLogout'); busy(b,true); await sb.auth.signOut().catch(()=>{}); busy(b,false); setMode('signin'); showAlert('You have been logged out.','ok'); });

/* ---- start ---- */
(async function init(){
  const hash = location.hash || '';
  const isRecovery = /type=recovery/.test(hash), isSignup = /type=(signup|email_change|magiclink|invite)/.test(hash);
  const hashErr = /error_description=([^&]+)/.exec(hash);
  if(isRecovery) sb.auth.onAuthStateChange(ev=>{ if(ev==='PASSWORD_RECOVERY') setMode('recovery'); });
  const timeout = new Promise(res=>setTimeout(()=>res({data:{session:null}}),2500));
  const {data} = await Promise.race([sb.auth.getSession().catch(()=>({data:{session:null}})), timeout]);
  if(isRecovery){ if(data.session) setMode('recovery'); else { setMode('forgot'); showAlert('That reset link has expired. Please request a new one.'); } return; }
  if(data.session){ history.replaceState(null,'',location.pathname+location.search); return showSignedIn(data.session.user, isSignup); }
  setMode(new URLSearchParams(location.search).get('mode')==='signup' ? 'signup' : 'signin');
  if(hashErr){ showAlert(decodeURIComponent(hashErr[1].replace(/\+/g,' '))); }
})();
