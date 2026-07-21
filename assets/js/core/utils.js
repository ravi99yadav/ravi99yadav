/* ==========================================================================
   SUBLETWORKS.COM — Utilities: date/time, formatting, validation, toast, modal
   ========================================================================== */
(function(global){
  "use strict";

  /* ---------- Date / Time / Day ---------- */
  const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function startClock(el){
    function tick(){
      const now = new Date();
      const time = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const date = now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
      const day = DAY_NAMES[now.getDay()];
      if(el){
        el.innerHTML = `<b>${time}</b><span>${day}, ${date}</span>`;
      }
    }
    tick();
    return setInterval(tick,1000);
  }

  function fmtDate(d){
    if(!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  }
  function fmtDateTime(d){
    if(!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) + " · " + dt.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  }
  function fmtINR(n){
    n = Number(n)||0;
    return "₹" + n.toLocaleString('en-IN',{maximumFractionDigits:2});
  }
  function daysBetween(a,b){
    const d1=new Date(a), d2=new Date(b);
    return Math.round((d2-d1)/86400000);
  }
  function relativeTime(d){
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.round(diff/60000);
    if(mins<1) return "just now";
    if(mins<60) return mins+"m ago";
    const hrs = Math.round(mins/60);
    if(hrs<24) return hrs+"h ago";
    const days = Math.round(hrs/24);
    if(days<30) return days+"d ago";
    return fmtDate(d);
  }

  /* ---------- Project health (timeline + financial snapshot) ---------- */
  function projectHealth(project){
    const DB = global.SW.DB;
    const today = new Date();
    const start = project.startDate ? new Date(project.startDate) : null;
    const end = project.endDate ? new Date(project.endDate) : null;
    let totalDays=null, elapsedDays=null, remainingDays=null, timeConsumedPct=null, overdue=false;
    if(start && end){
      totalDays = daysBetween(start,end);
      const rawElapsed = daysBetween(start, today);
      elapsedDays = Math.max(0, Math.min(totalDays, rawElapsed));
      remainingDays = Math.max(0, totalDays - elapsedDays);
      timeConsumedPct = totalDays>0 ? Math.min(100, (elapsedDays/totalDays)*100) : 0;
      overdue = rawElapsed > totalDays && (project.progressPct||0) < 100;
    }
    let contractValue = project.contractValue || 0;
    if(!contractValue && project.tenderId){
      const loi = DB.lois.list(l=>l.tenderId===project.tenderId)[0];
      if(loi) contractValue = loi.contractValue || 0;
    }
    const bills = DB.raBills.list(r=>r.projectId===project.id && r.status!=="rejected");
    const billedAmount = bills.reduce((s,b)=>s+(b.currentGrossAmount||0),0);
    const balanceAmount = Math.max(0, contractValue - billedAmount);
    return {
      totalDays, elapsedDays, remainingDays, timeConsumedPct, overdue,
      workPct: project.progressPct||0, contractValue, billedAmount, balanceAmount
    };
  }

  /* ---------- Validators ---------- */
  const Validate = {
    email(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v||""); },
    phone(v){ return /^[6-9]\d{9}$/.test((v||"").replace(/\D/g,"").slice(-10)); },
    gst(v){ return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test((v||"").toUpperCase()); },
    pan(v){ return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test((v||"").toUpperCase()); },
    required(v){ return v!==undefined && v!==null && String(v).trim().length>0; },
    number(v){ return v!=="" && !isNaN(Number(v)); },
    minLen(v,n){ return String(v||"").length>=n; }
  };

  function validateForm(formEl){
    let valid = true;
    formEl.querySelectorAll("[data-validate]").forEach(input=>{
      const rules = input.dataset.validate.split("|");
      const field = input.closest(".field") || input.closest(".field-float");
      let fieldValid = true, msg = "";
      rules.forEach(rule=>{
        const [name,arg] = rule.split(":");
        if(name==="required" && !Validate.required(input.value)){ fieldValid=false; msg="This field is required."; }
        else if(name==="email" && input.value && !Validate.email(input.value)){ fieldValid=false; msg="Enter a valid email address."; }
        else if(name==="phone" && input.value && !Validate.phone(input.value)){ fieldValid=false; msg="Enter a valid 10-digit mobile number."; }
        else if(name==="gst" && input.value && !Validate.gst(input.value)){ fieldValid=false; msg="Enter a valid GSTIN."; }
        else if(name==="pan" && input.value && !Validate.pan(input.value)){ fieldValid=false; msg="Enter a valid PAN."; }
        else if(name==="number" && input.value!=="" && !Validate.number(input.value)){ fieldValid=false; msg="Enter a valid number."; }
        else if(name==="minlen" && !Validate.minLen(input.value,arg)){ fieldValid=false; msg=`Minimum ${arg} characters required.`; }
      });
      if(field){
        field.classList.toggle("has-error", !fieldValid);
        const err = field.querySelector(".error-msg");
        if(err) err.textContent = msg;
      }
      if(!fieldValid) valid = false;
    });
    return valid;
  }

  /* ---------- Toast ---------- */
  function ensureToastRegion(){
    let region = document.querySelector(".toast-region");
    if(!region){ region = document.createElement("div"); region.className="toast-region"; document.body.appendChild(region); }
    return region;
  }
  function toast(msg, opts){
    opts = opts||{};
    const region = ensureToastRegion();
    const el = document.createElement("div");
    el.className = "toast " + (opts.type||"");
    el.innerHTML = `<div>${opts.title?`<div class="toast-title">${opts.title}</div>`:""}<div class="toast-msg">${msg}</div></div>`;
    region.appendChild(el);
    setTimeout(()=>{ el.classList.add("removing"); setTimeout(()=>el.remove(),200); }, opts.duration||3800);
  }

  /* ---------- Confetti ---------- */
  function confetti(){
    const colors = ["#5B5CEB","#00C2FF","#22C55E","#F59E0B","#A855F7"];
    for(let i=0;i<28;i++){
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random()*100+"vw";
      p.style.background = colors[i%colors.length];
      p.style.animationDelay = (Math.random()*.3)+"s";
      p.style.borderRadius = Math.random()>.5 ? "50%":"2px";
      document.body.appendChild(p);
      setTimeout(()=>p.remove(),2000);
    }
  }

  /* ---------- Modal ---------- */
  function openModal(id){ const m=document.getElementById(id); if(m) m.classList.add("open"); }
  function closeModal(id){ const m=document.getElementById(id); if(m) m.classList.remove("open"); }
  function bindModalDismiss(){
    document.addEventListener("click", e=>{
      if(e.target.classList.contains("modal-overlay")) e.target.classList.remove("open");
      if(e.target.closest("[data-close-modal]")){ const ov = e.target.closest(".modal-overlay"); if(ov) ov.classList.remove("open"); }
    });
    document.addEventListener("keydown", e=>{
      if(e.key==="Escape") document.querySelectorAll(".modal-overlay.open").forEach(m=>m.classList.remove("open"));
    });
  }

  /* ---------- Ripple on buttons ---------- */
  function bindRipple(){
    document.addEventListener("click", e=>{
      const btn = e.target.closest(".btn");
      if(!btn) return;
      const rect = btn.getBoundingClientRect();
      const r = document.createElement("span");
      r.className = "ripple";
      const size = Math.max(rect.width, rect.height);
      r.style.width = r.style.height = size+"px";
      r.style.left = (e.clientX-rect.left-size/2)+"px";
      r.style.top = (e.clientY-rect.top-size/2)+"px";
      btn.appendChild(r);
      setTimeout(()=>r.remove(),650);
    });
  }

  /* ---------- Theme ---------- */
  function initTheme(){
    const saved = localStorage.getItem("sw_theme");
    if(saved) document.documentElement.setAttribute("data-theme", saved);
    document.querySelectorAll("[data-theme-toggle]").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const cur = document.documentElement.getAttribute("data-theme") ||
          (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light");
        const next = cur==="dark" ? "light":"dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("sw_theme", next);
      });
    });
  }

  /* ---------- Excel / TSV paste parser ---------- */
  function parsePastedTable(text){
    return text.replace(/\r/g,"").split("\n").filter(r=>r.length).map(row=>row.split("\t"));
  }

  /* ---------- CSV export ---------- */
  function exportCSV(filename, headers, rows){
    function cell(v){
      const s = String(v==null?"":v);
      return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
    }
    const lines = [headers.map(cell).join(",")].concat(rows.map(r=>r.map(cell).join(",")));
    const blob = new Blob([lines.join("\r\n")], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename.endsWith(".csv") ? filename : filename+".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  }

  function escapeHtml(s){
    return String(s==null?"":s).replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  }

  function debounce(fn, ms){
    let t; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), ms||250); };
  }

  function qs(sel, ctx){ return (ctx||document).querySelector(sel); }
  function qsa(sel, ctx){ return Array.from((ctx||document).querySelectorAll(sel)); }

  function animateCounter(el, target, duration){
    if(!el) return;
    duration = duration || 500;
    const start = 0;
    const startTime = performance.now();
    function tick(now){
      const p = Math.min(1, (now-startTime)/duration);
      const eased = 1 - Math.pow(1-p, 3);
      el.textContent = Math.round(start + (target-start)*eased);
      if(p<1) requestAnimationFrame(tick); else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }

  function initTabs(root){
    (root?[root]:qsa(".tabs")).forEach(tabs=>{
      const container = tabs.parentElement;
      let indicator = tabs.querySelector(".tab-indicator");
      if(!indicator){ indicator = document.createElement("span"); indicator.className = "tab-indicator"; tabs.appendChild(indicator); }
      function moveIndicatorTo(btn){
        if(!btn) return;
        indicator.style.width = btn.offsetWidth + "px";
        indicator.style.left = btn.offsetLeft + "px";
      }
      moveIndicatorTo(tabs.querySelector(".tab-btn.active"));
      qsa(".tab-btn",tabs).forEach(btn=>{
        btn.addEventListener("click", ()=>{
          qsa(".tab-btn",tabs).forEach(b=>b.classList.remove("active"));
          btn.classList.add("active");
          moveIndicatorTo(btn);
          const target = btn.dataset.tab;
          qsa(".tab-panel",container).forEach(p=>{
            const isTarget = p.dataset.tabPanel===target;
            if(isTarget){ p.classList.add("active"); p.classList.remove("tab-panel-enter"); void p.offsetWidth; p.classList.add("tab-panel-enter"); }
            else p.classList.remove("active");
          });
        });
      });
      window.addEventListener("resize", debounce(()=> moveIndicatorTo(tabs.querySelector(".tab-btn.active")), 150));
    });
  }

  global.SW = global.SW || {};
  global.SW.Utils = {
    startClock, fmtDate, fmtDateTime, fmtINR, daysBetween, relativeTime, projectHealth,
    Validate, validateForm, toast, confetti, openModal, closeModal, bindModalDismiss,
    bindRipple, initTheme, parsePastedTable, exportCSV, escapeHtml, debounce, qs, qsa, initTabs, animateCounter, DAY_NAMES
  };
})(window);
