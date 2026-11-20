const fmt = n => 'Rs. ' + Number(n).toLocaleString('en-PK',{maximumFractionDigits:0});

const sb = supabase.createClient('https://wfdedrzkqtndnqulvpos.supabase.co','sb_publishable_zbw6qV6FQARxUcuWi9vtrw_brjtRecp');
let DB = {categories:[],products:[],orders:[],images:{},variants:{}};
let pendingBlob = null;
const esc = t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function loadPublic(){
  const [c,p,pi,pv]=await Promise.all([sb.from('categories').select('*').order('id'),sb.from('products').select('*').order('id'),sb.from('product_images').select('*').order('sort_order'),sb.from('product_variants').select('*').order('sort_order').order('id')]);
  if(c.error||p.error){ console.error(c.error||p.error); document.getElementById('grid').innerHTML='<p style="padding:24px;text-align:center">Store load nahin ho saka. Page refresh karein.</p>'; return; }
  DB.categories=c.data; DB.products=p.data; DB.loaded=true;
  DB.images = {};
  if(!pi.error) for(const row of pi.data){ (DB.images[row.product_id] ||= []).push(row); }
  /* variants: if supabase-variants.sql has not been run yet, the table is missing and every product simply has no variants */
  DB.variants = {};
  if(!pv.error) for(const row of pv.data){ (DB.variants[row.product_id] ||= []).push(row); }
  try{ localStorage.setItem('ahma_cache_v1',JSON.stringify({c:DB.categories,p:DB.products,i:DB.images,v:DB.variants})); }catch(e){}
}
/* ===== Product variants (Size / Colour ...) =====
   A variant = one combination, e.g. [{n:'Size',v:'M'},{n:'Colour',v:'Red'}], with its own stock. */
const variantsOf = p => (p && DB.variants[p.id]) || [];
const hasVariants = p => variantsOf(p).length > 0;
/* real stock of a product: for products with variants it is the total of the variants (never trust a stale products.stock) */
const pStock = p => hasVariants(p) ? variantsOf(p).reduce((s,v)=>s+(Number(v.stock)||0),0) : Number((p&&p.stock)||0);
const vLabel = v => ((v && v.options) || []).map(o=>o.v).join(' / ');
/* colour swatches on the product page: common English / Roman-Urdu colour names; any valid CSS colour also works */
const COLOUR_MAP = {black:'#111111',white:'#ffffff','off white':'#f4f1ea',red:'#d62828',blue:'#1d4ed8',navy:'#1e2a5a','navy blue':'#1e2a5a','sky blue':'#38bdf8','royal blue':'#2347c5',green:'#15803d','olive':'#6b7a2a','bottle green':'#0b5d3b',yellow:'#facc15',mustard:'#d9a404',orange:'#f97316',pink:'#ec4899','hot pink':'#ff2d95',purple:'#7c3aed',grey:'#9ca3af',gray:'#9ca3af','dark grey':'#4b5563','light grey':'#d1d5db',charcoal:'#374151',brown:'#7c4a2d',beige:'#e8d9b5',cream:'#f5efdc',maroon:'#7f1d1d',golden:'#d4a017',gold:'#d4a017',silver:'#c0c0c0',skin:'#e8c4a0',khaki:'#bda66b',firozi:'#14b8a6',turquoise:'#14b8a6',peach:'#ffb48a',lavender:'#b9a7f0',mehroon:'#7f1d1d',kala:'#111111',safed:'#ffffff',laal:'#d62828',neela:'#1d4ed8',hara:'#15803d',sabz:'#15803d',peela:'#facc15',gulabi:'#ec4899',kaththai:'#7c4a2d',sunehri:'#d4a017'};
const isColourName = n => /colou?r|rang/i.test(String(n||''));
function swatchCss(val){
  const k = String(val||'').trim().toLowerCase(); if(!k) return '';
  if(COLOUR_MAP[k]) return COLOUR_MAP[k];
  try{ if(window.CSS && CSS.supports && CSS.supports('color', k)) return k; }catch(e){}
  return '';
}
const optVal = (v,n) => { const o=((v&&v.options)||[]).find(o=>o.n===n); return o?o.v:undefined; };
function vOptionNames(vs){ const out=[]; vs.forEach(v=>(v.options||[]).forEach(o=>{ if(!out.includes(o.n)) out.push(o.n); })); return out; }
function vOptionValues(vs,n){ const out=[]; vs.forEach(v=>{ const x=optVal(v,n); if(x!==undefined && !out.includes(x)) out.push(x); }); return out; }
/* cart lines are identified by product id + variant id */
const cartKey = i => String(i.id) + (i.vid ? '-' + i.vid : '');
const cartName = i => i.vlabel ? i.name + ' (' + i.vlabel + ')' : i.name;
function productGallery(p){
  const extra = (DB.images[p.id]||[]).map(r=>r.image_url);
  return [p.image_url, ...extra].filter(Boolean);
}
async function loadOrders(){ const r=await sb.from('orders').select('*').order('id',{ascending:false}); if(r.error){ console.error(r.error); DB.ordersError=r.error.message||'unknown error'; } else { DB.orders=r.data; DB.ordersError=''; } }
let cart = JSON.parse(localStorage.getItem('usw_cart')||'[]');
const saveCart = ()=> localStorage.setItem('usw_cart', JSON.stringify(cart));

let activeCategory = '', searchTerm = '';

function catName(id){ const c = DB.categories.find(c=>c.id===id); return c? c.name : ''; }

/* ===== Category tree (categories can have sub-categories, any depth) =====
   A category with parent_id = null is a main (top-level) category.
   If the parent_id column does not exist yet in Supabase, every category is simply top-level (old behaviour). */
function catById(id){ return DB.categories.find(c=>Number(c.id)===Number(id)); }
function catParentId(c){ return c && c.parent_id!=null ? Number(c.parent_id) : null; }
function catChildren(id){ return DB.categories.filter(c=>catParentId(c)===Number(id)); }
function catRoots(){ return DB.categories.filter(c=>{ const p=catParentId(c); return p===null || !catById(p); }); }
function catHasChildren(id){ return catChildren(id).length>0; }
function catDescendantIds(id){ const out=[Number(id)]; for(let i=0;i<out.length;i++){ catChildren(out[i]).forEach(c=>{ if(!out.includes(Number(c.id))) out.push(Number(c.id)); }); } return out; }
function catPath(id){ const path=[]; let c=catById(id), guard=0; while(c && guard++<25){ path.unshift(c); c=catById(catParentId(c)); } return path; }
function catPathName(id){ return catPath(id).map(c=>c.name).join(' › '); }
function productsInCat(id, list){ const ids=new Set(catDescendantIds(id)); return (list||DB.products).filter(p=>ids.has(Number(p.category_id))); }
function catPageHref(id){ return 'category.html?id=' + encodeURIComponent(id); }
/* where a main-category tile/chip/link goes: categories with sub-categories open their own page, others behave as before */
function catGo(id){
  if(id && catHasChildren(id)){ location.href = catPageHref(id); return true; }
  return false;
}

