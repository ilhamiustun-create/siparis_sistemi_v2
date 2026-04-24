import { useState, useEffect, useRef } from "react";

// ─── Sabitler ──────────────────────────────────────────────────────────────────
const BRIMLER = ["Adet","Kg","Ton","Lt","M²","M³","Paket","Koli","Kutu","Rulo","Palet","Set"];
const KEY_ORDERS  = "sip_orders_v5";
const KEY_CONFIG  = "sip_config_v5";
const KEY_SESSION = "sip_session_v5"; // kişisel storage — paylaşılmaz

const USERS = [
  { ad: "Mustafa", pin: "1234" },
  { ad: "Samet",   pin: "4321" },
];
const ADMIN_PIN_DEFAULT = "9999";

const AGENTS = {
  lider:      { emoji:"🎯", isim:"Takım Lideri",       renk:"#f59e0b", bg:"#110e00", border:"#3a2800",
    sistem:`Sen bir sipariş yönetim sistemi geliştirme takımının denetleyici liderisisin. Diğer ajanların raporlarını değerlendirip net karar ver. Yanıtın MUTLAKA "ONAYLANDI" veya "REDDEDİLDİ" kelimelerinden birini içersin. Maksimum 200 kelime.` },
  kodcu:      { emoji:"💻", isim:"Kod Yazarı",          renk:"#60a5fa", bg:"#00080f", border:"#102030",
    sistem:`Sen bir React/JavaScript uzmanısın. Çok kullanıcılı sipariş yönetim sistemi (React, window.storage, IBM Plex font, koyu tema) üzerinde çalışıyorsunuz. Teknik uygulanabilirlik, riskler, değiştirilecek componentlar hakkında kısa rapor ver. Maksimum 180 kelime.` },
  tasarimci:  { emoji:"🎨", isim:"Görsel Tasarım",      renk:"#c084fc", bg:"#0a0010", border:"#2a1050",
    sistem:`Sen bir UI/UX uzmanısın. Koyu tema, sarı (#f59e0b) vurgu, IBM Plex font kullanılan mobil-öncelikli sipariş uygulaması üzerinde çalışıyorsun. UI/UX uyumu, mobil uyumluluk, kullanıcı deneyimi hakkında rapor ver. Maksimum 180 kelime.` },
  kalite:     { emoji:"✅", isim:"Kalite Kontrolcü",    renk:"#4ade80", bg:"#001008", border:"#103020",
    sistem:`Sen bir QA mühendisisin. Çok kullanıcılı sipariş sisteminde (Mustafa, Samet kullanıcıları, paylaşımlı storage) kalite kontrolü yapıyorsun. Olası buglar, edge case'ler ve en az 3 test senaryosu yaz. Maksimum 180 kelime.` },
};
const AGENT_ORDER = ["kodcu","tasarimci","kalite","lider"];

// ─── Helpers ───────────────────────────────────────────────────────────────────
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
const emptyItem = () => ({ id:uid(), malzeme:"", miktar:"", birim:"Adet", notlar:"" });

function genNo(orders) {
  const d = new Date().toISOString().slice(0,10).replace(/-/g,"");
  const n = (orders||[]).filter(o=>o.no?.startsWith(`SIP-${d}`)).length + 1;
  return `SIP-${d}-${String(n).padStart(3,"0")}`;
}

function blankSiparis(orders, ad) {
  return { no:genNo(orders), satisci:ad, kullanici:ad,
    tarih:new Date().toISOString().slice(0,10), gonderimTarihi:"",
    plaka:"", firma:"", adres:"", items:[emptyItem()], not:"" };
}

function toWhatsApp(s) {
  return [
    `📦 *SİPARİŞ FORMU*`,`━━━━━━━━━━━━━━━━━━━━`,
    `🔢 No: ${s.no}`,`👤 Satışçı: ${s.satisci}`,
    `📅 Sipariş: ${s.tarih}`,
    s.gonderimTarihi?`🗓 Gönderim: ${s.gonderimTarihi}`:null,
    `🚚 Plaka: ${(s.plaka||"").toUpperCase()}`,`🏢 Firma: ${s.firma}`,
    s.adres?`📍 ${s.adres}`:null,
    `━━━━━━━━━━━━━━━━━━━━`,`*MALZEME LİSTESİ*`,
    ...(s.items||[]).map((it,i)=>`${i+1}. ${it.malzeme}${it.miktar?` — ${it.miktar} ${it.birim}`:""}${it.notlar?` _(${it.notlar})_`:""}`),
    `━━━━━━━━━━━━━━━━━━━━`,
    s.not?`📝 ${s.not}`:null,
    `✅ ${(s.items||[]).filter(i=>i.malzeme).length} kalem`,
  ].filter(Boolean).join("\n");
}

// Kümülatif malzeme toplamları — malzeme+birim bazında
function calcKumulatif(orders, filtre="bekleyen") {
  const map = {};
  const filtreli = filtre==="hepsi" ? orders : orders.filter(o=>!o.tamamlandi);
  filtreli.forEach(o => {
    (o.items||[]).forEach(it => {
      if (!it.malzeme?.trim() || !it.miktar) return;
      const key = `${it.malzeme.trim()}__${it.birim}`;
      if (!map[key]) map[key] = { malzeme:it.malzeme.trim(), birim:it.birim, toplam:0, siparisler:[] };
      map[key].toplam += parseFloat(it.miktar)||0;
      if (!map[key].siparisler.includes(o.no)) map[key].siparisler.push(o.no);
    });
  });
  return Object.values(map).sort((a,b)=>b.toplam-a.toplam);
}

// Birim bazında özet (header için)
function calcBirimToplamlar(orders) {
  const t = {};
  (orders||[]).filter(o=>!o.tamamlandi).forEach(o=>
    (o.items||[]).forEach(it=>{
      if (!it.malzeme||!it.miktar) return;
      t[it.birim]=(t[it.birim]||0)+parseFloat(it.miktar||0);
    }));
  return t;
}

// ─── Storage ───────────────────────────────────────────────────────────────────
const store = {
  // Siparişler: paylaşımlı
  async getOrders() {
    try { const r=await window.storage.get(KEY_ORDERS,true); return r?.value?JSON.parse(r.value):[]; } catch{return[];}
  },
  async saveOrders(v) {
    if (!Array.isArray(v)) return;
    try { await window.storage.set(KEY_ORDERS,JSON.stringify(v),true); } catch(e){console.error(e);}
  },
  // Config: paylaşımlı
  async getConfig() {
    try { const r=await window.storage.get(KEY_CONFIG,true); return r?.value?JSON.parse(r.value):{pin:ADMIN_PIN_DEFAULT}; } catch{return{pin:ADMIN_PIN_DEFAULT};}
  },
  async saveConfig(v) {
    try { await window.storage.set(KEY_CONFIG,JSON.stringify(v),true); } catch(e){console.error(e);}
  },
  // Session: kişisel (paylaşılmaz) — remount'ta kaybolmaz
  async getSession() {
    try { const r=await window.storage.get(KEY_SESSION,false); return r?.value?JSON.parse(r.value):null; } catch{return null;}
  },
  async saveSession(v) {
    try {
      if (v) await window.storage.set(KEY_SESSION,JSON.stringify(v),false);
      else await window.storage.delete(KEY_SESSION,false);
    } catch(e){console.error(e);}
  },
};