function renderChips(){
  const el = document.getElementById('chips');
  el.innerHTML = `<button class="chip ${activeCategory===''?'on':''}" data-id="">All</button>` +
    catRoots().map(c=>`<button class="chip ${activeCategory===c.id?'on':''}" data-id="${c.id}">${esc(c.name)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(ch=>ch.addEventListener('click',()=>{
    const id = ch.dataset.id ? Number(ch.dataset.id) : '';
    if(id!=='' && catGo(id)) return;
    activeCategory = id;
    renderChips(); renderGrid();
  }));
}

function filteredProducts(){
  const ids = activeCategory!=='' ? new Set(catDescendantIds(activeCategory)) : null;
  return DB.products.filter(p=>{
    if(ids && !ids.has(Number(p.category_id))) return false;
    if(searchTerm && !p.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });
}

function catIcon(name){
  const n=(name||'').toLowerCase();
  if(/men|mard|gents/.test(n) && !/wom/.test(n)) return '\uD83D\uDC54';
  if(/wom|lady|ladies|girl/.test(n)) return '\uD83D\uDC57';
  if(/kid|child|bache/.test(n)) return '\uD83E\uDDD2';
  if(/access|watch|bag/.test(n)) return '\u231A';
  if(/shoe|foot/.test(n)) return '\uD83D\uDC5F';
  return '\uD83D\uDECD\uFE0F';
}
function discPct(p){
  return p.compare_at_price && Number(p.compare_at_price)>Number(p.price) ? Math.round((1-Number(p.price)/Number(p.compare_at_price))*100) : 0;
}
function productCardHTML(p){
  const d=discPct(p), st=pStock(p), low=st>0 && st<=5;
  return `
    <div class="card" data-open="${p.id}">
      <div class="cimg">${p.image_url?`<img src="${esc(p.image_url)}" alt="${esc(p.name)}" loading="lazy" decoding="async">`:`<span>${esc((p.name||'?')[0])}</span>`}${d?`<span class="dbadge">-${d}%</span>`:''}</div>
      <div class="cbody">
        <div class="cname">${esc(p.name)}</div>
        <div class="prow"><span class="price">${fmt(p.price)}</span>${p.compare_at_price?`<span class="pcompare">${fmt(p.compare_at_price)}</span>`:''}</div>
        <div class="ctags"><span class="tag cod">Delivery across Pakistan</span>${low?`<span class="tag low">Only ${st} left</span>`:''}</div>
        <button class="addbtn" data-id="${p.id}" ${st<=0?'disabled':''}>${st<=0?'Out of stock':(hasVariants(p)?'Select size / colour':'Add to cart')}</button>
      </div>
    </div>`;
}
function pdSetMain(url, name){ document.getElementById('pdImg').innerHTML = url?`<img src="${url}" alt="${esc(name)}">`:`<span style="font-size:3rem">${esc(name[0])}</span>`; }
function openProductDetail(id){ location.href = 'product.html?id=' + encodeURIComponent(id); }
/* Category circles (top) + category sidebar (desktop) */
function scrollToCat(id){
  if(activeCategory!==''){ activeCategory=''; renderChips(); renderGrid(); }
  const el = document.getElementById('cat-sec-'+id);
  if(el){ el.scrollIntoView({behavior:'smooth',block:'start'}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}
function renderCatBlocks(){
  const box = document.getElementById('catBlocks'), side = document.getElementById('catSide');
  const matches = DB.products.filter(p=>!searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const cats = catRoots().map(c=>({id:c.id,name:c.name,image_url:c.image_url,n:productsInCat(c.id,matches).length}));
  const other = matches.filter(p=>!DB.categories.some(c=>c.id===p.category_id)).length;
  if(other) cats.push({id:0,name:'Other',n:other});
  if(box) box.innerHTML = cats.length ? `<div class="cb-title">Shop by category</div><div class="cb-row">` +
    cats.map(c=>`<button type="button" class="cb-tile" data-id="${c.id}">
      <span class="cb-ico">${c.image_url?`<img src="${esc(c.image_url)}" alt="${esc(c.name)}" loading="lazy" decoding="async">`:`<span aria-hidden="true">${catIcon(c.name)}</span>`}</span>
      <span class="cb-name">${esc(c.name)}</span></button>`).join('') + `</div>` : '';
  if(side) side.innerHTML = cats.length ? `<div class="side-title">Categories</div>` +
    cats.map(c=>`<button type="button" class="side-item" data-id="${c.id}"><span aria-hidden="true">${catIcon(c.name)}</span><span class="side-name">${esc(c.name)}</span><span class="side-count">${c.n}</span><i>›</i></button>`).join('') : '';
  [box,side].forEach(root=>{ if(root) root.querySelectorAll('[data-id]').forEach(t=>t.addEventListener('click',()=>{ const id=Number(t.dataset.id); if(!catGo(id)) scrollToCat(id); })); });
}

/* Products grouped in separate blocks, one per category */
function renderGrid(){
  document.body.classList.toggle('searching',!!searchTerm||activeCategory!=='');
  const list = filteredProducts();
  const wrap = document.getElementById('grid');
  const empty = document.getElementById('emptyState');
  renderCatBlocks();
  if(list.length===0){ wrap.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const groups = catRoots().map(c=>({id:c.id,name:c.name,items:productsInCat(c.id,list)}));
  const rest = list.filter(p=>!DB.categories.some(c=>c.id===p.category_id));
  if(rest.length) groups.push({id:0,name:'Other',items:rest});
  wrap.innerHTML = groups.filter(g=>g.items.length).map(g=>`
    <section class="cat-section" id="cat-sec-${g.id}">
      <div class="cat-head"><span class="cat-ico">${catIcon(g.name)}</span><h2>${g.name}</h2><span class="cat-num">${g.items.length}</span>${g.id&&catHasChildren(g.id)?`<a class="cat-more" href="${catPageHref(g.id)}">Browse ${esc(g.name)} ›</a>`:''}</div>
      <div class="grid">${g.items.map(productCardHTML).join('')}</div>
    </section>`).join('');
  wrap.querySelectorAll('.addbtn:not([disabled])').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); addToCart(Number(b.dataset.id)); }));
  wrap.querySelectorAll('.card[data-open]').forEach(c=>c.addEventListener('click',()=>openProductDetail(Number(c.dataset.open))));
}

function renderFeatureCollections(){
  const hot = document.getElementById('featuredGrid'), sale = document.getElementById('saleGrid');
  if(!hot || !sale) return;
  const featured = DB.products.filter(p=>pStock(p)>0).sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,12);
  const deals = DB.products.filter(p=>discPct(p)>0 && pStock(p)>0).sort((a,b)=>discPct(b)-discPct(a)).slice(0,6);
  hot.innerHTML = featured.length ? featured.map(productCardHTML).join('') : '<p class="empty">New products are coming soon.</p>';
  sale.innerHTML = deals.map(productCardHTML).join('');
  [hot,sale].forEach(root=>{
    root.querySelectorAll('.addbtn:not([disabled])').forEach(b=>b.addEventListener('click',e=>{e.stopPropagation();addToCart(Number(b.dataset.id));}));
    root.querySelectorAll('.card[data-open]').forEach(c=>c.addEventListener('click',()=>openProductDetail(Number(c.dataset.open))));
  });
  document.getElementById('clearanceProducts').style.display = deals.length ? 'block' : 'none';
  document.getElementById('featuredProducts').style.display = featured.length ? 'block' : 'none';
}

function addToCart(id){
  const p = DB.products.find(p=>p.id===id); if(!p) return;
  if(hasVariants(p)){ openProductDetail(p.id); return; }   /* size/colour must be chosen on the product page */
  const ex = cart.find(i=>i.id===id && !i.vid);
  if(ex){ if(ex.qty<p.stock) ex.qty++; } else { cart.push({id:p.id,name:p.name,price:p.price,image_url:p.image_url,qty:1,stock:p.stock}); }
  saveCart(); renderCart(); openCart();
}
function changeQty(key,d){
  const it = cart.find(i=>cartKey(i)===key); if(!it) return;
  it.qty += d;
  if(it.qty<=0) cart = cart.filter(i=>cartKey(i)!==key);
  else if(it.qty>it.stock) it.qty = it.stock;
  saveCart(); renderCart();
}
/* after reloading stock from the server: drop lines whose product/variant is gone or sold out, and trim quantities */
function reconcileCart(){
  cart = cart.filter(i=>{
    const p = DB.products.find(x=>x.id===i.id); if(!p) return false;
    if(hasVariants(p)){
      const v = i.vid ? variantsOf(p).find(x=>x.id===i.vid) : null;
      if(!v) return false;
      i.stock = Number(v.stock); i.vlabel = vLabel(v);
    } else if(i.vid){ return false; }
    else i.stock = Number(p.stock);
    if(i.stock <= 0) return false;
    if(i.qty > i.stock) i.qty = i.stock;
    return true;
  });
}
function subtotal(){ return cart.reduce((s,i)=>s+i.price*i.qty,0); }
function renderCart(){
  document.getElementById('cartCount').textContent = cart.reduce((s,i)=>s+i.qty,0);
  const body = document.getElementById('cartBody'); const foot = document.getElementById('cartFoot');
  if(cart.length===0){ body.innerHTML='<p style="color:var(--ink-soft);padding:16px 0">Your cart is empty.</p>'; foot.style.display='none'; return; }
  foot.style.display='block';
  body.innerHTML = cart.map(i=>`
    <div class="citem">
      <div class="cthumb">${i.image_url?`<img src="${i.image_url}">`:''}</div>
      <div style="flex:1">
        <div style="font-weight:600;font-size:.9rem">${i.name}</div>
        ${i.vlabel?`<div class="citem-var">${esc(i.vlabel)}</div>`:''}
        <div style="color:var(--gold);font-weight:700;font-size:.88rem">${fmt(i.price)}</div>
        <div class="qtyrow">
          <button class="qtybtn" data-key="${cartKey(i)}" data-d="-1">−</button><span>${i.qty}</span>
          <button class="qtybtn" data-key="${cartKey(i)}" data-d="1">+</button>
          <button class="rmv" data-key="${cartKey(i)}">Remove</button>
        </div>
      </div>
    </div>`).join('');
  body.querySelectorAll('.qtybtn').forEach(b=>b.addEventListener('click',()=>changeQty(b.dataset.key,Number(b.dataset.d))));
  body.querySelectorAll('.rmv').forEach(b=>b.addEventListener('click',()=>{cart=cart.filter(i=>cartKey(i)!==b.dataset.key);saveCart();renderCart();}));
  document.getElementById('subtotal').textContent = fmt(subtotal());
}

const overlay=document.getElementById('overlay'), cartDrawer=document.getElementById('cartDrawer');
const openCart=()=>{overlay.classList.add('on');cartDrawer.classList.add('on');};
const closeCart=()=>{overlay.classList.remove('on');cartDrawer.classList.remove('on');};
document.getElementById('cartBtn').addEventListener('click',openCart);
document.getElementById('cartCloseBtn').addEventListener('click',closeCart);
const openM=el=>{ el.classList.add('on'); if(el.id==='checkoutOverlay') prefillCheckout(); }, closeM=el=>el.classList.remove('on');
overlay.addEventListener('click',()=>{closeCart();[checkoutOverlay,trackOverlay,confirmOverlay].forEach(closeM);});

const checkoutOverlay=document.getElementById('checkoutOverlay');
document.getElementById('checkoutBtn').addEventListener('click',()=>{ if(cart.length===0) return; closeCart(); openM(checkoutOverlay); });
document.getElementById('checkoutClose').addEventListener('click',()=>closeM(checkoutOverlay));
const confirmOverlay=document.getElementById('confirmOverlay');
document.getElementById('confirmClose').addEventListener('click',()=>closeM(confirmOverlay));
document.getElementById('confirmDone').addEventListener('click',()=>closeM(confirmOverlay));
const trackOverlay=document.getElementById('trackOverlay');
document.getElementById('trackBtn').addEventListener('click',()=>openM(trackOverlay));
document.getElementById('trackClose').addEventListener('click',()=>closeM(trackOverlay));
const myOrdersOverlay=document.getElementById('myOrdersOverlay');
document.getElementById('myOrdersClose').addEventListener('click',()=>closeM(myOrdersOverlay));
document.getElementById('myOrdersBtn').addEventListener('click',()=>{
  openM(myOrdersOverlay);
  const savedPhone = localStorage.getItem('usw_last_phone');
  if(savedPhone){ document.getElementById('myOrdersPhone').value = savedPhone; loadMyOrders(savedPhone); }
});
async function loadMyOrders(phone){
  const msg=document.getElementById('myOrdersMsg'), list=document.getElementById('myOrdersList');
  msg.innerHTML=''; list.innerHTML='<p style="color:var(--ink-soft);font-size:.85rem">Loading…</p>';
  const {data:rows,error}=await sb.rpc('list_customer_orders',{p_phone:phone});
  if(error){ list.innerHTML=''; msg.innerHTML='<div class="msg err">Kuch ghalat ho gaya, dobara koshish karein.</div>'; return; }
  if(!rows || !rows.length){ list.innerHTML=''; msg.innerHTML='<div class="msg err">Is number se koi order nahin mila.</div>'; return; }
  list.innerHTML = rows.map(o=>`
    <div style="border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-weight:700;color:var(--gold);letter-spacing:1px">${esc(o.code)}</span>
        <span class="badge2 s-${o.status}">${esc(o.status)}</span>
      </div>
      <div style="font-size:.83rem;color:var(--ink-soft)">${itemsSummary(o.items)}</div>
      <div style="font-size:.83rem;color:var(--ink-soft)">${o.item_count} item(s) — ${fmt(o.subtotal)}</div>
      <div style="font-size:.78rem;color:var(--ink-soft)">${o.created_at?new Date(o.created_at).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}):''}</div>
    </div>`).join('');
}
document.getElementById('myOrdersForm').addEventListener('submit', e=>{
  e.preventDefault();
  const phone = document.getElementById('myOrdersPhone').value.trim();
  localStorage.setItem('usw_last_phone', phone);
  loadMyOrders(phone);
});

document.getElementById('checkoutForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target, msg=document.getElementById('checkoutMsg'); msg.innerHTML='';
  const name=f.name.value.trim(), phone=f.phone.value.trim(), email=f.email.value.trim(), address=f.address.value.trim(), city=f.city.value.trim();
  if(!name || !email || !address){ msg.innerHTML='<div class="msg err">Please fill in your name, email, and delivery address.</div>'; return; }
  if(!/^[0-9+\-\s()]{7,20}$/.test(phone)){ msg.innerHTML='<div class="msg err">Enter a valid phone number</div>'; return; }
  if(!window._payConfirmed){
    const bad = await stockProblem();
    if(bad){ msg.innerHTML=`<div class="msg err">${esc(bad)}</div>`; renderGrid(); return; }
    showPayStep(); return;
  }
  const pay = window._pay || {method:'-',tid:'-'}; window._payConfirmed = false;
  const btn=f.querySelector('button[type=submit]'); if(btn) btn.disabled=true;
  const itemsArg = cart.map(i=>i.vid ? {product_id:i.id,variant_id:i.vid,qty:i.qty} : {product_id:i.id,qty:i.qty});
  const hasVarItems = cart.some(i=>i.vid);
  const cartSnap = cart.map(i=>Object.assign({}, i));   /* copy: the cart is cleared after a successful order, the receipt still needs it */
  let res = null, error = null, degraded = false;
  const mode = pay.mode || 'advance';
  const codTag = mode==='cod' ? '[COD - cash on delivery] ' : '';
  const errText = e => String((e && (e.message || e.details || e.code)) || '');
  /* try the given order functions one after another; moves on to the next only when a function itself is missing */
  async function runAttempts(list){
    let out = null, err = null;
    for(const {fn,args} of list){
      let r; try{ r = await sb.rpc(fn, args); }catch(ex){ r = {error:ex}; }
      if(!r.error && r.data && r.data.code){ out = r.data; err = null; break; }
      err = r.error || new Error('Empty response from '+fn);
      console.error(fn+' failed', r.error || r);
      if(!/could not find the function|schema cache|p_email|PGRST202/i.test(errText(r.error))) break;
    }
    return {out, err};
  }
  const attempts = [
    {fn:'place_order_v2', args:{p_name:name,p_phone:phone,p_email:email,p_address:address,p_city:city,p_items:itemsArg,p_payment_method:mode}},
    {fn:'place_order', args:{p_name:name,p_phone:phone,p_email:email,p_address:codTag+address,p_city:city,p_items:itemsArg}},
    {fn:'place_order', args:{p_name:name,p_phone:phone,p_address:codTag+address,p_city:city,p_items:itemsArg}}
  ];
  if(mode==='online') attempts.length = 1;   /* online payment needs the v2 function (supabase-payment-methods.sql) */
  if(hasVarItems){
    /* carts with size/colour must go through place_order_v3 (supabase-variants.sql): it reduces the variant's own stock */
    const r3 = await runAttempts([{fn:'place_order_v3', args:{p_name:name,p_phone:phone,p_email:email,p_address:address,p_city:city,p_items:itemsArg,p_payment_method:mode}}]);
    res = r3.out; error = r3.err;
    /* Safety net: if the server answered with an unexpected database error (function missing / not updated), do not lose the customer's order.
       Save it through the normal order function instead, with the chosen size/colour written into the delivery note so the owner sees it. */
    const business = /OUT_OF_STOCK|VARIANT_REQUIRED|VARIANT_NOT_FOUND|COD_LIMIT|EMPTY_CART|BAD_ITEM|BAD_PAYMENT_METHOD/i;
    if(error && error.code && !business.test(errText(error))){
      console.warn('place_order_v3 is not working ('+errText(error)+'). Run supabase-variants.sql in Supabase. Using the safety net for this order.');
      const per = new Map(); cart.forEach(i=>per.set(i.id,(per.get(i.id)||0)+i.qty));
      const plain = [...per].map(([id,qty])=>({product_id:id,qty}));
      const note = '[VARIANT ORDER - '+cartSnap.filter(i=>i.vid).map(i=>cartName(i)+' x'+i.qty).join(', ')+' - reduce variant stock manually] ';
      const fb = [
        {fn:'place_order_v2', args:{p_name:name,p_phone:phone,p_email:email,p_address:note+address,p_city:city,p_items:plain,p_payment_method:mode}},
        {fn:'place_order', args:{p_name:name,p_phone:phone,p_email:email,p_address:codTag+note+address,p_city:city,p_items:plain}},
        {fn:'place_order', args:{p_name:name,p_phone:phone,p_address:codTag+note+address,p_city:city,p_items:plain}}
      ];
      if(mode==='online') fb.length = 1;
      const r2 = await runAttempts(fb);
      if(r2.out){ res = r2.out; error = null; degraded = true; } else if(r2.err && !/PGRST202|could not find the function/i.test(errText(r2.err))) { error = r2.err; }
    }
  } else {
    const r1 = await runAttempts(attempts); res = r1.out; error = r1.err;
  }
  if(btn) btn.disabled=false;
  if(error && /COD_LIMIT/i.test(errText(error))){
    showPayStep(); document.getElementById('psMsg').innerHTML = '<div class="msg err">Cash on Delivery sirf '+esc(fmt(PAYMENT.cod.maxTotal))+' tak ke orders par available hai. Meherbani karke doosra tareeqa chunein.</div>'; return;
  }
  if(error && /OUT_OF_STOCK|VARIANT_REQUIRED|VARIANT_NOT_FOUND/i.test(errText(error))){
    await loadPublic(); reconcileCart(); saveCart(); renderCart(); renderGrid();
    showCheckoutStep(1);
    msg.innerHTML = '<div class="msg err">Sorry, aap ka chuna hua item (ya uska size/colour) abhi stock se khatam ho gaya ya quantity kam reh gayi. Cart update kar diya gaya hai — meherbani karke dekh lein aur dobara order karein.</div>'; return;
  }
  if(error || !res){ showOrderFallback({name,phone,email,address,city,pay,err:errText(error)||'unknown'}); await loadPublic(); renderGrid(); return; }
  /* receipt lines: from the server (item names already contain the size/colour); safety-net orders use the cart's own names */
  const srvItems = Array.isArray(res.items) && res.items.length ? res.items : null;
  const rcptItems = (degraded || !srvItems) ? cartSnap.map(i=>({name:cartName(i), qty:i.qty, price:Number(i.price)})) : srvItems;
  const code=res.code, order={items:rcptItems,subtotal:Number(res.subtotal)||cartSnap.reduce((t,i)=>t+Number(i.price)*i.qty,0)};
  await loadPublic();
  cart=[]; saveCart(); renderCart(); renderGrid();
  f.reset(); window._pay=null; clearShot(); closeM(checkoutOverlay); showCheckoutStep(1);
  let onlineFailed = false;
  if(mode==='online'){
    rememberOrder(code, phone);
    try{ await startOnlinePayment(code, phone); return; }catch(ex){ console.error('online payment start failed', ex); onlineFailed = true; }
  }
  // Populate receipt
  document.getElementById('confirmCode').textContent = code;
  document.getElementById('receiptDate').textContent = new Date().toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'});
  document.getElementById('receiptCustomer').innerHTML =
    `<div>👤 ${esc(name)}</div><div>📞 ${esc(phone)}</div><div>✉️ ${esc(email)}</div><div>📍 ${esc(address)}${city?', '+esc(city):''}</div>${payLines(pay, order.subtotal, onlineFailed)}`;
  document.getElementById('receiptItems').innerHTML = order.items.map(i=>
    `<div style="display:flex;justify-content:space-between"><span>${i.qty}× ${esc(i.name)}</span><span>${fmt(i.price*i.qty)}</span></div>`
  ).join('');
  document.getElementById('receiptTotal').textContent = fmt(order.subtotal);
  // WhatsApp: customer sends the order details to the store
  const lines = order.items.map(i=>`• ${i.qty}× ${i.name} — ${fmt(i.price*i.qty)}`).join('\n');
  const waText = orderWaText({code,name,phone,email,address,city,lines,total:fmt(order.subtotal),pay,onlineFailed});
  document.getElementById('sendOrderWa').href = 'https://wa.me/'+STORE_WA+'?text='+encodeURIComponent(waText);
  window._waText = waText; window._waFile = pay.file || null;
  applyReceiptMode(pay, order.subtotal);
  try{
    localStorage.setItem('usw_last_phone', phone);
    const mine = JSON.parse(localStorage.getItem('usw_my_orders')||'[]');
    if(!mine.includes(code)){ mine.unshift(code); localStorage.setItem('usw_my_orders', JSON.stringify(mine.slice(0,50))); }
  }catch(e){}
  fillPayInstr(code, order.subtotal, pay);
  openM(confirmOverlay);
});


/* ===== PAYMENT MODES: advance (manual) / Cash on Delivery / online gateway ===== */
function rememberOrder(code, phone){
  try{
    localStorage.setItem('usw_last_phone', phone);
    const mine = JSON.parse(localStorage.getItem('usw_my_orders')||'[]');
    if(!mine.includes(code)){ mine.unshift(code); localStorage.setItem('usw_my_orders', JSON.stringify(mine.slice(0,50))); }
  }catch(e){}
}
function payLines(pay, total, onlineFailed){
  if(pay.mode==='cod') return `<div>💵 Cash on Delivery — pay ${esc(fmt(total))} to the courier</div>`;
  if(pay.mode==='online') return `<div>💳 Online payment — ${onlineFailed?'not completed yet':'awaiting confirmation'}</div>`;
  return `<div>💳 Paid via ${esc(pay.method)} · TID ${esc(pay.tid)}</div><div>🧾 Screenshot ${pay.proofPath?'received':'— please send on WhatsApp'}</div>`;
}
function orderWaText(o){
  const pay = o.pay; let payLine;
  if(pay.mode==='cod') payLine = `Payment: Cash on Delivery — ${o.total} courier ko delivery par dunga/dungi`;
  else if(pay.mode==='online') payLine = `Payment: Online (PayFast) — ${o.onlineFailed?'payment page nahin khuli, meherbani karke payment ka tareeqa batayen':'order code ke saath payment ki ja rahi hai'}`;
  else payLine = `Payment: ${pay.method} — TID ${pay.tid} (advance payment)\n${pay.proofPath?'Payment screenshot website par upload kar diya hai.':'Payment ka screenshot is chat mein bhej raha/rahi hoon.'}`;
  return `Assalam o Alaikum! Naya order:\nOrder Code: ${o.code}\nNaam: ${o.name}\nPhone: ${o.phone}\nEmail: ${o.email}\nAddress: ${o.address}${o.city?', '+o.city:''}\n${o.lines}\nTotal: ${o.total}\n${payLine}`;
}
function applyReceiptMode(pay, total){
  let chip='Payment submitted', bar='Payment submitted - pending check', stat='✅ Payment submitted — we will verify it and dispatch your order', waLbl='💬 Receipt + payment screenshot WhatsApp par bhejein';
  if(pay.mode==='cod'){ chip='Cash on Delivery'; bar='Pay '+fmt(total)+' cash on delivery'; stat='✅ Order placed — we will confirm it with you. Pay '+fmt(total)+' in cash when it arrives'; waLbl='💬 Order WhatsApp par confirm karein'; }
  else if(pay.mode==='online'){ chip='Payment pending'; bar='Online payment not completed'; stat='⏳ The payment page did not open. Your order is saved — please contact us on WhatsApp'; waLbl='💬 WhatsApp par rabta karein'; }
  const st = document.getElementById('receiptStatus'); if(st) st.textContent = stat;
  const wa = document.getElementById('sendOrderWa'); if(wa) wa.textContent = waLbl;
  window._rcpt = {chip, bar};
}
/* Online gateway: the Supabase Edge Function (payfast-create) builds the signed payment request; we post it to the gateway. */
async function startOnlinePayment(code, phone){
  const g = PAYMENT.gateway || {};
  const r = await sb.functions.invoke(g.fn || 'payfast-create', { body:{ code, phone } });
  const j = r.data;
  if(r.error || !j || !j.action || !j.fields) throw new Error((r.error&&r.error.message) || (j&&j.error) || 'gateway did not answer');
  const form = document.createElement('form'); form.method = 'POST'; form.action = j.action; form.style.display = 'none';
  Object.keys(j.fields).forEach(k=>{ const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = String(j.fields[k]); form.appendChild(i); });
  document.body.appendChild(form); form.submit();
}
/* Customer comes back from the gateway: ?pay=success|failed&code=XXXX (informational only — the real status is set by the payfast-webhook function) */
function handlePayReturn(){
  let q; try{ q = new URLSearchParams(location.search); }catch(e){ return; }
  const st = q.get('pay'), code = (q.get('code')||'').replace(/[^A-Za-z0-9\-]/g,'').slice(0,30);
  if(!st || !code || (st!=='success' && st!=='failed')) return;
  const box = document.createElement('div');
  box.setAttribute('role','status');
  box.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:9999;max-width:520px;margin:0 auto;padding:14px 40px 14px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.25);font-size:.9rem;line-height:1.5;color:#fff;background:'+(st==='success'?'#0a8a43':'#c0392b');
  box.innerHTML = st==='success'
    ? '<b>Shukriya!</b> Order <b>'+esc(code)+'</b> ki payment ka status verify ho raha hai. Confirm hone par hum dispatch kar denge.'
    : '<b>Payment mukammal nahin hui.</b> Order <b>'+esc(code)+'</b> abhi pending hai — dobara koshish karein ya WhatsApp par rabta karein.';
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '×'; x.setAttribute('aria-label','Close');
  x.style.cssText = 'position:absolute;right:8px;top:6px;background:none;border:0;color:#fff;font-size:1.5rem;cursor:pointer';
  x.onclick = ()=>box.remove(); box.appendChild(x); document.body.appendChild(box);
  rememberOrder(code, localStorage.getItem('usw_last_phone')||'');
  try{ history.replaceState(null,'',location.pathname); }catch(e){}
}
function payBadge(o){
  const m = o.payment_method || (/^\[COD/i.test(o.address||'') ? 'cod' : '');
  if(!m) return '';
  let t = m==='cod' ? '💵 COD' : m==='online' ? ('💳 Online · '+(o.payment_status||'unpaid')) : '📲 Advance';
  return `<div style="font-size:.72rem;font-weight:700;color:${m==='cod'?'#b45309':'#555'}">${esc(t)}</div>`;
}

/* ===== RECEIPT DOWNLOAD ===== */
document.getElementById('downloadReceiptBtn').addEventListener('click', downloadReceipt);

function downloadReceipt(){
  const code   = document.getElementById('confirmCode').textContent;
  const date   = document.getElementById('receiptDate').textContent;
  const total  = document.getElementById('receiptTotal').textContent;
  const RC = window._rcpt || {chip:'Payment submitted', bar:'Payment submitted - pending check'};
  const custLines = document.getElementById('receiptCustomer').innerText.trim().split('\n').map(l=>l.trim()).filter(Boolean);
  const rows = [...document.getElementById('receiptItems').children].map(d=>{
    const sp = d.querySelectorAll('span');
    return {label: sp[0]?.textContent||'', amount: sp[1]?.textContent||''};
  });

  const W = 420, SC = 3;                       // width in px, sharpness (3x = crisp photo)
  const CX0 = 16, CX1 = W-16, X0 = CX0+24, X1 = CX1-24, CW = X1-X0;
  const SANS = "'Inter','Segoe UI',Roboto,Arial,sans-serif", SERIF = "'Fraunces',Georgia,'Times New Roman',serif";

  function wrap(ctx, text, maxW){
    const words = String(text).split(/\s+/), lines = []; let cur = '';
    for(const w of words){
      const t = cur ? cur+' '+w : w;
      if(ctx.measureText(t).width > maxW && cur){ lines.push(cur); cur = w; } else cur = t;
    }
    if(cur) lines.push(cur);
    return lines;
  }
  function rr(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  // paint(ctx, dry): dry=true only measures the height, dry=false really draws
  function paint(ctx, dry){
    let y = 16 + 44;
    const T = (str,x,yy,font,color,align)=>{ ctx.font=font; if(dry) return; ctx.fillStyle=color; ctx.textAlign=align||'left'; ctx.fillText(str,x,yy); };
    const dash = (yy)=>{ if(dry) return; ctx.save(); ctx.strokeStyle='#d9ccb4'; ctx.lineWidth=1.5; ctx.setLineDash([5,4]); ctx.beginPath(); ctx.moveTo(X0,yy); ctx.lineTo(X1,yy); ctx.stroke(); ctx.restore(); };

    // header
    T('AhmaMart', X0, y, `700 24px ${SERIF}`, '#000000');
    T(date, X1, y, `400 11px ${SANS}`, '#8a8070', 'right');
    y += 16; dash(y); y += 24;

    // order code
    T('ORDER CODE', X0, y, `700 11px ${SANS}`, '#8a8070'); y += 34;
    T(code, X0, y, `700 32px ${SERIF}`, '#000000'); y += 16;
    // status chip
    ctx.font = `700 12px ${SANS}`; const cw = ctx.measureText(RC.chip).width + 28;
    if(!dry){ ctx.fillStyle='#000000'; rr(ctx,X0,y,cw,26,13); ctx.fill(); }
    T(RC.chip, X0+14, y+17.5, `700 12px ${SANS}`, '#ffffff'); y += 26+18;
    dash(y); y += 24;

    // customer
    T('CUSTOMER DETAILS', X0, y, `700 11px ${SANS}`, '#8a8070'); y += 8;
    ctx.font = `400 14px ${SANS}`;
    for(const l of custLines){ for(const ln of wrap(ctx,l,CW)){ y += 22; T(ln, X0, y, `400 14px ${SANS}`, '#3d3830'); } }
    y += 16; dash(y); y += 24;

    // items
    T('ITEM', X0, y, `700 11px ${SANS}`, '#8a8070'); T('AMOUNT', X1, y, `700 11px ${SANS}`, '#8a8070', 'right'); y += 8;
    for(const r of rows){
      ctx.font = `400 14px ${SANS}`;
      const ls = wrap(ctx, r.label, CW-100);
      y += 24;
      ls.forEach((ln,i)=>{ if(i>0) y += 19; T(ln, X0, y, `400 14px ${SANS}`, '#1C1A17'); });
      T(r.amount, X1, y - (ls.length-1)*19, `600 14px ${SANS}`, '#1C1A17', 'right');
      y += 8;
      if(!dry){ ctx.strokeStyle='#f0ebe0'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(X0,y); ctx.lineTo(X1,y); ctx.stroke(); }
    }
    y += 28;
    T('Total', X0, y, `800 17px ${SANS}`, '#000000'); T(total, X1, y, `800 17px ${SANS}`, '#000000', 'right');
    y += 26;

    // COD
    if(!dry){ ctx.fillStyle='#000000'; rr(ctx,X0,y,CW,44,10); ctx.fill(); }
    T(RC.bar, W/2, y+27, `700 14px ${SANS}`, '#ffffff', 'center');
    y += 44 + 24;

    // footer
    ctx.font = `400 11px ${SANS}`;
    for(const ln of ['Delivery ke liye order code aur phone number save rakhein','Track karein: AhmaMart Store website par "Track order"']){
      T(ln, W/2, y, `400 11px ${SANS}`, '#8a8070', 'center'); y += 18;
    }
    y += 6;
    T('Shukriya AhmaMart par order karne ka', W/2, y, `400 11px ${SANS}`, '#999999', 'center'); y += 30;
    return y;
  }

  const draw = ()=>{
    const probe = document.createElement('canvas').getContext('2d');
    const cardBottom = paint(probe, true);
    const H = cardBottom + 16;
    const cv = document.createElement('canvas'); cv.width = W*SC; cv.height = H*SC;
    const ctx = cv.getContext('2d'); ctx.scale(SC,SC);
    ctx.fillStyle = '#f5f1ea'; ctx.fillRect(0,0,W,H);                 // background
    ctx.save(); ctx.shadowColor='rgba(0,0,0,.14)'; ctx.shadowBlur=18; ctx.shadowOffsetY=6;
    ctx.fillStyle = '#ffffff'; rr(ctx, CX0, 16, CX1-CX0, cardBottom-16, 18); ctx.fill(); ctx.restore();   // white card
    paint(ctx, false);
    cv.toBlob(blob=>{
      if(!blob){ alert('Receipt image nahin ban saki. Screenshot le lein.'); return; }
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `AhmaMart-Receipt-${code}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
    }, 'image/png');
  };
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(draw).catch(draw);
}

const STATUS_STEPS=['pending','confirmed','shipped','delivered'];
document.getElementById('trackForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.target, msg=document.getElementById('trackMsg'), res=document.getElementById('trackResult');
  msg.innerHTML=''; res.innerHTML='';
  const code=f.code.value.trim(), phone=f.phone.value.trim();
  const {data:t}=await sb.rpc('track_order',{p_code:code,p_phone:phone});
  const order=t&&{status:t.status,subtotal:Number(t.subtotal),address:t.address,city:t.city,created_at:t.created_at,items:{length:t.item_count}};
  if(!order){ msg.innerHTML='<div class="msg err">No order found matching that code and phone number</div>'; return; }
  const idx = STATUS_STEPS.indexOf(order.status);
  res.innerHTML = `
    <div style="margin-bottom:10px"><span class="badge2 s-${order.status}">${order.status}</span></div>
    ${order.status!=='cancelled'?`<div style="display:flex;justify-content:space-between;margin:14px 0">
      ${STATUS_STEPS.map((s,i)=>`<div style="text-align:center;flex:1"><div style="width:20px;height:20px;border-radius:50%;margin:0 auto 4px;background:${i<=idx?'var(--pine)':'var(--line)'}"></div><span style="font-size:.7rem;color:var(--ink-soft)">${s}</span></div>`).join('')}
    </div>`:''}
    <div style="font-size:.87rem;color:var(--ink-soft);line-height:1.7">
      <div>${order.items.length} item(s) — ${fmt(order.subtotal)}</div>
      <div>Deliver to: ${esc(order.address)}${order.city?', '+esc(order.city):''}</div>
      <div>Placed: ${new Date(order.created_at).toLocaleString()}</div>
    </div>`;
});

let st; document.getElementById('searchInput').addEventListener('input',e=>{ clearTimeout(st); st=setTimeout(()=>{ searchTerm=e.target.value.trim(); renderGrid(); },250); });

/* ---------- ADMIN ---------- */
const adminRoot=document.getElementById('adminRoot');
let adminAuthed = false;

function openAdmin(){
  adminRoot.style.display='block';
  if(adminAuthed){ document.getElementById('loginScreen').style.display='none'; document.getElementById('adminShell').style.display='flex'; refreshAdmin(); }
  else { document.getElementById('loginScreen').style.display='flex'; document.getElementById('adminShell').style.display='none'; }
}
/* The admin panel has no public button. Only the owner opens it, by visiting the secret link:  yourwebsite/index.html#ADMIN_KEY
   (change ADMIN_KEY to any word you like). Real protection is still the admin email + password checked by Supabase. */
const ADMIN_KEY = 'owner-ahma-7k2';
function openAdminFromHash(){
  if(location.hash === '#' + ADMIN_KEY){ history.replaceState(null,'',location.pathname+location.search); openAdmin(); }
}
addEventListener('hashchange', openAdminFromHash);
setTimeout(openAdminFromHash, 0);
document.getElementById('backToStore').addEventListener('click',()=>adminRoot.style.display='none');
document.getElementById('adminExit').addEventListener('click',()=>adminRoot.style.display='none');
document.getElementById('adminLogout').addEventListener('click',()=>{ adminAuthed=false; sb.auth.signOut(); DB.orders=[]; openAdmin(); });

document.getElementById('loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target, msg=document.getElementById('loginMsg'); msg.innerHTML='';
  const {error}=await sb.auth.signInWithPassword({email:f.u.value.trim(),password:f.p.value});
  if(error){
    const m=(error.message||'').toLowerCase(); let why='Email ya password ghalat hai.';
    if(m.includes('not confirmed')) why='Is email ki tasdeeq (confirm) nahi hui. Supabase → Authentication → Users mein user ko confirm karein, ya supabase-create-admin.sql chalayen.';
    else if(m.includes('database error')||error.status>=500) why='Supabase ke server par masla aaya ('+esc(error.message)+'). supabase-create-admin.sql dobara chalayen.';
    else if(m.includes('failed to fetch')||m.includes('network')) why='Internet ya Supabase se connection nahi ho raha. Dobara koshish karein.';
    msg.innerHTML='<div class="msg err">'+why+'</div>'; return;
  }
  const {data:ok,error:adminErr}=await sb.rpc('is_admin');
  if(adminErr){ await sb.auth.signOut(); msg.innerHTML='<div class="msg err">Login theek hai, lekin database setup poora nahi (is_admin function nahi mila). supabase-create-admin.sql chalayen.</div>'; return; }
  if(!ok){ await sb.auth.signOut(); msg.innerHTML='<div class="msg err">Login theek hai, lekin yeh email admin list mein nahi hai. supabase-create-admin.sql mein apni email likh kar chalayen.</div>'; return; }
  adminAuthed=true; f.reset(); openAdmin();
});

document.querySelectorAll('.nitem[data-tab]').forEach(item=>{
  item.addEventListener('click',()=>{
    document.querySelectorAll('.nitem[data-tab]').forEach(i=>i.classList.remove('on')); item.classList.add('on');
    ['dash','prod','cat','ord','pay','cust','subs'].forEach(t=>document.getElementById('tab-'+t).style.display = t===item.dataset.tab?'block':'none');
  });
});

async function refreshAdmin(){ await loadOrders(); renderStats(); renderCatAdmin(); renderProdAdmin(); renderOrdAdmin(); renderCustAdmin(); loadSubscribers(); }