// ─── CSS ───────────────────────────────────────────────────────────────────────
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#06080e;min-height:100%}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#06080e}::-webkit-scrollbar-thumb{background:#1e2130;border-radius:4px}
.inp{background:#10121e;border:1.5px solid #1e2130;border-radius:8px;color:#e4e0d8;font-family:'IBM Plex Sans',sans-serif;font-size:14px;padding:10px 13px;width:100%;outline:none;transition:all .2s}
.inp:focus{border-color:#f59e0b;background:#14162a}.inp::placeholder{color:#30334a}
select.inp{cursor:pointer}textarea.inp{resize:vertical}
.lbl{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#50536a;margin-bottom:5px;display:block}
.btn{border:none;border-radius:8px;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.4px;padding:10px 18px;text-transform:uppercase;transition:all .18s;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.btn:active{transform:scale(.97)}.btn:disabled{opacity:.35;cursor:not-allowed;transform:none!important}
.btn-y{background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;box-shadow:0 3px 14px rgba(245,158,11,.4)}
.btn-y:hover:not(:disabled){background:linear-gradient(135deg,#fbbf24,#f59e0b);box-shadow:0 5px 20px rgba(245,158,11,.55);transform:translateY(-1px)}
.btn-g{background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;box-shadow:0 3px 14px rgba(22,163,74,.38)}
.btn-g:hover:not(:disabled){background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 5px 20px rgba(22,163,74,.5);transform:translateY(-1px)}
.btn-b{background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;box-shadow:0 3px 14px rgba(37,99,235,.32)}
.btn-b:hover:not(:disabled){background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 5px 20px rgba(37,99,235,.46);transform:translateY(-1px)}
.btn-ghost{background:#10121e;color:#b0acc8;border:1.5px solid #1e2130}
.btn-ghost:hover{border-color:#f59e0b;color:#f59e0b;background:#16182c}
.btn-red{background:#10121e;color:#f87171;border:1.5px solid #2e1010;font-size:11px;padding:7px 11px}
.btn-red:hover{background:#200c0c;border-color:#f87171}
.btn-done{background:#0a180e;color:#4ade80;border:1.5px solid #143a1e;font-size:11px;padding:7px 11px}
.btn-done:hover{background:#102818}
.tnav{background:#080a16;border-bottom:1.5px solid #1a1d2e;padding:0 18px;display:flex;overflow-x:auto;gap:0}
.tnav::-webkit-scrollbar{height:0}
.tbtn{background:none;border:none;color:#383b52;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:700;letter-spacing:1.5px;padding:13px 14px;cursor:pointer;text-transform:uppercase;transition:all .2s;border-bottom:2.5px solid transparent;white-space:nowrap}
.tbtn.on{color:#f59e0b;border-bottom-color:#f59e0b}.tbtn:hover:not(.on){color:#888}
.sec{font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#f59e0b;margin-bottom:12px;padding-bottom:7px;border-bottom:1px solid #1a1d2e}
.irow{background:#0c0e1c;border:1.5px solid #1a1d2e;border-radius:9px;padding:14px;margin-bottom:10px;position:relative}
.ibadge{position:absolute;top:-9px;left:12px;background:#f59e0b;color:#000;font-size:9px;font-weight:800;padding:2px 9px;border-radius:12px;letter-spacing:1px}
.prebox{background:#0c0e1c;border:1.5px solid #1a1d2e;border-radius:9px;padding:16px;white-space:pre-wrap;font-size:12px;line-height:2;color:#908c88;font-family:'IBM Plex Mono',monospace}
.ocard{background:#0c0e1c;border:1.5px solid #1a1d2e;border-radius:10px;padding:13px;margin-bottom:8px;transition:border-color .2s}
.ocard:hover{border-color:#282b42}.ocard.done{background:#060e08;border-color:#162a18}.ocard.done:hover{border-color:#1e4a22}
.sbox{background:#0c0e1c;border:1.5px solid #1a1d2e;border-radius:9px;padding:13px;text-align:center;flex:1;min-width:65px}
.sbox.g{background:#060e08;border-color:#162a18}.sbox.b{background:#06080f;border-color:#101828}
.pill{display:inline-flex;align-items:center;gap:6px;background:#0c0e1c;border:1.5px solid #1a1d2e;border-radius:20px;padding:6px 13px;margin:3px}
.pill.pal{border-color:#163250;background:#040c14}.pill.set{border-color:#281650;background:#0c0414}.pill.adt{border-color:#163018;background:#040e06}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;align-items:center;justify-content:center;z-index:400;padding:20px}
.modal{background:#0c0e1c;border:1.5px solid #1e2130;border-radius:14px;padding:24px;width:100%;max-height:88vh;overflow-y:auto}
.ba{background:#1e1400;color:#f59e0b;border:1.5px solid #3a2800;border-radius:5px;font-size:9px;font-weight:700;padding:2px 8px;letter-spacing:1px;text-transform:uppercase}
.bu{background:#06100a;color:#4ade80;border:1.5px solid #143a1a;border-radius:5px;font-size:9px;font-weight:700;padding:2px 8px;letter-spacing:1px;text-transform:uppercase}
.urow{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #1a1d2e}.urow:last-child{border:none}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.g3{display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px}
.nobadge{background:#0c0e1c;border:1.5px solid #1e2130;border-radius:6px;padding:4px 10px;font-size:11px;color:#808090;letter-spacing:1px;display:inline-block}
/* kümülatif */
.ktable{width:100%;border-collapse:collapse;font-family:'IBM Plex Sans',sans-serif;font-size:13px}
.ktable th{font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#505370;padding:8px 10px;border-bottom:1.5px solid #1a1d2e;text-align:left}
.ktable td{padding:10px 10px;border-bottom:1px solid #141628;color:#c8c4bc}
.ktable tr:hover td{background:#10121e}
.ktable .num{font-weight:700;font-size:15px}
/* ajanlar */
.acard{border-radius:11px;padding:16px;margin-bottom:12px;transition:all .3s}
.acard.idle{opacity:.35}.acard.active{opacity:1;animation:aglow .9s ease infinite alternate}.acard.done{opacity:1}
@keyframes aglow{from{box-shadow:0 0 0 rgba(245,158,11,0)}to{box-shadow:0 0 22px rgba(245,158,11,.12)}}
.dots span{width:5px;height:5px;border-radius:50%;display:inline-block;animation:dp 1.2s ease infinite}
.dots span:nth-child(2){animation-delay:.2s}.dots span:nth-child(3){animation-delay:.4s}
@keyframes dp{0%,80%,100%{transform:scale(.5);opacity:.2}40%{transform:scale(1);opacity:1}}
.verdict-ok{background:#061208;border:1.5px solid #1a4a22;border-radius:9px;padding:14px;margin-top:8px}
.verdict-no{background:#120606;border:1.5px solid #4a1a1a;border-radius:9px;padding:14px;margin-top:8px}
.spin{animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(max-width:560px){.g2{grid-template-columns:1fr}.g3{grid-template-columns:1fr 1fr}.g3>:first-child{grid-column:1/-1}}
`;

// ─── Giriş Ekranı ──────────────────────────────────────────────────────────────
function Login({ onLogin, adminPin }) {
  const [ad,setAd]=useState(""); const [pin,setPin]=useState(""); const [err,setErr]=useState("");
  const go=()=>{
    const t=ad.trim(); if(!t) return setErr("İsim boş bırakılamaz.");
    if(pin===adminPin) return onLogin({ad:t,rol:"admin"});
    const u=USERS.find(x=>x.ad.toLowerCase()===t.toLowerCase());
    if(u){ if(u.pin!==pin) return setErr("PIN hatalı."); return onLogin({ad:u.ad,rol:"kullanici"}); }
    setErr("Kullanıcı bulunamadı. Tanımlılar: Mustafa, Samet");
  };
  return (
    <div style={{minHeight:"100vh",background:"#06080e",display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <style>{CSS}</style>
      <div style={{width:"100%",maxWidth:370}}>
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:38,marginBottom:10}}>📦</div>
          <div style={{fontSize:10,letterSpacing:4,color:"#f59e0b",textTransform:"uppercase",marginBottom:4}}>Satış Yönetimi</div>
          <div style={{fontSize:24,fontWeight:700,color:"#e4e0d8",fontFamily:"'IBM Plex Mono'"}}>Sipariş Sistemi</div>
        </div>
        <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:13,padding:26}}>
          <div style={{marginBottom:13}}><label className="lbl">Adınız</label>
            <input className="inp" placeholder="Mustafa veya Samet" value={ad} onChange={e=>{setAd(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&go()} autoFocus /></div>
          <div style={{marginBottom:18}}><label className="lbl">PIN</label>
            <input className="inp" type="password" placeholder="••••" value={pin} onChange={e=>{setPin(e.target.value);setErr("");}} onKeyDown={e=>e.key==="Enter"&&go()} maxLength={8}/></div>
          {err&&<div style={{background:"#180808",border:"1px solid #3a1010",borderRadius:7,padding:"9px 12px",color:"#f87171",fontSize:12,marginBottom:14,lineHeight:1.5}}>{err}</div>}
          <button className="btn btn-g" style={{width:"100%",padding:13,fontSize:13}} onClick={go}>Giriş Yap →</button>
          <div style={{marginTop:16,background:"#06080e",borderRadius:8,padding:"12px 13px"}}>
            <div style={{fontSize:10,letterSpacing:2,color:"#282a3a",textTransform:"uppercase",marginBottom:7}}>Tanımlı Kullanıcılar</div>
            {USERS.map(u=><div key={u.ad} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #141628"}}>
              <span style={{color:"#888",fontSize:12,fontFamily:"'IBM Plex Sans'",fontWeight:600}}>{u.ad}</span>
              <span style={{color:"#282a3a",fontSize:11}}>PIN: {"•".repeat(u.pin.length)}</span></div>)}
            <div style={{marginTop:8,fontSize:10,color:"#202230"}}>Admin girişi için yönetici PINi kullanın.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sipariş Formu ─────────────────────────────────────────────────────────────
function SipForm({ initial, orders, onSave, onPreview, onYeni }) {
  const [s,setS]=useState(initial);
  const [msg,setMsg]=useState("");
  const setF=(k,v)=>setS(p=>({...p,[k]:v}));
  const setIt=(id,k,v)=>setS(p=>({...p,items:p.items.map(it=>it.id===id?{...it,[k]:v}:it)}));
  const addIt=()=>setS(p=>({...p,items:[...p.items,emptyItem()]}));
  const delIt=id=>setS(p=>({...p,items:p.items.length>1?p.items.filter(it=>it.id!==id):p.items}));
  const valid=s.satisci&&s.plaka&&s.firma&&s.items.some(i=>i.malzeme);
  const save=async()=>{ await onSave(s); setMsg("✓ Kaydedildi"); setTimeout(()=>setMsg(""),2000); };
  return (
    <div>
      <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span className="nobadge">🔢 {s.no}</span>
        {msg&&<span style={{fontSize:11,color:"#4ade80"}}>{msg}</span>}
        <div style={{marginLeft:"auto",display:"flex",gap:6}}>
          <button className="btn btn-ghost" style={{fontSize:10,padding:"6px 11px"}} onClick={()=>{const n=onYeni();setS(n);}}>+ Yeni</button>
          <button className="btn btn-ghost" style={{fontSize:10,padding:"6px 11px"}} disabled={!valid} onClick={save}>💾 Kaydet</button>
        </div>
      </div>
      <div style={{marginBottom:20}}>
        <div className="sec">01 — Genel Bilgiler</div>
        <div className="g2" style={{marginBottom:9}}>
          <div><label className="lbl">Satışçı Adı *</label><input className="inp" value={s.satisci} onChange={e=>setF("satisci",e.target.value)}/></div>
          <div><label className="lbl">Sipariş Tarihi *</label><input className="inp" type="date" value={s.tarih} onChange={e=>setF("tarih",e.target.value)}/></div>
        </div>
        <div className="g2" style={{marginBottom:9}}>
          <div><label className="lbl">Gönderim Tarihi</label><input className="inp" type="date" value={s.gonderimTarihi} onChange={e=>setF("gonderimTarihi",e.target.value)}/></div>
          <div/>
        </div>
        <div className="g2" style={{marginBottom:9}}>
          <div><label className="lbl">Araç Plakası *</label><input className="inp" placeholder="34 ABC 123" value={s.plaka} onChange={e=>setF("plaka",e.target.value.toUpperCase())} style={{textTransform:"uppercase",letterSpacing:2}}/></div>
          <div><label className="lbl">Gideceği Firma *</label><input className="inp" placeholder="Firma Adı" value={s.firma} onChange={e=>setF("firma",e.target.value)}/></div>
        </div>
        <div><label className="lbl">Teslimat Adresi</label><input className="inp" placeholder="Opsiyonel" value={s.adres} onChange={e=>setF("adres",e.target.value)}/></div>
      </div>
      <div style={{marginBottom:20}}>
        <div className="sec">02 — Malzeme Listesi</div>
        {s.items.map((it,idx)=>(
          <div key={it.id} className="irow">
            <span className="ibadge">{idx+1}. KALEM</span>
            <div className="g3" style={{marginTop:10}}>
              <div><label className="lbl">Malzeme Adı</label><input className="inp" placeholder="Malzeme" value={it.malzeme} onChange={e=>setIt(it.id,"malzeme",e.target.value)}/></div>
              <div><label className="lbl">Miktar</label><input className="inp" type="number" placeholder="0" value={it.miktar} onChange={e=>setIt(it.id,"miktar",e.target.value)}/></div>
              <div><label className="lbl">Birim</label><select className="inp" value={it.birim} onChange={e=>setIt(it.id,"birim",e.target.value)}>{BRIMLER.map(b=><option key={b}>{b}</option>)}</select></div>
            </div>
            <div style={{marginTop:8,display:"flex",gap:8,alignItems:"flex-end"}}>
              <div style={{flex:1}}><label className="lbl">Not</label><input className="inp" placeholder="Opsiyonel..." value={it.notlar} onChange={e=>setIt(it.id,"notlar",e.target.value)}/></div>
              {s.items.length>1&&<button className="btn btn-red" onClick={()=>delIt(it.id)}>✕</button>}
            </div>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={addIt} style={{width:"100%",borderStyle:"dashed",marginTop:4}}>+ Malzeme Ekle</button>
      </div>
      <div style={{marginBottom:20}}>
        <div className="sec">03 — Notlar</div>
        <textarea className="inp" rows={3} placeholder="Sipariş notu..." value={s.not} onChange={e=>setF("not",e.target.value)}/>
      </div>
      <button className="btn btn-y" style={{width:"100%",padding:13,fontSize:13}} disabled={!valid} onClick={()=>onPreview(s)}>
        Önizle &amp; WhatsApp Mesajı →
      </button>
      {!valid&&<div style={{textAlign:"center",marginTop:7,fontSize:11,color:"#282a3a"}}>* Satışçı, plaka, firma ve en az 1 malzeme zorunludur</div>}
    </div>
  );
}

// ─── Sipariş Kartı ─────────────────────────────────────────────────────────────
function OCard({ rec, session, isAdmin, onToggle, onEdit, onDel }) {
  const editable=isAdmin||rec.kullanici===session.ad;
  return (
    <div className={`ocard ${rec.tamamlandi?"done":""}`}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
        <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
          <span style={{fontSize:11,fontWeight:700,color:rec.tamamlandi?"#4ade80":"#f59e0b"}}>{rec.no}</span>
          {rec.tamamlandi&&<span style={{fontSize:9,background:"#06100a",color:"#4ade80",border:"1px solid #143a1a",borderRadius:10,padding:"1px 7px"}}>✓ TAMAMLANDI</span>}
          <span style={{fontSize:10,color:"#282a3a",fontFamily:"'IBM Plex Sans'"}}>{rec.kullanici}</span>
        </div>
        <span style={{fontSize:10,color:"#282a3a"}}>{new Date(rec.savedAt).toLocaleDateString("tr-TR")}</span>
      </div>
      <div style={{marginBottom:9,cursor:editable?"pointer":"default"}} onClick={()=>editable&&onEdit(rec)}>
        <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:3}}>
          <span style={{fontFamily:"'IBM Plex Sans'",fontWeight:700,fontSize:14,color:rec.tamamlandi?"#3a6a3a":"#d4d0c8"}}>{rec.firma}</span>
          <span style={{fontFamily:"monospace",fontSize:11,letterSpacing:2,color:"#383a52"}}>{rec.plaka}</span>
        </div>
        <div style={{fontSize:11,color:"#383a52"}}>{rec.satisci} • {(rec.items||[]).filter(i=>i.malzeme).length} kalem</div>
      </div>
      {(rec.items||[]).filter(i=>i.malzeme&&i.miktar).length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:9}}>
          {(rec.items||[]).filter(i=>i.malzeme&&i.miktar).map((it,i)=>(
            <span key={i} style={{fontSize:10,background:"#06080e",border:"1px solid #141628",borderRadius:4,padding:"2px 7px",color:"#484a62"}}>{it.miktar} {it.birim} {it.malzeme}</span>
          ))}
        </div>
      )}
      <div style={{display:"flex",gap:5,borderTop:`1px solid ${rec.tamamlandi?"#142018":"#141628"}`,paddingTop:9}}>
        {editable?<>
          <button className={rec.tamamlandi?"btn btn-done":"btn btn-g"} style={{fontSize:11,padding:"6px 12px"}} onClick={e=>onToggle(e,rec.no)}>
            {rec.tamamlandi?"↩ Geri Al":"✓ Tamamlandı"}</button>
          <button className="btn btn-ghost" style={{fontSize:10,padding:"6px 11px"}} onClick={()=>onEdit(rec)}>✏️</button>
          {isAdmin&&<button className="btn btn-red" style={{marginLeft:"auto"}} onClick={e=>{e.stopPropagation();onDel(rec.no);}}>🗑</button>}
        </>:<span style={{fontSize:11,color:"#202230",alignSelf:"center"}}>👁 Görüntüleme</span>}
      </div>
    </div>
  );
}

// ─── Birim Toplamlar Pills ──────────────────────────────────────────────────────
function UnitPills({orders}) {
  const t=calcBirimToplamlar(orders);
  if(!Object.keys(t).length) return <div style={{color:"#202230",fontSize:12,padding:"4px 0"}}>Bekleyen sipariş yok</div>;
  return <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
    {Object.entries(t).map(([b,n])=>(
      <div key={b} className={`pill ${b==="Palet"?"pal":b==="Set"?"set":b==="Adet"?"adt":""}`}>
        <span style={{fontWeight:700,fontSize:14,color:b==="Palet"?"#60a5fa":b==="Set"?"#c084fc":b==="Adet"?"#4ade80":"#f59e0b"}}>
          {Number.isInteger(n)?n:n.toFixed(1)}</span>
        <span style={{color:"#484a62",fontSize:11}}>{b}</span>
      </div>
    ))}</div>;
}

// ─── Kümülatif Toplamlar ────────────────────────────────────────────────────────
function Kumulatif({orders}) {
  const [filtre,setFiltre]=useState("bekleyen");
  const rows=calcKumulatif(orders,filtre);
  const birimRenk=b=>b==="Palet"?"#60a5fa":b==="Set"?"#c084fc":b==="Adet"?"#4ade80":b==="Kg"?"#fb923c":b==="Ton"?"#f87171":"#f59e0b";
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <div className="sec" style={{margin:0,flex:1}}>Kümülatif Malzeme Toplamları</div>
        <div style={{display:"flex",gap:4}}>
          {["bekleyen","hepsi"].map(f=>(
            <button key={f} className="btn btn-ghost" style={{fontSize:10,padding:"6px 11px",...(filtre===f?{borderColor:"#f59e0b",color:"#f59e0b"}:{})}}
              onClick={()=>setFiltre(f)}>
              {f==="bekleyen"?"Bekleyenler":"Tümü"}
            </button>
          ))}
        </div>
      </div>
      {rows.length===0&&<div style={{textAlign:"center",padding:"30px 0",color:"#202230",fontSize:13}}>Gösterilecek veri yok.</div>}
      {rows.length>0&&(
        <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:10,overflow:"hidden"}}>
          <table className="ktable">
            <thead>
              <tr>
                <th>Malzeme</th>
                <th>Birim</th>
                <th style={{textAlign:"right"}}>Toplam</th>
                <th style={{textAlign:"right"}}>Sipariş Sayısı</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i}>
                  <td style={{fontFamily:"'IBM Plex Sans'",fontWeight:600,color:"#d4d0c8"}}>{r.malzeme}</td>
                  <td><span style={{fontSize:11,background:"#06080e",border:"1px solid #141628",borderRadius:4,padding:"2px 8px",color:birimRenk(r.birim),fontWeight:600}}>{r.birim}</span></td>
                  <td style={{textAlign:"right"}}><span className="num" style={{color:birimRenk(r.birim)}}>{Number.isInteger(r.toplam)?r.toplam:r.toplam.toFixed(2)}</span></td>
                  <td style={{textAlign:"right",fontSize:11,color:"#484a62"}}>{r.siparisler.length} sipariş</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Ajan Paneli ───────────────────────────────────────────────────────────────
async function callAgent(agent, talep, prevReports="") {
  const content = prevReports
    ? `Geliştirme talebi:\n${talep}\n\n---\nÖnceki ajan raporları:\n${prevReports}`
    : `Geliştirme talebi:\n${talep}`;
  const r = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:800,
      system:agent.sistem, messages:[{role:"user",content}] })
  });
  const d=await r.json();
  return d.content?.[0]?.text||"Yanıt alınamadı.";
}

function AjanPanel() {
  const [talep,setTalep]=useState("");
  const [aktif,setAktif]=useState(false);
  const [asama,setAsama]=useState(-1);
  const [raporlar,setRaporlar]=useState({});
  const [gecmis,setGecmis]=useState([]);
  const abortRef=useRef(false);

  const baslat=async()=>{
    if(!talep.trim()||aktif) return;
    abortRef.current=false; setAktif(true); setAsama(0); setRaporlar({});
    const toplanan={};
    for(let i=0;i<AGENT_ORDER.length;i++){
      if(abortRef.current) break;
      const id=AGENT_ORDER[i]; setAsama(i);
      const prev=Object.entries(toplanan).map(([k,v])=>`[${AGENTS[k].isim}]\n${v}`).join("\n\n");
      try { toplanan[id]=await callAgent(AGENTS[id],talep,prev); } catch(e){ toplanan[id]="⚠️ Hata: "+e.message; }
      setRaporlar({...toplanan});
    }
    const kayit={id:Date.now(),talep:talep.trim(),tarih:new Date().toLocaleString("tr-TR"),
      raporlar:{...toplanan},onaylandi:toplanan.lider?.includes("ONAYLANDI")};
    setGecmis(p=>[kayit,...p].slice(0,15));
    setAsama(AGENT_ORDER.length); setAktif(false);
  };
  const iptal=()=>{abortRef.current=true;setAktif(false);setAsama(-1);};
  const lider=raporlar["lider"]||"";
  const onaylandi=lider.includes("ONAYLANDI"), reddedildi=lider.includes("REDDEDİLDİ");
  const prog=aktif?(asama/AGENT_ORDER.length*100):Object.keys(raporlar).length>0?100:0;

  return (
    <div>
      {/* Talep girişi */}
      <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:11,padding:18,marginBottom:16}}>
        <div className="sec">Geliştirme Talebi</div>
        <textarea className="inp" rows={4} disabled={aktif}
          placeholder={"Sisteme eklemek istediğiniz özelliği yazın...\nÖrnek: Sipariş listesine Excel dışa aktarma ekleyelim"}
          value={talep} onChange={e=>setTalep(e.target.value)} style={{marginBottom:10}}/>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-y" style={{flex:1,padding:12,fontSize:12}} disabled={aktif||!talep.trim()} onClick={baslat}>
            {aktif?<><div className="dots"><span style={{background:"#000"}}/><span style={{background:"#000"}}/><span style={{background:"#000"}}/></div>Ekip Çalışıyor...</>:"🚀 Ekibi Başlat"}
          </button>
          {aktif&&<button className="btn btn-ghost" onClick={iptal}>İptal</button>}
        </div>
        {prog>0&&<div style={{height:3,background:"#1a1d2e",borderRadius:3,overflow:"hidden",marginTop:12}}>
          <div style={{height:"100%",background:"linear-gradient(90deg,#f59e0b,#60a5fa)",width:`${prog}%`,transition:"width .5s"}}/>
        </div>}
        {aktif&&asama<AGENT_ORDER.length&&<div style={{textAlign:"center",fontSize:11,color:"#484a62",marginTop:7}}>
          {AGENTS[AGENT_ORDER[asama]].emoji} {AGENTS[AGENT_ORDER[asama]].isim} analiz ediyor...</div>}
      </div>

      {/* Ajan kartları */}
      {AGENT_ORDER.map((id,i)=>{
        const ag=AGENTS[id]; const r=raporlar[id];
        const st=aktif&&asama===i?"active":r?"done":"idle";
        return (
          <div key={id} className={`acard ${st}`} style={{background:ag.bg,border:`1.5px solid ${st==="idle"?"#1a1d2e":ag.border}`}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:11}}>
                <div style={{width:40,height:40,background:"#06080e",border:`1.5px solid ${ag.border}`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{ag.emoji}</div>
                <div>
                  <div style={{fontWeight:700,fontSize:12,color:ag.renk}}>{ag.isim}</div>
                  <div style={{fontSize:10,color:"#282a3a",letterSpacing:1,textTransform:"uppercase",marginTop:1}}>
                    {id==="kodcu"?"Frontend & React":id==="tasarimci"?"UI/UX & Tasarım":id==="kalite"?"QA & Test":"Koordinasyon & Karar"}
                  </div>
                </div>
              </div>
              {st==="active"&&<div className="dots"><span style={{background:ag.renk}}/><span style={{background:ag.renk}}/><span style={{background:ag.renk}}/></div>}
              {st==="done"&&!r?.includes("⚠️")&&<span style={{color:ag.renk,fontSize:16}}>✓</span>}
            </div>
            {r&&(
              id==="lider"?(
                <div className={onaylandi?"verdict-ok":reddedildi?"verdict-no":""} style={{marginTop:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:6}}>
                    <span style={{fontSize:16}}>{onaylandi?"✅":reddedildi?"❌":"📋"}</span>
                    <span style={{fontWeight:700,fontSize:12,color:onaylandi?"#4ade80":reddedildi?"#f87171":"#f59e0b"}}>
                      {onaylandi?"ONAYLANDI — Geliştirme Başlayabilir":reddedildi?"REDDEDİLDİ":"Karar..."}
                    </span>
                  </div>
                  <div style={{fontFamily:"'IBM Plex Sans'",fontSize:12,lineHeight:1.8,color:"#908c88",paddingTop:8,borderTop:"1px solid rgba(255,255,255,.05)"}}>{r}</div>
                </div>
              ):(
                <div style={{fontFamily:"'IBM Plex Sans'",fontSize:12,lineHeight:1.8,color:"#908c88",marginTop:10,paddingTop:10,borderTop:"1px solid rgba(255,255,255,.05)"}}>{r}</div>
              )
            )}
          </div>
        );
      })}

      {/* Geçmiş */}
      {gecmis.length>0&&(
        <div style={{marginTop:20}}>
          <div className="sec">Geliştirme Geçmişi</div>
          {gecmis.map(k=>(
            <div key={k.id} style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:9,padding:13,marginBottom:7,cursor:"pointer"}}
              onClick={()=>setRaporlar(k.raporlar)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <span style={{fontSize:14}}>{k.onaylandi?"✅":"❌"}</span>
                  <span style={{fontSize:11,fontWeight:700,color:k.onaylandi?"#4ade80":"#f87171"}}>{k.onaylandi?"ONAYLANDI":"REDDEDİLDİ"}</span>
                </div>
                <span style={{fontSize:10,color:"#282a3a"}}>{k.tarih}</span>
              </div>
              <div style={{fontFamily:"'IBM Plex Sans'",fontSize:12,color:"#606280",lineHeight:1.5}}>{k.talep.slice(0,100)}{k.talep.length>100?"...":""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ana Uygulama ──────────────────────────────────────────────────────────────
export default function App() {
  const [session,setSession]=useState(null);
  const [orders,setOrders]=useState([]);
  const [adminPin,setAdminPin]=useState(ADMIN_PIN_DEFAULT);
  const [loading,setLoading]=useState(true);
  const [view,setView]=useState("dashboard");
  const [formInit,setFormInit]=useState(null);
  const [editRec,setEditRec]=useState(null);
  const [preview,setPreview]=useState(null);
  const [copied,setCopied]=useState(false);
  const [delConfirm,setDelConfirm]=useState(null);
  const [refreshing,setRefreshing]=useState(false);
  const [yeniAdminPin,setYeniAdminPin]=useState("");
  const [adminMsg,setAdminMsg]=useState("");
  const isAdmin=session?.rol==="admin";

  // İlk yükleme: session + orders + config
  useEffect(()=>{
    (async()=>{
      const [sess,ords,cfg]=await Promise.all([store.getSession(),store.getOrders(),store.getConfig()]);
      if(sess) setSession(sess);
      setOrders(ords||[]);
      setAdminPin(cfg?.pin||ADMIN_PIN_DEFAULT);
      setLoading(false);
    })();
  },[]);

  // Session değişince storage'a kaydet
  useEffect(()=>{ if(!loading) store.saveSession(session); },[session,loading]);

  // Orders değişince form için başlangıç oluştur (sadece ilk giriş)
  useEffect(()=>{
    if(session && !formInit && orders!==null) {
      setFormInit(blankSiparis(orders,session.ad));
    }
  },[session,orders,formInit]);

  const saveOrders=async updated=>{
    if(!Array.isArray(updated)) return;
    setOrders(updated);
    await store.saveOrders(updated);
  };

  const manualRefresh=async()=>{
    setRefreshing(true);
    const ords=await store.getOrders();
    setOrders(ords||[]);
    setTimeout(()=>setRefreshing(false),500);
  };

  const handleSave=async s=>{
    const idx=orders.findIndex(o=>o.no===s.no);
    const updated=idx>=0
      ? orders.map((o,i)=>i===idx?{...s,savedAt:o.savedAt,tamamlandi:o.tamamlandi}:o)
      : [{...s,savedAt:new Date().toISOString(),tamamlandi:false},...orders].slice(0,300);
    await saveOrders(updated);
  };

  const handleToggle=async(e,no)=>{
    e.stopPropagation();
    await saveOrders(orders.map(o=>o.no===no?{...o,tamamlandi:!o.tamamlandi}:o));
  };

  const handleDel=async no=>{
    await saveOrders(orders.filter(o=>o.no!==no));
    setDelConfirm(null);
  };

  const handleEdit=rec=>{
    setEditRec({...rec,items:(rec.items||[]).map(it=>({...it,id:uid()}))});
    setView("edit");
  };

  const handleEditSave=async s=>{
    await handleSave(s); setEditRec(null); setView("orders");
  };

  const changeAdminPin=async()=>{
    if(!yeniAdminPin||yeniAdminPin.length<4) return setAdminMsg("Min 4 karakter!");
    const cfg={pin:yeniAdminPin};
    setAdminPin(yeniAdminPin); await store.saveConfig(cfg);
    setYeniAdminPin(""); setAdminMsg("✓ Güncellendi"); setTimeout(()=>setAdminMsg(""),2500);
  };

  if(loading) return <div style={{minHeight:"100vh",background:"#06080e",display:"flex",alignItems:"center",justifyContent:"center"}}><style>{CSS}</style><div style={{color:"#202230",fontFamily:"monospace",fontSize:11,letterSpacing:3}}>YÜKLENİYOR...</div></div>;
  if(!session) return <Login onLogin={s=>{setSession(s);setView("dashboard");}} adminPin={adminPin}/>;
  if(!formInit) return null;

  const myOrders=orders.filter(o=>o.kullanici===session.ad);
  const beklCount=orders.filter(o=>!o.tamamlandi).length;
  const tamCount=orders.filter(o=>o.tamamlandi).length;
  const myBekl=myOrders.filter(o=>!o.tamamlandi).length;

  const adminTabs=[["dashboard","📊 Özet"],["orders","📋 Siparişler"+(orders.length?` (${orders.length})`:"")] ,["form","✏️ Yeni"],["kumul","📈 Toplamlar"],["yonetim","⚙️ Yönetim"],["ekip","🤖 Ekip"]];
  const userTabs=[["dashboard","📊 Özet"],["form","✏️ Yeni Sipariş"],["myorders","📋 Siparişlerim"+(myOrders.length?` (${myOrders.length})`:"")] ,["allorders","🌐 Tüm"],["kumul","📈 Toplamlar"],["ekip","🤖 Ekip"]];
  const tabs=isAdmin?adminTabs:userTabs;

  return (
    <div style={{fontFamily:"'IBM Plex Mono','Courier New',monospace",minHeight:"100vh",background:"#06080e",color:"#e4e0d8"}}>
      <style>{CSS}</style>

      {/* Silme Modal */}
      {delConfirm&&<div className="modal-bg" onClick={()=>setDelConfirm(null)}>
        <div className="modal" style={{maxWidth:330}} onClick={e=>e.stopPropagation()}>
          <div style={{color:"#f87171",fontSize:11,letterSpacing:2,textTransform:"uppercase",marginBottom:9}}>Siparişi Sil</div>
          <div style={{color:"#808090",fontSize:13,marginBottom:18,fontFamily:"'IBM Plex Sans'",lineHeight:1.6}}>
            <strong style={{color:"#e4e0d8"}}>{delConfirm}</strong> numaralı sipariş kalıcı silinecek.</div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-red" style={{flex:1,padding:11}} onClick={()=>handleDel(delConfirm)}>Evet, Sil</button>
            <button className="btn btn-ghost" style={{flex:1,padding:11}} onClick={()=>setDelConfirm(null)}>İptal</button>
          </div>
        </div>
      </div>}

      {/* Önizleme Modal */}
      {preview&&<div className="modal-bg" onClick={()=>setPreview(null)}>
        <div className="modal" style={{maxWidth:500}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div className="sec" style={{margin:0}}>WhatsApp Önizleme</div>
            <button className="btn btn-ghost" style={{fontSize:10,padding:"5px 9px"}} onClick={()=>setPreview(null)}>✕</button>
          </div>
          <div className="prebox" style={{marginBottom:12}}>{toWhatsApp(preview)}</div>
          <div style={{display:"flex",gap:8}}>
            <button className={`btn ${copied?"btn-done":"btn-y"}`} style={{flex:1}}
              onClick={()=>navigator.clipboard.writeText(toWhatsApp(preview)).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);})}>
              {copied?"✓ Kopyalandı!":"📋 Kopyala"}</button>
            <button className="btn btn-ghost" onClick={()=>setPreview(null)}>Kapat</button>
          </div>
        </div>
      </div>}

      {/* Header */}
      <div style={{background:"#080a16",borderBottom:"1.5px solid #1a1d2e",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div>
          <div style={{fontSize:9,letterSpacing:4,color:"#f59e0b",textTransform:"uppercase"}}>Satış Yönetimi</div>
          <div style={{fontSize:16,fontWeight:700,letterSpacing:.5}}>Sipariş Sistemi</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button style={{background:"none",border:"none",color:refreshing?"#f59e0b":"#282a3a",cursor:"pointer",fontSize:16,padding:"2px 6px",transition:"all .3s"}}
            title="Siparişleri yenile" onClick={manualRefresh}>
            <span style={{display:"inline-block"}} className={refreshing?"spin":""}>⟳</span>
          </button>
          <div style={{width:1,height:28,background:"#1a1d2e"}}/>
          <div style={{textAlign:"right"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"flex-end",marginBottom:2}}>
              <span style={{fontSize:12,fontFamily:"'IBM Plex Sans'",fontWeight:700}}>{session.ad}</span>
              <span className={isAdmin?"ba":"bu"}>{isAdmin?"Admin":"Kullanıcı"}</span>
            </div>
            <button style={{background:"none",border:"none",color:"#202230",fontSize:9,cursor:"pointer",letterSpacing:1,textTransform:"uppercase"}}
              onClick={()=>setSession(null)}>çıkış</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tnav">
        {tabs.map(([k,l])=>(
          <button key={k} className={`tbtn ${view===k?"on":""}`}
            onClick={()=>{
              if(k==="form"){setFormInit(blankSiparis(orders,session.ad));}
              setView(k);
            }}>{l}</button>
        ))}
      </div>

      <div style={{maxWidth:740,margin:"0 auto",padding:"18px 14px"}}>

        {/* DASHBOARD */}
        {view==="dashboard"&&<div>
          <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
            {isAdmin?<>
              <div className="sbox"><div style={{fontSize:22,fontWeight:700,color:"#f59e0b"}}>{beklCount}</div><div style={{fontSize:9,color:"#484a62",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Bekleyen</div></div>
              <div className="sbox g"><div style={{fontSize:22,fontWeight:700,color:"#4ade80"}}>{tamCount}</div><div style={{fontSize:9,color:"#2a4a2a",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Tamamlanan</div></div>
              <div className="sbox"><div style={{fontSize:22,fontWeight:700,color:"#a0a0b0"}}>{orders.length}</div><div style={{fontSize:9,color:"#484a62",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Toplam</div></div>
              <div className="sbox b"><div style={{fontSize:22,fontWeight:700,color:"#60a5fa"}}>{USERS.length}</div><div style={{fontSize:9,color:"#2a4070",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Kullanıcı</div></div>
            </>:<>
              <div className="sbox"><div style={{fontSize:22,fontWeight:700,color:"#f59e0b"}}>{myBekl}</div><div style={{fontSize:9,color:"#484a62",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Bekleyen</div></div>
              <div className="sbox g"><div style={{fontSize:22,fontWeight:700,color:"#4ade80"}}>{myOrders.length-myBekl}</div><div style={{fontSize:9,color:"#2a4a2a",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Tamamlanan</div></div>
              <div className="sbox"><div style={{fontSize:22,fontWeight:700,color:"#a0a0b0"}}>{myOrders.length}</div><div style={{fontSize:9,color:"#484a62",letterSpacing:2,textTransform:"uppercase",marginTop:2}}>Toplam</div></div>
            </>}
          </div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:10,padding:14,marginBottom:14}}>
            <div className="sec">Bekleyenlerde Toplam Kalemler</div>
            <UnitPills orders={orders}/>
          </div>
          <div className="sec">{isAdmin?"Son Siparişler":"Son Siparişlerim"}</div>
          {(isAdmin?orders:myOrders).slice(0,4).map(rec=><OCard key={rec.no} rec={rec} session={session} isAdmin={isAdmin} onToggle={handleToggle} onEdit={handleEdit} onDel={setDelConfirm}/>)}
          {orders.length===0&&<div style={{textAlign:"center",padding:"28px 0",color:"#202230",fontSize:13}}>Henüz sipariş yok.</div>}
          {(isAdmin?orders:myOrders).length>4&&<button className="btn btn-ghost" style={{width:"100%",marginTop:4}} onClick={()=>setView(isAdmin?"orders":"myorders")}>Tümünü Gör →</button>}
        </div>}

        {/* YENİ SİPARİŞ */}
        {view==="form"&&<SipForm initial={formInit} orders={orders}
          onSave={handleSave} onPreview={setPreview}
          onYeni={()=>{const n=blankSiparis(orders,session.ad);setFormInit(n);return n;}}/>}

        {/* DÜZENLE */}
        {view==="edit"&&editRec&&<div>
          <div style={{marginBottom:14,display:"flex",alignItems:"center",gap:9}}>
            <button className="btn btn-ghost" style={{fontSize:10,padding:"6px 11px"}} onClick={()=>{setEditRec(null);setView("orders");}}>← Geri</button>
            <span style={{fontSize:11,color:"#484a62"}}>Düzenleniyor: <strong style={{color:"#f59e0b"}}>{editRec.no}</strong></span>
          </div>
          <SipForm initial={editRec} orders={orders} onSave={handleEditSave} onPreview={setPreview}
            onYeni={()=>{const n=blankSiparis(orders,session.ad);setFormInit(n);setView("form");return n;}}/>
        </div>}

        {/* TÜM SİPARİŞLER */}
        {(view==="orders"||view==="allorders")&&<div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:10,padding:13,marginBottom:13}}>
            <div style={{fontSize:9,letterSpacing:2,color:"#484a62",textTransform:"uppercase",marginBottom:8}}>Bekleyenlerde Toplam</div>
            <UnitPills orders={orders}/>
          </div>
          <div style={{display:"flex",gap:7,marginBottom:13,flexWrap:"wrap"}}>
            <div className="sbox" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#f59e0b"}}>{beklCount}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Bekleyen</div></div>
            <div className="sbox g" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#4ade80"}}>{tamCount}</div><div style={{fontSize:9,color:"#2a4a2a",textTransform:"uppercase",letterSpacing:1}}>Tamamlanan</div></div>
            <div className="sbox" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#a0a0b0"}}>{orders.length}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Toplam</div></div>
          </div>
          <div className="sec">Tüm Siparişler</div>
          {orders.length===0&&<div style={{textAlign:"center",padding:36,color:"#202230",fontSize:13}}>Henüz sipariş yok.</div>}
          {orders.map(rec=><OCard key={rec.no} rec={rec} session={session} isAdmin={isAdmin} onToggle={handleToggle} onEdit={handleEdit} onDel={setDelConfirm}/>)}
        </div>}

        {/* KENDİ SİPARİŞLERİM */}
        {view==="myorders"&&<div>
          <div style={{display:"flex",gap:7,marginBottom:13,flexWrap:"wrap"}}>
            <div className="sbox" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#f59e0b"}}>{myBekl}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Bekleyen</div></div>
            <div className="sbox g" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#4ade80"}}>{myOrders.length-myBekl}</div><div style={{fontSize:9,color:"#2a4a2a",textTransform:"uppercase",letterSpacing:1}}>Tamamlanan</div></div>
            <div className="sbox" style={{minWidth:65}}><div style={{fontSize:18,fontWeight:700,color:"#a0a0b0"}}>{myOrders.length}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Toplam</div></div>
          </div>
          <div className="sec">Siparişlerim</div>
          {myOrders.length===0&&<div style={{textAlign:"center",padding:36,color:"#202230",fontSize:13}}>Henüz sipariş yok.</div>}
          {myOrders.map(rec=><OCard key={rec.no} rec={rec} session={session} isAdmin={false} onToggle={handleToggle} onEdit={handleEdit} onDel={setDelConfirm}/>)}
        </div>}

        {/* KÜMÜLATİF */}
        {view==="kumul"&&<Kumulatif orders={orders}/>}

        {/* YÖNETİM */}
        {view==="yonetim"&&isAdmin&&<div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:11,padding:18,marginBottom:14}}>
            <div className="sec">Kullanıcılar</div>
            {USERS.map(u=>{
              const uc=orders.filter(o=>o.kullanici===u.ad).length;
              const ub=orders.filter(o=>o.kullanici===u.ad&&!o.tamamlandi).length;
              return <div key={u.ad} className="urow">
                <div style={{display:"flex",alignItems:"center",gap:11}}>
                  <div style={{width:34,height:34,background:"#10121e",border:"1.5px solid #1e2130",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#808090",fontFamily:"'IBM Plex Sans'",fontWeight:700}}>{u.ad[0]}</div>
                  <div>
                    <div style={{fontFamily:"'IBM Plex Sans'",fontSize:13,fontWeight:700,color:"#d4d0c8"}}>{u.ad}</div>
                    <div style={{fontSize:10,color:"#282a3a",marginTop:1}}><span style={{color:"#f59e0b"}}>{ub} bekleyen</span> • {uc} toplam</div>
                  </div>
                </div>
                <span className="bu">Kullanıcı</span>
              </div>;
            })}
            <div style={{marginTop:11,padding:"9px 11px",background:"#06080e",borderRadius:7,border:"1px solid #141628",fontSize:11,color:"#282a3a",lineHeight:1.6}}>
              💡 Kullanıcılar sistem içinde sabit tanımlıdır.</div>
          </div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:11,padding:18,marginBottom:14}}>
            <div className="sec">Admin PIN Değiştir</div>
            <div style={{display:"flex",gap:8}}>
              <input className="inp" type="password" placeholder="Yeni PIN (min 4 karakter)" value={yeniAdminPin} onChange={e=>setYeniAdminPin(e.target.value)} maxLength={8}/>
              <button className="btn btn-y" onClick={changeAdminPin}>Kaydet</button>
            </div>
            {adminMsg&&<div style={{marginTop:9,color:"#4ade80",fontSize:12}}>{adminMsg}</div>}
          </div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:11,padding:18}}>
            <div className="sec">İstatistikler</div>
            <div style={{display:"flex",gap:7,flexWrap:"wrap",marginBottom:12}}>
              <div className="sbox" style={{minWidth:85}}><div style={{fontSize:20,fontWeight:700,color:"#f59e0b"}}>{beklCount}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Bekleyen</div></div>
              <div className="sbox g" style={{minWidth:85}}><div style={{fontSize:20,fontWeight:700,color:"#4ade80"}}>{tamCount}</div><div style={{fontSize:9,color:"#2a4a2a",textTransform:"uppercase",letterSpacing:1}}>Tamamlanan</div></div>
              <div className="sbox" style={{minWidth:85}}><div style={{fontSize:20,fontWeight:700,color:"#a0a0b0"}}>{orders.length}</div><div style={{fontSize:9,color:"#484a62",textTransform:"uppercase",letterSpacing:1}}>Toplam</div></div>
            </div>
            <div style={{fontSize:9,letterSpacing:2,color:"#484a62",textTransform:"uppercase",marginBottom:9}}>Kullanıcı Bazlı</div>
            {USERS.map(u=>{
              const uc=orders.filter(o=>o.kullanici===u.ad).length;
              const ub=orders.filter(o=>o.kullanici===u.ad&&!o.tamamlandi).length;
              return <div key={u.ad} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #141628"}}>
                <span style={{fontFamily:"'IBM Plex Sans'",fontSize:13,fontWeight:600}}>{u.ad}</span>
                <div style={{display:"flex",gap:10,fontSize:11}}>
                  <span style={{color:"#f59e0b"}}>{ub} bekleyen</span>
                  <span style={{color:"#484a62"}}>{uc} toplam</span>
                </div>
              </div>;
            })}
          </div>
        </div>}

        {/* AJAN EKİBİ */}
        {view==="ekip"&&<div>
          <div style={{background:"#0c0e1c",border:"1.5px solid #1a1d2e",borderRadius:10,padding:"11px 14px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>🤖</span>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:"#f59e0b"}}>Geliştirme Ekibi</div>
              <div style={{fontSize:10,color:"#484a62",marginTop:2}}>4 ajanlı AI takımı — her öneri onay sürecinden geçer</div>
            </div>
          </div>
          <AjanPanel/>
        </div>}

      </div>
    </div>
  );
}