/* ===== Newsletter subscribers (admin) ===== */
async function loadSubscribers(){
  const body=document.getElementById('subsBody'); if(!body) return;
  const r=await sb.from('newsletter_subscribers').select('*').order('created_at',{ascending:false});
  if(r.error){
    console.error(r.error); window._subsList=[];
    body.innerHTML='<tr><td colspan="3" style="color:var(--ink-soft);white-space:normal">Could not load subscribers ('+esc(r.error.message||'')+'). Run <b>supabase-newsletter.sql</b> in the Supabase SQL Editor once.</td></tr>';
    return;
  }
  window._subsList=r.data;
  body.innerHTML=r.data.length ? r.data.map(s=>`
    <tr><td>${esc(s.email)}</td>
    <td>${s.created_at?new Date(s.created_at).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}):'—'}</td>
    <td><button class="sm" onclick="deleteSubscriber(${Number(s.id)})">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="3" style="color:var(--ink-soft)">No subscribers yet.</td></tr>';
}
async function deleteSubscriber(id){
  if(!confirm('Remove this subscriber?')) return;
  const r=await sb.from('newsletter_subscribers').delete().eq('id',id);
  if(r.error){ alert(r.error.message); return; }
  loadSubscribers();
}
function exportSubscribers(){
  const list=window._subsList||[]; if(!list.length){ alert('No subscribers to export yet.'); return; }
  const csv='email,subscribed_at\n'+list.map(s=>'"'+String(s.email).replace(/"/g,'""')+'",'+(s.created_at||'')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='ahmamart-subscribers.csv'; document.body.appendChild(a); a.click(); a.remove();
}
(function(){ const b=document.getElementById('subsExport'); if(b) b.addEventListener('click',exportSubscribers); })();

function renderStats(){
  const totalProducts = DB.products.length;
  const totalOrders = DB.orders.length;
  const pending = DB.orders.filter(o=>o.status==='pending').length;
  const revenue = DB.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+o.subtotal,0);
  document.getElementById('statGrid').innerHTML = `
    <div class="stat"><div class="n">${totalProducts}</div><div class="l">Products</div></div>
    <div class="stat"><div class="n">${totalOrders}</div><div class="l">Total orders</div></div>
    <div class="stat"><div class="n">${pending}</div><div class="l">Pending orders</div></div>
    <div class="stat"><div class="n">${fmt(revenue)}</div><div class="l">Revenue</div></div>`;
  const low = [];   /* products without variants: product stock; products with variants: each low variant */
  DB.products.forEach(p=>{ if(hasVariants(p)) variantsOf(p).forEach(v=>{ if(Number(v.stock)<=5) low.push({name:p.name+' ('+vLabel(v)+')', stock:v.stock}); }); else if(p.stock<=5) low.push({name:p.name, stock:p.stock}); });
  document.getElementById('lowStockBody').innerHTML = low.length? low.map(p=>`<tr><td>${esc(p.name)}</td><td>${p.stock}</td></tr>`).join('') : `<tr><td colspan="2" style="color:var(--ink-soft)">Nothing low on stock.</td></tr>`;
}

async function compressCategoryImage(file){
  if(!file) return null;
  if(!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  if(file.size > 12*1024*1024) throw new Error('Please choose an image smaller than 12 MB.');
  if(!('createImageBitmap' in window)) return file;
  const bmp=await createImageBitmap(file);
  const max=900, scale=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bmp.width*scale)); canvas.height=Math.max(1,Math.round(bmp.height*scale));
  const ctx=canvas.getContext('2d'); ctx.drawImage(bmp,0,0,canvas.width,canvas.height); bmp.close?.();
  return await new Promise(resolve=>canvas.toBlob(blob=>resolve(blob||file),'image/jpeg',.82));
}
async function uploadCategoryImage(file){
  const blob=await compressCategoryImage(file);
  if(!blob) return null;
  const path='categories/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.jpg';
  const up=await sb.storage.from('product-images').upload(path,blob,{contentType:'image/jpeg',cacheControl:'31536000',upsert:false});
  if(up.error) throw up.error;
  return sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
}
/* Categories as a flat list in tree order: [{c, depth}] */
function catTreeList(){
  const out=[], seen=new Set();
  const walk=(list,depth)=>list.forEach(c=>{ if(seen.has(Number(c.id))) return; seen.add(Number(c.id)); out.push({c,depth}); walk(catChildren(c.id),depth+1); });
  walk(catRoots(),0);
  return out;
}
const SUBCAT_SQL_MSG = 'Sub-categories ke liye pehle Supabase me "supabase-subcategories.sql" chalayen (SQL Editor me paste karke Run), phir dobara koshish karein.';
function catErrMsg(err, fallback){
  const m = (err && err.message) || '';
  if(/parent_id/i.test(m)) return SUBCAT_SQL_MSG;
  if(/image_url|column/i.test(m)) return 'Category picture support needs an image_url column in your Supabase categories table. Run the SQL instructions provided with this update, then try again.';
  return m || fallback;
}
function renderCatAdmin(){
  const tree = catTreeList();
  const prodCount = id => DB.products.filter(p=>Number(p.category_id)===Number(id)).length;
  document.getElementById('catBody').innerHTML = tree.map(({c,depth})=>{
    const kids = catChildren(c.id).length, n = prodCount(c.id), id = Number(c.id);
    return `<tr>
    <td>${c.image_url?`<img class="cb-upload-img" loading="lazy" src="${esc(c.image_url)}" alt="">`:'—'}</td>
    <td><div class="cat-tree-name" style="padding-left:${depth*22}px">${depth?'<span class="cat-branch" aria-hidden="true">└</span>':''}<b>${esc(c.name)}</b> <small class="cat-meta">${n} product${n===1?'':'s'}${kids?` · ${kids} sub-categor${kids===1?'y':'ies'}`:''}</small></div></td>
    <td style="display:flex;gap:6px;flex-wrap:wrap">
    <button class="sm" type="button" onclick="addSubCat(${id})">+ Sub-category</button>
    <button class="sm" type="button" onclick="changeCatImage(${id})">Change picture</button>
    <button class="sm" type="button" onclick="renameCat(${id})">Rename</button>
    <button class="sm" type="button" onclick="moveCat(${id})">Move</button>
    <button class="sm dg" type="button" onclick="deleteCat(${id})">Delete</button></td></tr>`;
  }).join('') || '<tr><td colspan="3" style="color:var(--ink-soft)">No categories yet. Add your first one above (e.g. Men).</td></tr>';
  const opts = tree.map(({c})=>`<option value="${c.id}">${esc(catPathName(c.id))}</option>`).join('');
  document.getElementById('catSelect').innerHTML = '<option value="">Uncategorized</option>' + opts;
  const ps = document.getElementById('catParentSelect');
  if(ps){ const keep = ps.value; ps.innerHTML = '<option value="">— Main category (top level) —</option>' + opts; ps.value = keep; }
  /* warn if the parent_id column has not been added in Supabase yet */
  const tbl = document.getElementById('catBody').closest('table');
  let note = document.getElementById('catSqlNote');
  if(!note){ note = document.createElement('div'); note.id = 'catSqlNote'; tbl.before(note); }
  note.innerHTML = (DB.categories.length && !('parent_id' in DB.categories[0])) ? `<div class="msg err" style="margin-bottom:12px">${esc(SUBCAT_SQL_MSG)}</div>` : '';
}
document.getElementById('catForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target, button=f.querySelector('button[type="submit"]');
  button.disabled=true; button.textContent='Saving…';
  try{
    const name=f.name.value.trim(); let image_url=null;
    if(f.image.files[0]) image_url=await uploadCategoryImage(f.image.files[0]);
    const payload={name}; if(image_url) payload.image_url=image_url;
    const parent=f.parent_id.value; if(parent) payload.parent_id=Number(parent);
    const r=await sb.from('categories').insert(payload);
    if(r.error) throw r.error;
    f.reset(); f.parent_id.value = parent;   /* keep the parent selected so several sub-categories can be added quickly */
    await loadPublic(); renderCatAdmin(); renderChips(); renderGrid();
    f.parent_id.value = parent;
  }catch(err){
    console.error(err);
    alert(catErrMsg(err,'Could not save category.'));
  }finally{button.disabled=false;button.textContent='Add category';}
});
/* "+ Sub-category" on a row: pre-select that category as the parent in the add form */
function addSubCat(id){
  const f=document.getElementById('catForm'); f.parent_id.value=String(id);
  f.scrollIntoView({behavior:'smooth',block:'center'}); f.name.focus();
}
/* Move a category under another parent (or back to top level) */
const catMoveModal=document.getElementById('catMoveModal');
function moveCat(id){
  const c=catById(id); if(!c) return;
  const banned=new Set(catDescendantIds(id));   /* cannot move a category into itself or its own children */
  const f=document.getElementById('catMoveForm');
  f.id.value=id;
  document.getElementById('catMoveTitle').textContent='Move “'+c.name+'”';
  document.getElementById('catMoveMsg').innerHTML='';
  document.getElementById('catMoveSelect').innerHTML='<option value="">— Main category (top level) —</option>'+catTreeList().filter(({c:x})=>!banned.has(Number(x.id))).map(({c:x})=>`<option value="${x.id}">${esc(catPathName(x.id))}</option>`).join('');
  document.getElementById('catMoveSelect').value=catParentId(c)==null?'':String(catParentId(c));
  openM(catMoveModal);
}
document.getElementById('catMoveClose').addEventListener('click',()=>closeM(catMoveModal));
document.getElementById('catMoveForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target, id=Number(f.id.value), pv=f.parent_id.value;
  const btn=f.querySelector('button[type=submit]'); btn.disabled=true;
  try{
    const r=await sb.from('categories').update({parent_id:pv?Number(pv):null}).eq('id',id);
    if(r.error) throw r.error;
    closeM(catMoveModal); await loadPublic(); renderCatAdmin(); renderProdAdmin(); renderChips(); renderGrid();
  }catch(err){ console.error(err); document.getElementById('catMoveMsg').innerHTML='<div class="msg err">'+esc(catErrMsg(err,'Could not move category.'))+'</div>'; }
  finally{ btn.disabled=false; }
});
async function changeCatImage(id){
  const c=DB.categories.find(x=>Number(x.id)===Number(id)); if(!c) return;
  const picker=document.createElement('input'); picker.type='file'; picker.accept='image/*';
  picker.onchange=async()=>{
    const file=picker.files?.[0]; if(!file) return;
    try{
      const image_url=await uploadCategoryImage(file);
      const r=await sb.from('categories').update({image_url}).eq('id',id);
      if(r.error) throw r.error;
      await loadPublic(); renderCatAdmin(); renderGrid();
    }catch(err){console.error(err);alert(/image_url|column/i.test(err.message||'')?'Category picture support needs an image_url column in your Supabase categories table. Run the SQL instructions provided with this update, then try again.':(err.message||'Could not update category picture.'));}
  };
  picker.click();
}
async function renameCat(id){
  const c=DB.categories.find(x=>Number(x.id)===Number(id)); if(!c) return;
  const name=prompt('Category name:',c.name); if(name===null||!name.trim()) return;
  const r=await sb.from('categories').update({name:name.trim()}).eq('id',id);
  if(r.error){alert(r.error.message);return;}
  await loadPublic();renderCatAdmin();renderChips();renderGrid();
}
async function deleteCat(id){ if(catHasChildren(id)){ alert('Is category ke andar sub-categories hain. Pehle unhein delete karein ya "Move" se kisi aur category me bhej dein, phir delete karein.'); return; } if(!confirm('Delete this category?')) return; const r=await sb.from('categories').delete().eq('id',id); if(r.error){ alert(r.error.message); return; } await loadPublic(); renderCatAdmin(); renderChips(); renderGrid(); }

function renderProdAdmin(){
  document.getElementById('prodBody').innerHTML = DB.products.map(p=>`
    <tr><td>${p.image_url?`<img loading="lazy" src="${p.image_url}" style="width:32px;height:32px;border-radius:6px;object-fit:cover">`:''}</td>
      <td>${p.name}${hasVariants(p)?`<div style="font-size:.74rem;color:var(--ink-soft)">${variantsOf(p).length} variants</div>`:''}</td><td>${catPathName(p.category_id)||'—'}</td><td>${fmt(p.price)}</td><td>${pStock(p)}</td>
      <td style="display:flex;gap:6px"><button class="sm" onclick='editProd(${p.id})'>Edit</button><button class="sm dg" onclick="deleteProd(${p.id})">Delete</button></td></tr>`).join('');
}
const prodModal=document.getElementById('prodModal');
/* ===== Extra (gallery) photos ===== */
let extraImages = []; // {url} for already-saved ones, {blob, previewUrl} for newly picked ones
function renderExtraThumbs(){
  const wrap = document.getElementById('extraThumbs');
  wrap.innerHTML = extraImages.map((im,i)=>`
    <div style="position:relative;width:60px;height:60px;flex:none">
      <img src="${im.url||im.previewUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--line)">
      <button type="button" data-i="${i}" class="img-remove-btn" style="width:20px;height:20px;font-size:.7rem;top:-6px;right:-6px">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('button[data-i]').forEach(b=>b.addEventListener('click',()=>{ extraImages.splice(Number(b.dataset.i),1); renderExtraThumbs(); }));
}
document.getElementById('extraFileInput').addEventListener('change', function(){
  const files=[...this.files]; this.value='';
  for(const file of files){
    if(!file.type.startsWith('image/') || file.size>15*1024*1024) continue;
    compressImage(file, blob=>{ extraImages.push({blob, previewUrl:URL.createObjectURL(blob)}); renderExtraThumbs(); });
  }
});
/* ===== Variants (admin product form) =====
   varRows: one entry per Size/Colour combination: {id (if already saved), options:[{n,v}], stock} */
let varRows = [];
const varKey = o => JSON.stringify(o.map(x=>[x.n,x.v]));
const splitVals = s => [...new Set(String(s||'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean))];
function varOptionInputs(){
  return [1,2,3].map(i=>({ n:(document.getElementById('varName'+i).value.trim() || ['Size','Colour','Option 3'][i-1]), vals:splitVals(document.getElementById('varVals'+i).value) })).filter(o=>o.vals.length);
}
function varFillInputs(rows){
  const names = vOptionNames(rows);
  [1,2,3].forEach(i=>{ const n=names[i-1]; document.getElementById('varName'+i).value = n||''; document.getElementById('varVals'+i).value = n ? vOptionValues(rows,n).join(', ') : ''; });
}
function varSyncStock(){
  const f = document.getElementById('prodForm'), has = varRows.length>0;
  f.stock.readOnly = has; document.getElementById('stockNote').style.display = has ? 'block' : 'none';
  if(has) f.stock.value = varRows.reduce((s,r)=>s+(parseInt(r.stock,10)||0),0);
}
function renderVarRows(){
  const tb = document.getElementById('varBody'), tbl = document.getElementById('varTable');
  tbl.style.display = varRows.length ? '' : 'none';
  tb.innerHTML = varRows.map((r,i)=>`<tr><td>${esc(r.options.map(o=>o.v).join(' / '))}</td>
    <td><input type="number" min="0" step="1" value="${Number(r.stock)||0}" data-i="${i}" class="var-stock"></td>
    <td><button type="button" class="sm dg var-rm" data-i="${i}" title="Remove this variant">✕</button></td></tr>`).join('');
  tb.querySelectorAll('.var-stock').forEach(inp=>inp.addEventListener('input',()=>{ varRows[Number(inp.dataset.i)].stock = Math.max(0, parseInt(inp.value,10)||0); varSyncStock(); }));
  tb.querySelectorAll('.var-rm').forEach(b=>b.addEventListener('click',()=>{ varRows.splice(Number(b.dataset.i),1); renderVarRows(); }));
  varSyncStock();
}
function varGenerate(){
  const opts = varOptionInputs();
  if(new Set(opts.map(o=>o.n.toLowerCase())).size !== opts.length){ alert('Har option ka naam alag hona chahiye (jaise Size aur Colour).'); return; }
  if(!opts.length){ varRows = []; renderVarRows(); return; }
  let combos = [[]];
  opts.forEach(o=>{ const next=[]; combos.forEach(c=>o.vals.forEach(v=>next.push(c.concat([{n:o.n,v}])))); combos = next; });
  if(combos.length > 100){ alert('Bohat zyada combinations ('+combos.length+'). Maximum 100 variants.'); return; }
  const old = new Map(varRows.map(r=>[varKey(r.options),r]));   /* keep stock/id of combinations that already exist */
  varRows = combos.map(c=>old.get(varKey(c)) || {options:c, stock:0});
  renderVarRows();
}
document.getElementById('varGen').addEventListener('click', varGenerate);
document.getElementById('newProdBtn').addEventListener('click',()=>{
  document.getElementById('prodForm').reset(); document.querySelector('#prodForm [name=id]').value='';
  document.getElementById('prodModalTitle').textContent='Add product'; document.getElementById('prodMsg').innerHTML='';
  clearImage(); switchImgTab('upload'); document.getElementById('imgFinalUrl').value='';
  extraImages = []; renderExtraThumbs();
  varRows = []; varFillInputs([]); renderVarRows();
  openM(prodModal);
});
document.getElementById('prodModalClose').addEventListener('click',()=>closeM(prodModal));
document.getElementById('pdClose').addEventListener('click',()=>closeM(document.getElementById('productDetailOverlay')));
document.getElementById('custDetailClose').addEventListener('click',()=>closeM(document.getElementById('custDetailOverlay')));
function editProd(id){
  const p = DB.products.find(p=>p.id===id); const f=document.getElementById('prodForm');
  f.id.value=p.id; f.name.value=p.name; f.description.value=p.description||''; f.category_id.value=p.category_id||'';
  f.price.value=p.price; f.compare_at_price.value=p.compare_at_price||''; f.stock.value=p.stock;
  // load image
  clearImage();
  const img = p.image_url||'';
  document.getElementById('imgFinalUrl').value = img;
  if(img){
    if(img.includes('/product-images/')){
      // uploaded base64
      switchImgTab('upload');
      document.getElementById('imgPreview').src = img;
      document.getElementById('imgPreviewWrap').style.display='block';
      document.getElementById('imgUploadArea').style.display='none';
    } else {
      // URL
      switchImgTab('url');
      document.getElementById('imgUrlInput').value = img;
      document.getElementById('imgUrlPreview').src = img;
      document.getElementById('imgUrlPreviewWrap').style.display='block';
    }
  }
  extraImages = (DB.images[p.id]||[]).map(r=>({url:r.image_url})); renderExtraThumbs();
  varRows = variantsOf(p).map(v=>({id:v.id, options:(v.options||[]).map(o=>({n:o.n,v:o.v})), stock:Number(v.stock)||0}));
  varFillInputs(varRows); renderVarRows();
  document.getElementById('prodModalTitle').textContent='Edit product'; document.getElementById('prodMsg').innerHTML=''; openM(prodModal);
}
document.getElementById('prodForm').addEventListener('submit',async e=>{
  e.preventDefault(); const f=e.target, pm=document.getElementById('prodMsg');
  let finalImg = document.getElementById('imgFinalUrl').value.trim();
  const urlTab = document.getElementById('imgPanelUrl').style.display!=='none';
  if(urlTab){ const typed=document.getElementById('imgUrlInput').value.trim(); if(typed) finalImg=typed; }
  const data = { name:f.name.value.trim(), description:f.description.value.trim(), category_id:f.category_id.value?Number(f.category_id.value):null,
    price:parseFloat(f.price.value), compare_at_price:f.compare_at_price.value?parseFloat(f.compare_at_price.value):null,
    stock:parseInt(f.stock.value,10), image_url: finalImg };
  if(!data.name || isNaN(data.price)){ pm.innerHTML='<div class="msg err">Name and price are required</div>'; return; }
  if(varRows.length) data.stock = varRows.reduce((s,r)=>s+(parseInt(r.stock,10)||0),0);   /* product stock = total of its variants */
  if(isNaN(data.stock) || data.stock<0){ pm.innerHTML='<div class="msg err">Stock must be 0 or more</div>'; return; }
  const btn=f.querySelector('button[type=submit]'); btn.disabled=true; pm.innerHTML='<div class="msg">Saving…</div>';
  try{
    if(pendingBlob && !urlTab){
      const path=Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.jpg';
      const up=await sb.storage.from('product-images').upload(path,pendingBlob,{contentType:'image/jpeg',cacheControl:'31536000'});
      if(up.error) throw up.error;
      data.image_url=sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
    }
    const r = f.id.value
      ? await sb.from('products').update(data).eq('id',Number(f.id.value)).select('id').single()
      : await sb.from('products').insert(data).select('id').single();
    if(r.error) throw r.error;
    const productId = r.data.id;

    // Upload any newly-picked extra photos, then replace this product's gallery rows
    pm.innerHTML = '<div class="msg">Uploading photos…</div>';
    const finalExtraUrls = [];
    for(const im of extraImages){
      if(im.url){ finalExtraUrls.push(im.url); continue; }
      const path = Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.jpg';
      const up = await sb.storage.from('product-images').upload(path, im.blob, {contentType:'image/jpeg',cacheControl:'31536000'});
      if(up.error) throw up.error;
      finalExtraUrls.push(sb.storage.from('product-images').getPublicUrl(path).data.publicUrl);
    }
    const delR = await sb.from('product_images').delete().eq('product_id', productId);
    if(delR.error) throw delR.error;
    if(finalExtraUrls.length){
      const rows = finalExtraUrls.map((image_url,sort_order)=>({product_id:productId, image_url, sort_order}));
      const insR = await sb.from('product_images').insert(rows);
      if(insR.error) throw insR.error;
    }

    // Variants: remove deleted ones, update existing ones (ids are kept), insert new ones
    const curV = await sb.from('product_variants').select('id').eq('product_id', productId);
    if(curV.error){
      if(varRows.length) throw new Error('Variants save nahin ho sakay. Pehle Supabase SQL Editor me supabase-variants.sql chalayen. ('+curV.error.message+')');
    } else {
      pm.innerHTML = '<div class="msg">Saving variants…</div>';
      const keep = new Set(varRows.filter(r=>r.id).map(r=>r.id));
      const del = curV.data.map(x=>x.id).filter(id=>!keep.has(id));
      if(del.length){ const d = await sb.from('product_variants').delete().in('id', del); if(d.error) throw d.error; }
      for(const [i,r] of varRows.entries()){
        if(!r.id) continue;
        const u = await sb.from('product_variants').update({options:r.options, stock:parseInt(r.stock,10)||0, sort_order:i}).eq('id', r.id);
        if(u.error) throw u.error;
      }
      const fresh = varRows.map((r,i)=>({r,i})).filter(x=>!x.r.id).map(x=>({product_id:productId, options:x.r.options, stock:parseInt(x.r.stock,10)||0, sort_order:x.i}));
      if(fresh.length){ const ins = await sb.from('product_variants').insert(fresh); if(ins.error) throw ins.error; }
    }
  }catch(err){ pm.innerHTML=`<div class="msg err">${esc(err.message||err)}</div>`; btn.disabled=false; return; }
  btn.disabled=false; pm.innerHTML=''; pendingBlob=null; extraImages=[]; closeM(prodModal);
  await loadPublic(); renderProdAdmin(); renderStats(); renderGrid();
});
async function deleteProd(id){ if(!confirm('Remove this product?')) return; const r=await sb.from('products').delete().eq('id',id); if(r.error){ alert(r.error.message); return; } await loadPublic(); renderProdAdmin(); renderStats(); renderGrid(); }

function samePhone(a,b){ const n=x=>String(x||'').replace(/\D/g,'').slice(-10); return n(a).length>=7 && n(a)===n(b); }
/* ===== STORE CONFIG ===== */
const STORE_WA = '923296063123';
/* ===== ADVANCE PAYMENT DETAILS =====
   Add your own accounts here; they appear on the order confirmation screen.
   Example: {label:'JazzCash', title:'Account holder name', number:'03XX XXXXXXX'}
   Leave the list empty to tell customers you will send payment details on WhatsApp. */
const PAYMENT = { methods: [
  {label:'JazzCash', title:'Muhammad Ahmad', number:'0329 6063123'},
  {label:'EasyPaisa', title:'Muhammad Ahmad', number:'0329 6063123'},
  {label:'SadaPay', title:'Muhammad Ahmad', number:'0329 6063123'}
], note:'',
  /* Cash on Delivery: only for orders up to maxTotal (Rs.). Keep the same number in supabase-payment-methods.sql */
  cod:{ enabled:true, maxTotal:3000 },
  /* Online gateway (PayFast: cards + JazzCash + EasyPaisa). Keep enabled:false until PAYMENTS-SETUP.md is done. */
  gateway:{ enabled:false, label:'Card / JazzCash / EasyPaisa (online)', fn:'payfast-create' } };
(function(){ const t = fmt(PAYMENT.cod.maxTotal); document.querySelectorAll('[data-cod-max]').forEach(e=>{ e.textContent = t; }); })();
function fillPayInstr(code, total, pay){
  const _pi = document.getElementById('payInstr');
  if(pay.mode==='cod'){ _pi.innerHTML = `<div class="pi-h">✅ Order placed — Cash on Delivery</div><div class="pi-t">Please keep <b>${fmt(total)}</b> ready and pay the courier when your parcel arrives.</div><div class="pi-n">We may call or WhatsApp you to confirm the order before dispatch, so please keep your phone reachable.</div>`; return; }
  if(pay.mode==='online'){ _pi.innerHTML = `<div class="pi-h">⚠️ Online payment not completed</div><div class="pi-t">Your order <b>${esc(code)}</b> is saved, but the payment page could not be opened.</div><div class="pi-n">Please message us on WhatsApp with your order code and we will help you pay.</div>`; return; }
  document.getElementById('payInstr').innerHTML =
    `<div class="pi-h">✅ Payment details received</div>` +
    `<div class="pi-t">${fmt(total)} via <b>${esc(pay.method)}</b> · TID <b>${esc(pay.tid)}</b></div>` +
    (pay.proofPath
      ? `<div class="pi-n">Your payment screenshot has been received. We will verify your payment and dispatch your order.</div>`
      : `<div class="pi-n">Please send your payment screenshot on WhatsApp with order code <b>${esc(code)}</b> using the button below, so we can verify your payment and dispatch your order.</div>`);
}
     // store WhatsApp number (owner receives orders here)

/* ===== Footer info pages ===== */
document.getElementById('footYear').textContent = new Date().getFullYear();
/* Newsletter: email is saved in Supabase (table newsletter_subscribers) via subscribe_newsletter().
   Run supabase-newsletter.sql once. If it was not run, we say so honestly instead of pretending to subscribe. */
const newsletterForm=document.getElementById('newsletterForm');
if(newsletterForm) newsletterForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const input=document.getElementById('newsletterEmail'), msg=document.getElementById('newsletterMsg'), btn=newsletterForm.querySelector('button[type=submit]');
  const email=input.value.trim();
  btn.disabled=true; const oldLabel=btn.textContent; btn.textContent='Please wait…';
  try{
    const {error}=await sb.rpc('subscribe_newsletter',{p_email:email});
    if(error){
      console.error(error);
      msg.textContent=/BAD_EMAIL/.test(error.message||'') ? 'Please enter a valid email address.' : 'Sorry, we could not sign you up right now. Please try again later.';
    } else {
      msg.textContent='Thank you! You are subscribed to AhmaMart updates.';
      newsletterForm.reset();
    }
  }catch(err){
    console.error(err);
    msg.textContent='Could not connect. Please check your internet and try again.';
  }finally{
    btn.disabled=false; btn.textContent=oldLabel;
  }
});
const INFO_PAGES = {
  about: { title:'About Us', html:`
    <p>AhmaMart is an online store bringing everyday essentials to your doorstep, right here in Pakistan.</p>
    <p>We believe shopping should be simple and reliable — browse, order, pay in advance (or on delivery for small orders), and we deliver to your door.</p>
    <p>We're based in Usmanwala, Kasur, Punjab, and we're growing every day thanks to customers like you.</p>` },
  faq: { title:'Frequently Asked Questions', html:`
    <p><strong>How do I place an order?</strong><br>Add items to your cart, go to checkout, and fill in your name, phone number, and address. No account or card needed.</p>
    <p><strong>How does payment work?</strong><br>You can pay in advance — send the amount to our JazzCash, EasyPaisa or SadaPay account, then add the transaction ID and your payment screenshot at checkout — and we process your order once the payment is confirmed. For small orders (up to ${fmt(PAYMENT.cod.maxTotal)}) you can also choose <b>Cash on Delivery</b> and pay the courier when your parcel arrives.</p>
    <p><strong>How long does delivery take?</strong><br>Most orders arrive within 2–5 business days, depending on your city.</p>
    <p><strong>How do I track my order?</strong><br>Use "Track order" or "My orders" at the top of the site with your order code and phone number.</p>
    <p><strong>Can I cancel my order?</strong><br>Yes, as long as it hasn't been dispatched yet. Contact us with your order code and we'll help right away.</p>` },
  contact: { title:'Contact Us', html:`
    <p>We'd love to hear from you — questions, order help, or feedback, reach out any time.</p>
    <p>📧 Email: <a href="mailto:helloahmamar@gmail.com" style="color:var(--gold)">helloahmamar@gmail.com</a></p>
    <p>📞 Phone: <a href="tel:03296063123" style="color:var(--gold)">0329 6063123</a></p>
    <p>💬 WhatsApp: <a href="https://wa.me/923296063123" target="_blank" rel="noopener" style="color:var(--gold)">Chat with us</a></p>
    <p>📍 Address: Usmanwala, Kasur, Punjab, Pakistan</p>` },
  shipping: { title:'Shipping Policy', html:`
    <p>We currently deliver across Pakistan. Advance-payment orders are dispatched after your payment is confirmed; Cash on Delivery orders are dispatched once we have confirmed the order with you.</p>
    <p><strong>Delivery time:</strong> typically 2–5 business days from when your order is confirmed, depending on your city and courier availability.</p>
    <p><strong>Delivery charges:</strong> any delivery fee, if applicable, is shown clearly at checkout before you confirm your order.</p>
    <p><strong>Order confirmation:</strong> you'll receive an order code right after checkout — keep it along with your phone number to track your delivery.</p>
    <p>If your order is delayed beyond the expected window, contact us with your order code and we'll look into it right away.</p>` },
  refund: { title:'Return, Refund & Cancellation', html:`
    <p><strong>Cancellations:</strong> you can cancel your order any time before it's dispatched by contacting us with your order code.</p>
    <p><strong>Returns:</strong> if an item arrives damaged, incorrect, or not as described, let us know within 3 days of delivery with your order code and a photo of the item, and we'll arrange a replacement or refund.</p>
    <p><strong>Refunds:</strong> for orders paid in advance or online, approved refunds are processed via bank transfer or mobile wallet to the details you provide — we'll confirm the method with you directly. Approved refunds on Cash on Delivery orders are handled the same way.</p>
    <p>Items must be unused and in their original packaging to be eligible for return, unless the issue is a defect or wrong item received.</p>` },
  privacy: { title:'Privacy Policy', html:`
    <p>We collect only the information needed to process your order: your name, phone number, and delivery address.</p>
    <p>If you choose to create an optional account, we also store your email address (and the name and phone number you give us) so we can sign you in and pre-fill your details at checkout. You can always shop as a guest instead.</p>
    <p>This information is used solely to fulfil and deliver your order, contact you if there's an issue with your order.</p>
    <p>We do not sell or share your personal information with third parties, other than the courier needed to deliver your package.</p>
    <p>If you have any questions about how your information is handled, contact us at <a href="mailto:helloahmamar@gmail.com" style="color:var(--gold)">helloahmamar@gmail.com</a>.</p>` },
  terms: { title:'Terms of Service', html:`
    <p>By placing an order on AhmaMart, you agree to provide accurate name, phone number, and address so your order can be delivered successfully.</p>
    <p>Prices and product availability are subject to change without prior notice. We'll always confirm your order total before delivery.</p>
    <p>Payment is made either (a) in advance, in full, using the payment details we share with you or our online payment option — orders are dispatched once your payment is confirmed — or (b) in cash to the courier on delivery, available only on orders up to ${fmt(PAYMENT.cod.maxTotal)}.</p>
    <p>For any disputes or questions, please reach out to us directly before taking any other action — we're happy to help.</p>` }
};
const infoOverlay = document.getElementById('infoOverlay');
function openInfo(key){ if(INFO_FILES[key]) location.href = INFO_FILES[key]; }
document.querySelectorAll('[data-info]').forEach(b=>b.addEventListener('click',()=>openInfo(b.dataset.info)));
document.getElementById('infoClose').addEventListener('click',()=>closeM(infoOverlay));

function itemsSummary(items){
  if(!Array.isArray(items) || !items.length) return '—';
  return `<div class="order-items-list">${items.map(it=>{
    // Prefer an image saved with the order item; for older orders, match the
    // item to the current product catalog by ID or name.
    const match = DB.products.find(p =>
      (it.product_id != null && String(p.id) === String(it.product_id)) ||
      (it.productId != null && String(p.id) === String(it.productId)) ||
      (it.id != null && String(p.id) === String(it.id)) ||
      (it.name && p.name && String(p.name).trim().toLowerCase() === String(it.name).trim().toLowerCase())
    );
    const image = it.image_url || it.image || it.imageUrl || match?.image_url || '';
    const imageMarkup = image
      ? `<img class="order-item-thumb" src="${esc(image)}" alt="${esc(it.name||'Product')}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex'"><span class="order-item-placeholder" style="display:none" aria-label="No image">📦</span>`
      : `<span class="order-item-placeholder" aria-label="No image">📦</span>`;
    return `<span class="order-item-chip">${imageMarkup}<span class="order-item-label">${esc(it.name||'Product')} ×${esc(it.qty??1)}</span></span>`;
  }).join('')}</div>`;
}

/* ----- payment screenshot (required before the order is placed) ----- */
function shotCompress(file, ok, fail){
  const r = new FileReader();
  r.onerror = fail;
  r.onload = e=>{
    const img = new Image();
    img.onerror = fail;
    img.onload = ()=>{
      const M = 1400; let w = img.width, h = img.height;
      if(w > M || h > M){ const k = Math.min(M/w, M/h); w = Math.round(w*k); h = Math.round(h*k); }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0,0,w,h); x.drawImage(img,0,0,w,h);
      c.toBlob(b=> b ? ok(b) : fail(), 'image/jpeg', .85);
    };
    img.src = e.target.result;
  };
  r.readAsDataURL(file);
}
function clearShot(){
  window._shotBlob = null;
  const i = document.getElementById('psShot'), p = document.getElementById('psShotPrev'), t = document.getElementById('psShotTxt'), bx = document.getElementById('psShotBox');
  if(i) i.value = ''; if(p){ p.removeAttribute('src'); p.style.display = 'none'; } if(t) t.textContent = '📎 Tap to attach your payment screenshot'; if(bx) bx.classList.remove('ok');
}
function wireShare(anchorId, getText, getFile){
  const a = document.getElementById(anchorId); if(!a) return;
  a.addEventListener('click', e=>{
    const blob = getFile(); if(!blob || !navigator.canShare || !navigator.share) return;
    const file = new File([blob], 'payment-screenshot.jpg', {type:'image/jpeg'});
    if(navigator.canShare({files:[file]})){ e.preventDefault(); navigator.share({files:[file], text:getText()}).catch(()=>{}); }
  });
}
(function(){
  const input = document.getElementById('psShot'); if(!input) return;
  input.addEventListener('change', ()=>{
    const f = input.files[0], m = document.getElementById('psMsg'); if(!f) return;
    if(!f.type.startsWith('image/') || f.size > 15*1024*1024){ m.innerHTML = '<div class="msg err">Please choose an image (JPG or PNG) smaller than 15 MB.</div>'; input.value = ''; return; }
    shotCompress(f, b=>{
      window._shotBlob = b;
      const p = document.getElementById('psShotPrev'); p.src = URL.createObjectURL(b); p.style.display = 'block';
      document.getElementById('psShotTxt').textContent = '✓ Screenshot attached — tap to change';
      document.getElementById('psShotBox').classList.add('ok'); m.innerHTML = '';
    }, ()=>{ m.innerHTML = '<div class="msg err">That image could not be read. Please try another screenshot.</div>'; input.value = ''; });
  });
  wireShare('sendOrderWa', ()=>window._waText||'', ()=>window._waFile);
  wireShare('failWa', ()=>window._failText||'', ()=>window._failFile);
})();
async function uploadProof(blob, phone, tid){
  try{
    const path = 'proofs/' + Date.now() + '_' + String(phone).replace(/\D/g,'') + '_' + tid + '.jpg';
    const up = await sb.storage.from('payment-proofs').upload(path, blob, {contentType:'image/jpeg', cacheControl:'31536000'});
    if(up.error){ console.error('proof upload failed', up.error); return null; }
    return path;
  }catch(e){ console.error('proof upload failed', e); return null; }
}
/* admin: list uploaded payment screenshots */
async function loadProofs(){
  const box = document.getElementById('proofGrid'); if(!box) return;
  box.innerHTML = '<p class="pi-n">Loading…</p>';
  const l = await sb.storage.from('payment-proofs').list('proofs', {limit:60, sortBy:{column:'name', order:'desc'}});
  if(l.error){ box.innerHTML = '<div class="msg err" style="white-space:normal">Could not load payment screenshots ('+esc(l.error.message||'')+'). Run supabase-payment-proofs.sql in Supabase, then use Dashboard → “Run connection check”.</div>'; return; }
  const files = (l.data||[]).filter(x=>x.name && !x.name.startsWith('.'));
  if(!files.length){ box.innerHTML = '<p class="pi-n">No payment screenshots yet.</p>'; return; }
  const paths = files.map(x=>'proofs/'+x.name);
  const u = await sb.storage.from('payment-proofs').createSignedUrls(paths, 3600);
  const urlOf = {}; (u.data||[]).forEach(r=>{ if(r.path) urlOf[r.path] = r.signedUrl; });
  box.innerHTML = files.map(x=>{
    const [ts, ph, tid] = x.name.replace(/\.jpg$/,'').split('_'), url = urlOf['proofs/'+x.name] || '';
    return `<a class="proof" href="${esc(url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url)}" alt="Payment screenshot"><b>${esc(ph||'')}</b><span>TID ${esc(tid||'')}</span><span>${ts?new Date(Number(ts)).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'}):''}</span></a>`;
  }).join('');
}
async function runDiagnostics(){
  const box = document.getElementById('diagBox'); box.innerHTML = '<p class="pi-n">Checking…</p>';
  const rows = [], add = (ok, title, detail, fix)=>rows.push({ok, title, detail, fix});
  try{
    const a = await sb.rpc('is_admin');
    add(!a.error && a.data===true, 'Admin login', a.error ? a.error.message : (a.data ? 'Logged in as admin' : 'This account is not an admin'), 'Log out and log in again with the admin email and password.');
  }catch(e){ add(false, 'Admin login', String(e.message||e), 'Log out and log in again.'); }
  try{
    const o = await sb.from('orders').select('id',{count:'exact',head:true});
    add(!o.error, 'Reading orders', o.error ? o.error.message : (o.count + ' order(s) saved in the database'), 'Run PART A of supabase-fix-orders.sql in the Supabase SQL Editor.');
  }catch(e){ add(false, 'Reading orders', String(e.message||e), 'Run PART A of supabase-fix-orders.sql.'); }
  try{
    /* size / colour ordering: the table must exist and place_order_v3 must be installed (supabase-variants.sql).
       Safe probe: an empty cart is rejected with EMPTY_CART before anything is saved. */
    const vt = await sb.from('product_variants').select('id,product_id,stock');
    if(vt.error){ add(false, 'Size / colour variants', vt.error.message, 'Run supabase-variants.sql in the Supabase SQL Editor.'); }
    else {
      const bad = DB.products.filter(p=>hasVariants(p) && Number(p.stock) !== pStock(p)).length;
      add(true, 'Size / colour variants', vt.data.length + ' variant(s) saved' + (bad ? ' — ' + bad + ' product(s) have an old stock total (fixed automatically when you run supabase-variants.sql again)' : ''));
    }
    const p3 = await sb.rpc('place_order_v3', {p_name:'', p_phone:'', p_email:'', p_address:'', p_city:'', p_items:[], p_payment_method:'advance'});
    const m3 = (p3.error && (p3.error.message||'')) || '';
    const miss3 = !!p3.error && (p3.error.code === 'PGRST202' || /could not find the function/i.test(m3));
    const ok3 = !miss3 && /EMPTY_CART/.test(m3);
    add(ok3, 'Order with size / colour (place_order_v3)', ok3 ? 'Installed and working' : (miss3 ? 'The function is missing in your database' : (m3 || 'Unexpected answer from the function')), 'Run the latest supabase-variants.sql in the Supabase SQL Editor (safe to run again), then refresh this check.');
  }catch(e){ add(false, 'Order with size / colour (place_order_v3)', String(e.message||e), 'Run the latest supabase-variants.sql in the Supabase SQL Editor.'); }
  try{
    // safe probe: correct argument names but empty data, so the function rejects it before saving anything
    const p = await sb.rpc('place_order', {p_name:'', p_phone:'', p_address:'', p_city:'', p_items:[], p_email:''});
    const missing = !!p.error && (p.error.code === 'PGRST202' || /could not find the function/i.test(p.error.message||''));
    const created = !p.error && p.data && p.data.code;
    add(!missing && !created, 'Order function (place_order)', missing ? p.error.message : (created ? 'Unexpected: a test order was created, please delete it in Orders' : 'Installed and working (it correctly rejected an empty test order)'), 'The order function is missing. Run supabase-restore-place-order.sql in the Supabase SQL Editor.');
  }catch(e){ add(false, 'Order function (place_order)', String(e.message||e), 'Run PART B of supabase-fix-orders.sql.'); }
  try{
    const st = await sb.storage.from('payment-proofs').list('proofs',{limit:1});
    add(!st.error, 'Payment screenshots storage', st.error ? st.error.message : 'Ready', 'Run supabase-payment-proofs.sql in the Supabase SQL Editor.');
  }catch(e){ add(false, 'Payment screenshots storage', String(e.message||e), 'Run supabase-payment-proofs.sql.'); }
  box.innerHTML = '<div class="diag-list">' + rows.map(r=>`<div class="diag ${r.ok?'ok':'bad'}"><b>${r.ok?'✔':'✖'} ${esc(r.title)}</b><div>${esc(r.detail||'')}</div>${!r.ok&&r.fix?`<div class="fix">Fix: ${esc(r.fix)}</div>`:''}</div>`).join('') + '</div>';
}
(function(){ const b = document.getElementById('diagBtn'); if(b) b.addEventListener('click', runDiagnostics); })();
(function(){ const t = document.querySelector('.nitem[data-tab="pay"]'); if(t) t.addEventListener('click', loadProofs); })();
/* ----- checkout steps: 1 details -> 2 payment -> 3 receipt ----- */
function payTotal(){ return cart.reduce((t,i)=>{ const p=DB.products.find(x=>x.id===i.id); return t + Number(p?p.price:i.price)*i.qty; },0); }
async function stockProblem(){
  await loadPublic();
  for(const i of cart){
    const p = DB.products.find(x=>x.id===i.id);
    if(!p) return `“${cartName(i)}” is no longer available in the quantity you chose. Please update your cart before paying.`;
    if(hasVariants(p)){
      const v = i.vid ? variantsOf(p).find(x=>x.id===i.vid) : null;
      if(!v || Number(v.stock) < i.qty) return `“${cartName(i)}” is no longer available in the quantity you chose. Please update your cart before paying.`;
    } else if(Number(p.stock) < i.qty) return `“${cartName(i)}” is no longer available in the quantity you chose. Please update your cart before paying.`;
  }
  return '';
}
function showOrderFallback(info){
  const lines = cart.map(i=>`• ${i.qty}× ${cartName(i)} — ${fmt(i.price*i.qty)}`).join('\n');
  const text = `Assalam o Alaikum! ${info.pay.mode==='cod'?'Maine Cash on Delivery order kiya tha lekin website par mera order save nahi hua.':'Maine payment kar di hai lekin website par mera order save nahi hua.'} Meherbani karke order confirm kar dein:\nNaam: ${info.name}\nPhone: ${info.phone}\nEmail: ${info.email}\nAddress: ${info.address}${info.city?', '+info.city:''}\n${lines}\nTotal: ${fmt(payTotal())}\n${info.pay.mode==='cod'?'Payment: Cash on Delivery':'Payment: '+info.pay.method+' — TID '+info.pay.tid+'\n'+(info.pay.proofPath?'Screenshot website par upload ho chuka hai.':'Screenshot is chat mein bhej raha/rahi hoon.')}`;
  window._failText = text; window._failFile = info.pay.file || null;
  document.getElementById('failWa').href = 'https://wa.me/'+STORE_WA+'?text='+encodeURIComponent(text);
  document.getElementById('failDetail').textContent = 'Technical details: ' + (info.err||'');
  closeM(document.getElementById('checkoutOverlay')); showCheckoutStep(1);
  openM(document.getElementById('failOverlay'));
}
function showCheckoutStep(n){
  const pc = document.getElementById('psConfirm'); if(pc){ pc.disabled = false; pc.textContent = payBtnLabel(); }
  const f = document.getElementById('checkoutForm'), ps = document.getElementById('payStep'); if(!f||!ps) return;
  f.style.display = n===1 ? 'block' : 'none'; ps.style.display = n===2 ? 'block' : 'none';
  document.getElementById('coTitle').textContent = n===1 ? 'Delivery details' : 'Payment';
  [...document.getElementById('coSteps').children].forEach((el,i)=>el.classList.toggle('on', i < n));
  if(n===1){ const m=document.getElementById('psMsg'); if(m) m.innerHTML=''; }
}
function copyText(t, btn){
  const done = ()=>{ const o = btn.dataset.o || btn.textContent; btn.dataset.o = o; btn.textContent = 'Copied ✓'; setTimeout(()=>{ btn.textContent = o; }, 1400); };
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
  else { const ta=document.createElement('textarea'); ta.value=t; document.body.appendChild(ta); ta.select(); try{ document.execCommand('copy'); }catch(e){} ta.remove(); done(); }
}
function codAllowed(total){ const c = PAYMENT.cod || {}; return !!c.enabled && total <= Number(c.maxTotal||0); }
function payModes(total){
  const g = PAYMENT.gateway || {}, c = PAYMENT.cod || {}, list = [];
  if(g.enabled) list.push({id:'online', icon:'💳', title:g.label||'Pay online (card / wallet)', sub:'Secure online payment — confirmed automatically', ok:true});
  if(c.enabled) list.push({id:'cod', icon:'💵', title:'Cash on Delivery', ok: total <= Number(c.maxTotal||0),
    sub: total <= Number(c.maxTotal||0) ? 'Pay the courier when your parcel arrives' : 'Only for orders up to '+fmt(c.maxTotal)+' (your order is '+fmt(total)+')'});
  list.push({id:'advance', icon:'📲', title:'Pay in advance (JazzCash / EasyPaisa / SadaPay)', sub:'Send the amount, then add the transaction ID and a screenshot', ok:true});
  return list;
}
function payBtnLabel(){ const m = window._payMode || 'advance'; return m==='cod' ? 'Place order — Cash on Delivery' : m==='online' ? 'Pay online now' : 'I have paid — Place order'; }
function setPayMode(mode){
  window._payMode = mode;
  const ps = document.getElementById('payStep'), manual = mode==='advance';
  const hide = (el, h)=>{ if(el) el.style.display = h ? 'none' : ''; };
  hide(ps.querySelector('.ps-steps'), !manual); hide(document.getElementById('psAccounts'), !manual);
  ['psMethod','psTid'].forEach(id=>hide(document.getElementById(id).closest('.field'), !manual));
  hide(document.getElementById('psShotBox').closest('.field'), !manual);
  hide(document.getElementById('psCopyAmt'), !manual);
  hide(ps.querySelector(':scope > p.pi-n'), !manual);
  const lbl = ps.querySelector('.ps-amount span'); if(lbl) lbl.textContent = mode==='cod' ? 'Amount to pay on delivery' : 'Amount to pay';
  const note = document.getElementById('pmNote');
  note.innerHTML = mode==='cod' ? '<div class="pi-n">Keep the exact amount ready for the courier. We may call or WhatsApp you to confirm the order before dispatch.</div>'
    : mode==='online' ? '<div class="pi-n">You will be taken to a secure payment page (card, JazzCash or EasyPaisa). Your order is confirmed once the payment succeeds.</div>' : '';
  ps.querySelectorAll('.pm-opt').forEach(b=>{ const on = b.dataset.m===mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on?'true':'false'); });
  const pc = document.getElementById('psConfirm'); if(pc && !pc.disabled) pc.textContent = payBtnLabel();
}
function showPayStep(){
  const total = payTotal(), ps = document.getElementById('payStep');
  document.getElementById('psAmt').textContent = fmt(total);
  document.getElementById('psCopyAmt').onclick = e=>copyText(String(Math.round(total)), e.target);
  const ms = PAYMENT.methods || [];
  document.getElementById('psAccounts').innerHTML = ms.length ? ms.map((m,i)=>`<div class="pi-row"><b>${esc(m.label)}</b><span>${esc(m.title||'')}</span><code>${esc(m.number||'')}</code><button type="button" class="copy" data-n="${esc(String(m.number||'').replace(/\s+/g,''))}">Copy</button></div>`).join('')
    : '<div class="pi-n">Please message us on WhatsApp to get the payment details, then enter your transaction ID below.</div>';
  document.getElementById('psAccounts').querySelectorAll('.copy').forEach(b=>b.addEventListener('click',()=>copyText(b.dataset.n, b)));
  document.getElementById('psMethod').innerHTML = ms.map(m=>`<option>${esc(m.label)}</option>`).join('') + '<option>Other</option>';
  document.getElementById('psMsg').innerHTML = '';
  /* payment method chooser */
  let ch = document.getElementById('pmChooser');
  if(!ch){ ch = document.createElement('div'); ch.id = 'pmChooser'; ps.insertBefore(ch, ps.firstChild); }
  if(!document.getElementById('pmNote')){ const n = document.createElement('div'); n.id = 'pmNote'; ps.insertBefore(n, document.getElementById('psMsg')); }
  const list = payModes(total);
  ch.innerHTML = list.length > 1 ? '<div class="pm-h">How would you like to pay?</div>' + list.map(o=>`<button type="button" class="pm-opt" data-m="${o.id}" aria-pressed="false" ${o.ok?'':'disabled'}><span class="pm-i">${o.icon}</span><span class="pm-t"><b>${esc(o.title)}</b><small>${esc(o.sub)}</small></span></button>`).join('') : '';
  ch.querySelectorAll('.pm-opt').forEach(b=>b.addEventListener('click',()=>setPayMode(b.dataset.m)));
  let mode = window._payMode; if(!list.some(o=>o.id===mode && o.ok)) mode = (list.find(o=>o.ok)||{id:'advance'}).id;
  showCheckoutStep(2); setPayMode(mode);
}
(function(){
  const fo = document.getElementById('failOverlay');
  document.getElementById('failClose').addEventListener('click', ()=>closeM(fo));
  document.getElementById('failRetry').addEventListener('click', ()=>{ closeM(fo); openM(document.getElementById('checkoutOverlay')); });
})();
(function(){
  const confirmBtn = document.getElementById('psConfirm'), back = document.getElementById('psBack');
  if(back) back.addEventListener('click', ()=>showCheckoutStep(1));
  if(confirmBtn) confirmBtn.addEventListener('click', async ()=>{
    const pmode = window._payMode || 'advance';
    if(pmode==='cod' || pmode==='online'){
      const m0 = document.getElementById('psMsg');
      if(pmode==='cod' && !codAllowed(payTotal())){ m0.innerHTML = '<div class="msg err">Cash on Delivery sirf '+esc(fmt(PAYMENT.cod.maxTotal))+' tak ke orders par available hai.</div>'; return; }
      m0.innerHTML = ''; confirmBtn.disabled = true; confirmBtn.textContent = pmode==='cod' ? 'Placing your order…' : 'Preparing secure payment…';
      window._pay = pmode==='cod' ? {method:'Cash on Delivery', tid:'—', mode:'cod'} : {method:'Online payment', tid:'—', mode:'online'};
      window._payConfirmed = true;
      document.getElementById('checkoutForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      return;
    }
    const tid = document.getElementById('psTid').value.trim(), method = document.getElementById('psMethod').value, m = document.getElementById('psMsg');
    if(!/^[A-Za-z0-9\-]{6,}$/.test(tid)){ m.innerHTML = '<div class="msg err">Please enter the transaction ID (TID) from your payment, at least 6 characters.</div>'; return; }
    if(!window._shotBlob){ m.innerHTML = '<div class="msg err">Please attach your payment screenshot to place the order.</div>'; return; }
    m.innerHTML = ''; confirmBtn.disabled = true; confirmBtn.textContent = 'Uploading screenshot…';
    const phone = document.querySelector('#checkoutForm [name=phone]').value;
    const proofPath = await uploadProof(window._shotBlob, phone, tid);
    confirmBtn.textContent = 'Placing your order…';
    window._pay = {method, tid, proofPath, file: window._shotBlob, mode:'advance'}; window._payConfirmed = true;
    document.getElementById('checkoutForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
  });
  const ov = document.getElementById('checkoutOverlay');
  if(ov && window.MutationObserver) new MutationObserver(()=>{ if(ov.classList.contains('on') && document.getElementById('payStep').style.display!=='none' && !window._payConfirmed) showCheckoutStep(1); }).observe(ov,{attributes:true,attributeFilter:['class']});
})();
function renderOrdAdmin(){
  document.getElementById('ordBody').innerHTML = DB.orders.length ? DB.orders.map(o=>`
    <tr>
      <td>${esc(o.code)}</td><td>${esc(o.name)}</td><td>${esc(o.phone)}</td>
      <td style="max-width:320px;font-size:.82rem;color:var(--ink-soft)">${itemsSummary(o.items)}</td>
      <td>${fmt(o.subtotal)}${payBadge(o)}</td>
      <td><select class="sm" onchange="updateStatus(${o.id},this.value)">
        ${['pending','confirmed','shipped','delivered','cancelled'].map(s=>`<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('')}
      </select></td>
    </tr>`).join('') : `<tr><td colspan="6" style="color:var(--ink-soft);white-space:normal">${DB.ordersError?'⚠️ Orders could not be loaded ('+esc(DB.ordersError)+'). Open Dashboard → “Run connection check” to see the fix.':'No orders yet.'}</td></tr>`;
}

/* Group every order by phone number into a per-customer history */
function customerList(){
  const map = new Map();
  for(const o of DB.orders){
    const key = (o.phone||'').replace(/\D/g,'') || o.phone;
    if(!map.has(key)) map.set(key, { name:o.name, phone:o.phone, orders:[] });
    map.get(key).orders.push(o);
  }
  return [...map.values()].map(c=>{
    c.orders.sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
    c.total = c.orders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+Number(o.subtotal),0);
    c.last = c.orders[0]?.created_at;
    c.name = c.orders[0].name;
    return c;
  }).sort((a,b)=> new Date(b.last) - new Date(a.last));
}
function renderCustAdmin(){
  const list = customerList();
  document.getElementById('custBody').innerHTML = list.length ? list.map((c,i)=>`
    <tr>
      <td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.orders.length}</td>
      <td>${fmt(c.total)}</td><td>${c.last?new Date(c.last).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}):'—'}</td>
      <td><button class="sm" onclick="openCustDetail(${i})">View history</button></td>
    </tr>`).join('') : `<tr><td colspan="6" style="color:var(--ink-soft)">No customers yet.</td></tr>`;
  window._custList = list;
}
function openCustDetail(i){
  const c = window._custList[i]; if(!c) return;
  document.getElementById('custDetailName').textContent = c.name;
  document.getElementById('custDetailPhone').textContent = c.phone + ' · ' + c.orders.length + ' order' + (c.orders.length===1?'':'s') + ' · ' + fmt(c.total) + ' total';
  document.getElementById('custDetailBody').innerHTML = c.orders.map(o=>`
    <tr>
      <td>${esc(o.code)}</td>
      <td>${o.created_at?new Date(o.created_at).toLocaleDateString('en-PK',{day:'numeric',month:'short',year:'numeric'}):'—'}</td>
      <td style="max-width:200px;font-size:.82rem;color:var(--ink-soft)">${itemsSummary(o.items)}</td>
      <td>${fmt(o.subtotal)}</td><td>${esc(o.status)}</td>
    </tr>`).join('');
  openM(document.getElementById('custDetailOverlay'));
}
async function updateStatus(id,status){
  const r=await sb.from('orders').update({status}).eq('id',id); if(r.error) alert(r.error.message);
  await loadOrders(); renderOrdAdmin(); renderStats();
}

/* ===== IMAGE UPLOAD ===== */
function switchImgTab(tab){
  document.getElementById('imgTabUpload').classList.toggle('on', tab==='upload');
  document.getElementById('imgTabUrl').classList.toggle('on', tab==='url');
  document.getElementById('imgPanelUpload').style.display = tab==='upload'?'block':'none';
  document.getElementById('imgPanelUrl').style.display = tab==='url'?'block':'none';
}

function clearImage(){
  pendingBlob=null;
  document.getElementById('imgPreview').src='';
  document.getElementById('imgPreviewWrap').style.display='none';
  document.getElementById('imgUploadArea').style.display='block';
  document.getElementById('imgFinalUrl').value='';
  document.getElementById('imgFileInput').value='';
  document.getElementById('imgUrlInput').value='';
  document.getElementById('imgUrlPreview').src='';
  document.getElementById('imgUrlPreviewWrap').style.display='none';
}

function previewUrl(){
  const url = document.getElementById('imgUrlInput').value.trim();
  if(!url){ return; }
  const img = document.getElementById('imgUrlPreview');
  img.src = url;
  img.onload = ()=>{ document.getElementById('imgUrlPreviewWrap').style.display='block'; document.getElementById('imgFinalUrl').value=url; };
  img.onerror = ()=>{ img.src=''; document.getElementById('imgUrlPreviewWrap').style.display='none'; document.getElementById('prodMsg').innerHTML='<div class="msg err">Image load nahin ho saki. URL check karein.</div>'; };
}

// Image ko chota (max 800px, JPEG) bana kar save karte hain taake storage full na ho
function compressImage(file, cb){
  const reader = new FileReader();
  reader.onload = e=>{
    const img = new Image();
    img.onload = ()=>{
      const MAX = 800;
      let w = img.width, h = img.height;
      if(w>MAX || h>MAX){ const r = Math.min(MAX/w, MAX/h); w=Math.round(w*r); h=Math.round(h*r); }
      const c = document.createElement('canvas'); c.width=w; c.height=h;
      const ctx = c.getContext('2d');
      ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h);
      ctx.drawImage(img,0,0,w,h);
      c.toBlob(b=>cb(b),'image/jpeg',0.82);
    };
    img.onerror = ()=>{ document.getElementById('prodMsg').innerHTML='<div class="msg err">Ye image open nahin ho saki. Koi aur image try karein.</div>'; };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function applyUploadedImage(file){
  if(!file || !file.type.startsWith('image/')) return;
  if(file.size > 15*1024*1024){ document.getElementById('prodMsg').innerHTML='<div class="msg err">Image 15MB se choti honi chahiye.</div>'; return; }
  compressImage(file, b64=>{
    document.getElementById('imgPreview').src = URL.createObjectURL(b64);
    document.getElementById('imgPreviewWrap').style.display='block';
    document.getElementById('imgUploadArea').style.display='none';
    pendingBlob = b64; document.getElementById('imgFinalUrl').value = '';
    document.getElementById('prodMsg').innerHTML='';
  });
}

// File input change
document.getElementById('imgFileInput').addEventListener('change', function(){
  applyUploadedImage(this.files[0]);
});

// Drag and drop
const uploadArea = document.getElementById('imgUploadArea');
uploadArea.addEventListener('dragover', e=>{ e.preventDefault(); uploadArea.classList.add('drag'); });
uploadArea.addEventListener('dragleave', ()=>uploadArea.classList.remove('drag'));
uploadArea.addEventListener('drop', e=>{
  e.preventDefault(); uploadArea.classList.remove('drag');
  applyUploadedImage(e.dataTransfer.files[0]);
});

/* ============================= */
document.getElementById('grid').innerHTML='<div class="pgrid">'+'<div class="card sk"></div>'.repeat(8)+'</div>';
renderCart();
function renderAll(){ renderChips(); renderGrid(); renderFeatureCollections(); }
try{ const c=JSON.parse(localStorage.getItem('ahma_cache_v1')||'null'); if(c&&c.p&&c.p.length){ DB.categories=c.c||[]; DB.products=c.p; DB.images=c.i||{}; DB.variants=c.v||{}; renderAll(); } }catch(e){}
loadPublic().then(()=>{ cart=cart.filter(i=>DB.products.some(p=>p.id===i.id)); /* old carts: a product that now has variants needs a variant chosen */ cart=cart.filter(i=>{ const p=DB.products.find(x=>x.id===i.id); return !(hasVariants(p) && !i.vid) && !(i.vid && !variantsOf(p).some(v=>v.id===i.vid)); }); saveCart(); renderAll(); renderCart(); route(); });
sb.auth.getSession().then(async({data})=>{ if(data.session){ const {data:ok}=await sb.rpc('is_admin'); adminAuthed=!!ok; if(adminAuthed && adminRoot.style.display==='block') openAdmin(); } });

/* ===== Multi-page setup: every page is a real file (index, product, about, faq ...) ===== */
var PAGE = document.body.getAttribute('data-page') || 'home';
var BASE_TITLE = document.title;
var INFO_ORDER = [['Company',['about','faq','contact']],['Policies',['shipping','refund','privacy','terms']]];
var INFO_FILES = {about:'about.html',faq:'faq.html',contact:'contact.html',shipping:'shipping-policy.html',refund:'refund-policy.html',privacy:'privacy-policy.html',terms:'terms.html'};
function goBack(){
  try{ if(document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1){ history.back(); return; } }catch(e){}
  location.href = 'index.html';
}
function route(){
  if(PAGE === 'product'){ renderPage(()=>showProduct(new URLSearchParams(location.search).get('id'))); }
  else if(PAGE === 'info'){ renderPage(()=>showInfoPage(document.body.getAttribute('data-info'))); }
  else if(PAGE === 'category'){ renderPage(()=>showCategory(new URLSearchParams(location.search).get('id'))); }
}
function renderPage(fn){
  document.body.classList.add('inpage');
  document.getElementById('pageView').style.display = 'block';
  fn();
}
function setMeta(title, desc){
  document.title = title;
  const d = document.querySelector('meta[name="description"]'); if(d && desc) d.setAttribute('content', desc);
  [['property','og:title'],['name','twitter:title']].forEach(([k,v])=>{ const m = document.querySelector('meta['+k+'="'+v+'"]'); if(m) m.setAttribute('content', title); });
}

/* quantity-aware add (used by product page) */
function addQty(p, q, v){
  const stock = v ? Number(v.stock) : Number(p.stock);
  const ex = cart.find(i=>i.id===p.id && (i.vid||null)===(v?v.id:null));
  if(ex){ ex.qty = Math.min(stock, ex.qty + q); ex.stock = stock; }
  else cart.push(Object.assign({id:p.id,name:p.name,price:p.price,image_url:p.image_url,qty:Math.min(q,stock),stock}, v?{vid:v.id,vlabel:vLabel(v)}:{}));
  saveCart(); renderCart();
}

function showProduct(rawId){
  const pv = document.getElementById('pageView');
  if(!DB.products.length){ pv.innerHTML = '<div class="pg"><div class="card sk" style="height:420px"></div></div>'; return; }
  const p = DB.products.find(x=>String(x.id)===String(rawId));
  if(!p){
    pv.innerHTML = '<div class="pg"><div class="ip-body" style="text-align:center"><h1>Product not found</h1><p>This product is no longer available.</p><a class="btn" href="index.html" style="display:inline-block;width:auto;padding:12px 26px;text-decoration:none">Back to store</a></div></div>';
    return;
  }
  const gal = productGallery(p), d = discPct(p), cat = catPathName(p.category_id), catTrail = catPath(p.category_id), pst = pStock(p), inStock = pst > 0;
  const stockTxt = !inStock ? 'Out of stock' : (pst <= 5 ? `Only ${pst} left in stock` : 'In stock');
  const waText = `Assalam o Alaikum! Mujhe is product ke baray mein maloomat chahiye:\n${p.name} (${fmt(p.price)})\n${location.href}`;
  const related = DB.products.filter(x=>x.id!==p.id && pStock(x)>0)
    .sort((a,b)=>(b.category_id===p.category_id)-(a.category_id===p.category_id) || Number(b.id)-Number(a.id)).slice(0,6);
  pv.innerHTML = `<div class="pg">
    <nav class="crumbs" aria-label="Breadcrumb"><button type="button" id="ppBack">‹ Back</button><span>|</span><a href="index.html">Home</a><span>›</span>${catTrail.map(c=>`<a href="${catPageHref(c.id)}">${esc(c.name)}</a><span>›</span>`).join('')}<span class="cur">${esc(p.name)}</span></nav>
    <div class="pp">
      <div class="pp-gal">
        <div class="pp-main" id="ppMain">${gal[0]?`<img src="${esc(gal[0])}" alt="${esc(p.name)}" decoding="async">`:`<span style="font-size:4rem;color:#bbb">${esc((p.name||'?')[0])}</span>`}</div>
        ${gal.length>1?`<div class="pp-thumbs" id="ppThumbs">${gal.map((u,i)=>`<img class="${i?'':'on'}" data-url="${esc(u)}" src="${esc(u)}" alt="${esc(p.name)} photo ${i+1}" loading="lazy">`).join('')}</div>`:''}
      </div>
      <div class="pp-info">
        ${cat?`<div class="pp-cat">${esc(cat)}</div>`:''}
        <h1>${esc(p.name)}</h1>
        <div class="pp-price"><b>${fmt(p.price)}</b>${p.compare_at_price?`<s>${fmt(p.compare_at_price)}</s>`:''}${d?`<span class="dbadge">-${d}%</span>`:''}</div>
        ${hasVariants(p)?'<div class="pp-opts" id="ppOpts"></div><div class="pp-opt-err" id="ppOptErr" role="alert"></div>':''}
        <div class="pp-stock" id="ppStock" style="color:${inStock?(pst<=5?'#d9480f':'var(--ok)'):'#c0392b'}">${stockTxt}</div>
        ${inStock?`<div class="pp-qty"><span>Quantity</span><div class="stepper"><button type="button" id="qMinus" aria-label="Decrease">−</button><span id="qVal">1</span><button type="button" id="qPlus" aria-label="Increase">+</button></div></div>`:''}
        <div class="pp-actions">
          <button class="btn" type="button" id="ppOrder" ${inStock?'':'disabled'}>${inStock?'Order now':'Out of stock'}</button>
          <button class="btn alt" type="button" id="ppCart" ${inStock?'':'disabled'}>Add to cart</button>
        </div>
        <a class="pp-wa" target="_blank" rel="noopener" href="https://wa.me/${STORE_WA}?text=${encodeURIComponent(waText)}">💬 Ask about this product on WhatsApp</a>
        <ul class="pp-trust"><li>💳 Pay in advance, or Cash on Delivery on small orders</li><li>🚚 Delivery across Pakistan, usually 2–5 business days</li><li>↩️ 3-day returns for damaged or wrong items</li></ul>
      </div>
    </div>
    <div class="pp-desc"><h2>Product details</h2><div>${esc(p.description||'No additional details are available for this product yet.')}</div></div>
    ${related.length?`<div class="sec-head"><div><h2>You may also like</h2></div></div><div class="pgrid" id="ppRelated">${related.map(productCardHTML).join('')}</div>`:''}
  </div>`;
  setMeta(p.name + ' | AhmaMart', (p.description||'').slice(0,155) || ('Buy ' + p.name + ' at AhmaMart Pakistan.'));

  /* --- variants: choose Size / Colour; stock and quantity follow the chosen variant --- */
  const vs = variantsOf(p), vnames = vOptionNames(vs), sel = {};
  const optsEl = document.getElementById('ppOpts'), optErr = document.getElementById('ppOptErr');
  const missing = new Set();
  vnames.forEach(n=>{ const vals = vOptionValues(vs,n); if(vals.length===1) sel[n] = vals[0]; });
  const curV = ()=> vs.length && vnames.every(n=>sel[n]!==undefined) ? (vs.find(v=>vnames.every(n=>optVal(v,n)===sel[n])) || null) : null;
  const maxQty = ()=>{ const v = curV(); return v ? Number(v.stock) : (vs.length ? 0 : Number(p.stock)); };
  let qty = 1;
  const qv = document.getElementById('qVal');
  const setQ = n=>{ qty = Math.max(1, Math.min(maxQty(), n)); if(qv) qv.textContent = qty; };
  function renderOpts(){
    if(!optsEl) return;
    optsEl.innerHTML = vnames.map(n=>{
      const vals = vOptionValues(vs,n);
      const swatches = isColourName(n) && vals.every(x=>swatchCss(x));
      const btns = vals.map(val=>{
        const avail = vs.some(v=>optVal(v,n)===val && Number(v.stock)>0 && vnames.every(m=>m===n || sel[m]===undefined || optVal(v,m)===sel[m]));
        const on = sel[n]===val;
        return swatches
          ? `<button type="button" class="pp-sw${on?' on':''}${avail?'':' off'}" data-n="${esc(n)}" data-v="${esc(val)}" title="${esc(val)}${avail?'':' — not available'}" aria-label="${esc(n)} ${esc(val)}" aria-pressed="${on}"><span style="background:${esc(swatchCss(val))}"></span></button>`
          : `<button type="button" class="pp-chip${on?' on':''}${avail?'':' off'}" data-n="${esc(n)}" data-v="${esc(val)}" title="${avail?'':'Not available in this combination'}" aria-pressed="${on}">${esc(val)}</button>`;
      }).join('');
      return `<div class="pp-opt${missing.has(n)?' missing':''}" data-opt="${esc(n)}"><div class="pp-opt-l">${esc(n)}${sel[n]!==undefined?`: <b>${esc(sel[n])}</b>`:''}</div><div class="pp-chips">${btns}</div></div>`;
    }).join('');
    optsEl.querySelectorAll('[data-n]').forEach(b=>b.addEventListener('click',()=>{
      sel[b.dataset.n] = b.dataset.v; missing.delete(b.dataset.n); if(optErr && !missing.size) optErr.textContent='';
      /* if the new choice makes the other pick impossible (that combination does not exist), clear the other pick */
      if(!vs.some(v=>vnames.every(k=>sel[k]===undefined || optVal(v,k)===sel[k]))) vnames.forEach(m=>{ if(m!==b.dataset.n && vOptionValues(vs,m).length>1) delete sel[m]; });
      renderOpts(); updateVariantUI();
    }));
  }
  function updateVariantUI(){
    const v = curV(), st = v ? Number(v.stock) : pst, stEl = document.getElementById('ppStock');
    if(stEl){ stEl.textContent = st<=0 ? 'Out of stock' : (st<=5 ? `Only ${st} left in stock` : 'In stock'); stEl.style.color = st<=0 ? '#c0392b' : (st<=5 ? '#d9480f' : 'var(--ok)'); }
    const soldOut = !inStock || (v && st<=0), ob = document.getElementById('ppOrder'), cb = document.getElementById('ppCart');
    if(ob){ ob.disabled = !!soldOut; ob.textContent = soldOut ? 'Out of stock' : 'Order now'; }
    if(cb){ cb.disabled = !!soldOut; cb.textContent = soldOut ? 'Out of stock' : 'Add to cart'; }
    setQ(qty);
  }
  /* returns the chosen variant, null for a product without variants, or false (and shows a hint) when a choice is still missing */
  const pickVariant = ()=>{
    if(!vs.length) return null;
    const v = curV(); if(v) return v;
    const miss = vnames.filter(n=>sel[n]===undefined);
    missing.clear(); miss.forEach(n=>missing.add(n));
    if(optErr){ optErr.textContent = miss.length ? 'Please select ' + miss.join(' and ') + ' to continue' : 'This size/colour combination is not available — please choose another.'; }
    renderOpts();
    const target = optsEl && (optsEl.querySelector('.pp-opt.missing') || optsEl);
    if(target){ target.scrollIntoView({block:'center',behavior:'smooth'}); target.classList.remove('shake'); void target.offsetWidth; target.classList.add('shake'); }
    return false;
  };
  renderOpts(); if(vs.length) updateVariantUI();
  document.getElementById('ppBack').addEventListener('click', goBack);
  const minus = document.getElementById('qMinus'), plus = document.getElementById('qPlus');
  if(minus) minus.addEventListener('click', ()=>setQ(qty-1));
  if(plus) plus.addEventListener('click', ()=>setQ(qty+1));
  document.getElementById('ppCart').addEventListener('click', ()=>{ if(!inStock) return; const v = pickVariant(); if(v===false) return; addQty(p, qty, v); openCart(); });
  document.getElementById('ppOrder').addEventListener('click', ()=>{ if(!inStock) return; const v = pickVariant(); if(v===false) return; addQty(p, qty, v); openM(document.getElementById('checkoutOverlay')); });
  const th = document.getElementById('ppThumbs');
  if(th) th.addEventListener('click', e=>{
    const im = e.target.closest('img'); if(!im) return;
    document.getElementById('ppMain').innerHTML = `<img src="${esc(im.dataset.url)}" alt="${esc(p.name)}">`;
    th.querySelectorAll('img').forEach(x=>x.classList.toggle('on', x===im));
  });
  const rel = document.getElementById('ppRelated');
  if(rel){
    rel.querySelectorAll('.addbtn:not([disabled])').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); addToCart(Number(b.dataset.id)); }));
    rel.querySelectorAll('.card[data-open]').forEach(c=>c.addEventListener('click',()=>openProductDetail(Number(c.dataset.open))));
  }
  observeReveal(pv);
}

/* Category page: shows the sub-categories (if any) and then the products of this category + everything inside it */
function showCategory(rawId){
  const pv = document.getElementById('pageView');
  if(!DB.loaded && !DB.categories.length){ pv.innerHTML = '<div class="pg"><div class="card sk" style="height:320px"></div></div>'; return; }
  const c = catById(rawId);
  if(!c){
    pv.innerHTML = '<div class="pg"><div class="ip-body" style="text-align:center"><h1>Category not found</h1><p>This category is no longer available.</p><a class="btn" href="index.html" style="display:inline-block;width:auto;padding:12px 26px;text-decoration:none">Back to store</a></div></div>';
    return;
  }
  const trail = catPath(c.id), kids = catChildren(c.id), items = productsInCat(c.id);
  const tiles = kids.map(k=>{
    const n = productsInCat(k.id).length;
    return `<a class="subtile" href="${catPageHref(k.id)}">
      <span class="subimg">${k.image_url?`<img src="${esc(k.image_url)}" alt="${esc(k.name)}" loading="lazy" decoding="async">`:`<span aria-hidden="true">${catIcon(k.name)}</span>`}</span>
      <span class="subname">${esc(k.name)}</span>
      <span class="subcount">${n ? n + (n===1?' product':' products') : 'Coming soon'}</span></a>`;
  }).join('');
  pv.innerHTML = `<div class="pg">
    <nav class="crumbs" aria-label="Breadcrumb"><button type="button" id="ppBack">‹ Back</button><span>|</span><a href="index.html">Home</a><span>›</span>${trail.map((t,i)=>i<trail.length-1?`<a href="${catPageHref(t.id)}">${esc(t.name)}</a><span>›</span>`:`<span class="cur">${esc(t.name)}</span>`).join('')}</nav>
    <div class="catpg-head"><h1>${esc(c.name)}</h1>${items.length?`<span class="cat-num">${items.length}</span>`:''}</div>
    ${kids.length?`<div class="sec-head"><div><h2>Shop by category</h2></div></div><div class="subgrid">${tiles}</div>`:''}
    ${items.length?`${kids.length?`<div class="sec-head"><div><h2>All ${esc(c.name)}</h2></div></div>`:''}<div class="pgrid" id="catProducts">${items.map(productCardHTML).join('')}</div>`
      : (kids.length?'':`<div class="empty">No products in this category yet.<br><a class="btn" href="index.html" style="display:inline-block;width:auto;padding:12px 26px;text-decoration:none;margin-top:14px">Back to store</a></div>`)}
  </div>`;
  setMeta(c.name + ' | AhmaMart', 'Shop ' + trail.map(t=>t.name).join(' › ') + ' at AhmaMart Pakistan. Delivery across Pakistan.');
  /* highlight the main category in the header chips */
  const rootId = trail[0] ? Number(trail[0].id) : null;
  document.querySelectorAll('#chips .chip').forEach(ch=>ch.classList.toggle('on', ch.dataset.id!=='' && Number(ch.dataset.id)===rootId));
  document.getElementById('ppBack').addEventListener('click', goBack);
  const g = document.getElementById('catProducts');
  if(g){
    g.querySelectorAll('.addbtn:not([disabled])').forEach(b=>b.addEventListener('click',e=>{ e.stopPropagation(); addToCart(Number(b.dataset.id)); }));
    g.querySelectorAll('.card[data-open]').forEach(cd=>cd.addEventListener('click',()=>openProductDetail(Number(cd.dataset.open))));
  }
  observeReveal(pv);
}

function showInfoPage(key){
  const pg = INFO_PAGES[key], pv = document.getElementById('pageView'); if(!pg) return;
  const nav = INFO_ORDER.map(([label,keys])=>`<h4>${label}</h4>` + keys.map(k=>`<a href="${INFO_FILES[k]}" class="${k===key?'on':''}">${esc(INFO_PAGES[k].title)}</a>`).join('')).join('');
  pv.innerHTML = `<div class="pg">
    <nav class="crumbs" aria-label="Breadcrumb"><button type="button" id="ppBack">‹ Back</button><span>|</span><a href="index.html">Home</a><span>›</span><span class="cur">${esc(pg.title)}</span></nav>
    <div class="ip"><aside class="ip-nav">${nav}</aside><article class="ip-body"><h1>${esc(pg.title)}</h1>${pg.html}</article></div>
  </div>`;
  setMeta(pg.title + ' | AhmaMart');
  document.getElementById('ppBack').addEventListener('click', goBack);
}

/* search + category chips: on other pages they open the store page; on the store page they read ?q= / ?cat= */
(function(){
  const si = document.getElementById('searchInput'), ch = document.getElementById('chips'), sb2 = document.querySelector('.sbtn');
  if(PAGE === 'home'){
    const sp = new URLSearchParams(location.search), q = sp.get('q'), cat = sp.get('cat');
    if(q){ si.value = q; searchTerm = q; }
    if(cat){ activeCategory = isNaN(Number(cat)) ? cat : Number(cat); }
    if(q || cat){ renderChips(); renderGrid(); }
    return;
  }
  const go = ()=>{ const v = si.value.trim(); if(v) location.href = 'index.html?q=' + encodeURIComponent(v); else si.focus(); };
  si.addEventListener('keydown', e=>{ if(e.key === 'Enter'){ e.preventDefault(); go(); } });
  if(sb2) sb2.onclick = go;
  if(ch) ch.addEventListener('click', e=>{
    const c = e.target.closest('.chip'); if(!c) return;
    e.stopPropagation(); e.preventDefault();
    if(c.dataset.id && catGo(Number(c.dataset.id))) return;
    location.href = 'index.html' + (c.dataset.id ? '?cat=' + encodeURIComponent(c.dataset.id) : '');
  }, true);
})();

/* ===== Animations ===== */
var revealIO = ('IntersectionObserver' in window) ? new IntersectionObserver(entries=>{
  entries.forEach(en=>{
    if(!en.isIntersecting) return;
    const el = en.target; revealIO.unobserve(el);
    el.style.setProperty('--d', (Number(el.dataset.rvi||0) % 6) * 60 + 'ms');
    el.classList.add('in');
    setTimeout(()=>{ el.classList.remove('rv','in'); el.style.removeProperty('--d'); }, 900);
  });
},{threshold:.08,rootMargin:'0px 0px -30px 0px'}) : null;
function observeReveal(root){
  if(!revealIO) return;
  let i = 0;
  (root||document).querySelectorAll('.card:not(.sk):not(.rv),.sec-head,.cb-tile,.subtile,.svc>div,.pp,.pp-desc,.ip-nav,.ip-body,.nl,.userbox').forEach(el=>{
    if(el.classList.contains('rv')) return;
    el.dataset.rvi = i++; el.classList.add('rv'); revealIO.observe(el);
  });
}
(function(){
  const rg = renderGrid, rf = renderFeatureCollections, rc = renderCatBlocks;
  renderGrid = function(){ rg.apply(this, arguments); observeReveal(document.getElementById('grid')); };
  renderFeatureCollections = function(){ rf.apply(this, arguments); observeReveal(document.getElementById('featuredProducts')); observeReveal(document.getElementById('clearanceProducts')); };
  renderCatBlocks = function(){ rc.apply(this, arguments); observeReveal(document.getElementById('catBlocks')); };
})();

/* cart badge pop when the count changes */
(function(){
  const b = document.getElementById('cartCount'); if(!b || !window.MutationObserver) return;
  new MutationObserver(()=>{ b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }).observe(b,{childList:true,characterData:true,subtree:true});
})();

/* back-to-top button */
(function(){
  const t = document.getElementById('toTop'); if(!t) return;
  let on = false;
  addEventListener('scroll', ()=>{ const s = scrollY > 700; if(s !== on){ on = s; t.classList.toggle('show', s); } }, {passive:true});
  t.addEventListener('click', ()=>scrollTo({top:0,behavior:'smooth'}));
})();

/* first paint of the right view (e.g. someone opens a shared product link) */
observeReveal(document);
route();


/* ===== Optional customer account (email login via login.html) =====
   Guests can still browse and order exactly as before. Logging in only pre-fills checkout details. */
var currentUser = null;
function acctNext(){ const f = location.pathname.split('/').pop() || 'index.html'; return f === 'login.html' ? 'index.html' : f + location.search; }
function updateAccountUI(){
  const a = document.getElementById('accountLink'), lo = document.getElementById('logoutLink'), b = document.getElementById('bnavAccount');
  const next = 'login.html?next=' + encodeURIComponent(acctNext());
  if(currentUser){
    /* only the first name is shown (never the email address) */
    const nm = (((currentUser.user_metadata||{}).full_name || '').trim().split(' ')[0]) || 'Account';
    if(a){ a.textContent = '👤 ' + nm; a.href = 'login.html?next=' + encodeURIComponent(acctNext()); a.removeAttribute('title'); }
    if(lo) lo.style.display = '';
    if(b){ b.href = 'login.html?next=' + encodeURIComponent(acctNext()); b.lastChild.textContent = nm.length>9 ? nm.slice(0,8)+'…' : nm; }
  } else {
    if(a){ a.textContent = 'Login'; a.href = next; a.title = ''; }
    if(lo) lo.style.display = 'none';
    if(b){ b.href = next; b.lastChild.textContent = 'Login'; }
  }
}
function prefillCheckout(){
  if(!currentUser) return;
  const f = document.getElementById('checkoutForm'); if(!f) return;
  const m = currentUser.user_metadata || {};
  const set = (n,v)=>{ if(v && f[n] && !f[n].value) f[n].value = v; };
  set('name', m.full_name); set('phone', m.phone); set('email', currentUser.email);
}
(function(){
  const lo = document.getElementById('logoutLink');
  if(lo) lo.addEventListener('click', async ()=>{ await sb.auth.signOut(); currentUser = null; adminAuthed = false; DB.orders = []; updateAccountUI(); });
  sb.auth.getSession().then(({data})=>{ currentUser = data.session ? data.session.user : null; updateAccountUI(); });
  sb.auth.onAuthStateChange((ev,session)=>{ currentUser = session ? session.user : null; updateAccountUI(); });
  updateAccountUI();
})();

/* Banner slider (pure CSS gradients, no images = fast) */
(function(){
  const slides=document.getElementById('slides'), dotsBox=document.getElementById('dots'); if(!slides||!dotsBox) return;
  const n=slides.children.length; let i=0,t; slides.children[0].classList.add('act');
  dotsBox.innerHTML=Array.from({length:n},(_,k)=>`<button type="button" class="dot${k?'':' on'}" aria-label="Slide ${k+1}" data-i="${k}"></button>`).join('');
  function go(k){ i=(k+n)%n; [...slides.children].forEach((sl,j)=>sl.classList.toggle('act',j===i)); slides.style.transform=`translateX(-${i*100}%)`; [...dotsBox.children].forEach((d,j)=>d.classList.toggle('on',j===i)); }
  function play(){ clearInterval(t); t=setInterval(()=>{ if(!document.hidden) go(i+1); },5000); }
  dotsBox.addEventListener('click',e=>{ const b=e.target.closest('.dot'); if(b){ go(Number(b.dataset.i)); play(); } });
  let x0=null;
  slides.addEventListener('touchstart',e=>{ x0=e.touches[0].clientX; },{passive:true});
  slides.addEventListener('touchend',e=>{ if(x0===null) return; const dx=e.changedTouches[0].clientX-x0; if(Math.abs(dx)>40){ go(i+(dx<0?1:-1)); play(); } x0=null; });
  play();
})();

(function(){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', handlePayReturn); else handlePayReturn(); })();
