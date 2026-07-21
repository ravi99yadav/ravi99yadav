/* ==========================================================================
   SUBLETWORKS.COM — Shared App Shell (Sidebar + Navbar + Command Palette)
   ========================================================================== */
(function(global){
  "use strict";
  const U = () => global.SW.Utils;
  const DB = () => global.SW.DB;
  const Auth = () => global.SW.Auth;
  const rp = (p) => global.SW.rootPath(p);

  const NAV = {
    pm: [
      { section:"Workspace" },
      { icon:"grid", label:"Dashboard", href:"/pages/pm-dashboard/index.html", key:"pm-dashboard" },
      { icon:"search", label:"Search Contractors", href:"/pages/pm-contractors/index.html", key:"pm-contractors" },
      { section:"Tendering" },
      { icon:"file-plus", label:"Create Tender", href:"/pages/tender-wizard/index.html", key:"tender-wizard" },
      { icon:"list", label:"My Tenders", href:"/pages/pm-tenders/index.html", key:"pm-tenders" },
      { section:"Delivery" },
      { icon:"kanban", label:"Project Workspace", href:"/pages/project-workspace/index.html", key:"project-workspace" },
      { section:"Marketplace" },
      { icon:"store", label:"Material Marketplace", href:"/pages/marketplace/index.html", key:"marketplace" }
    ],
    contractor: [
      { section:"Workspace" },
      { icon:"grid", label:"Dashboard", href:"/pages/contractor-dashboard/index.html", key:"contractor-dashboard" },
      { icon:"search", label:"Search Tenders", href:"/pages/contractor-tenders/index.html", key:"contractor-tenders" },
      { section:"Delivery" },
      { icon:"kanban", label:"Project Workspace", href:"/pages/project-workspace/index.html", key:"project-workspace" },
      { section:"Marketplace" },
      { icon:"store", label:"Material Marketplace", href:"/pages/marketplace/index.html", key:"marketplace" }
    ],
    admin: [
      { section:"Control" },
      { icon:"grid", label:"Admin Dashboard", href:"/pages/admin-dashboard/index.html", key:"admin-dashboard" },
      { icon:"store", label:"Marketplace", href:"/pages/marketplace/index.html", key:"marketplace" }
    ]
  };

  const ICONS = {
    grid:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    search:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    "file-plus":'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 11v6M9 14h6"/></svg>',
    list:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    kanban:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>',
    store:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l1-5h16l1 5M4 9h16v10a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><path d="M9 21v-6h6v6"/></svg>',
    bell:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 01-3.4 0"/></svg>',
    plus:'<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    moon:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z"/></svg>',
    cmd:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'
  };

  function initials(name){
    return (name||"?").split(" ").filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  }

  function buildSidebar(role, activeKey){
    const items = NAV[role] || [];
    let html = `<div class="sidebar-brand"><div class="logo-mark">SW</div><span>SubletWorks</span></div>`;
    html += `<div class="sidebar-search"><input class="input" placeholder="Quick jump… (Ctrl+K)" data-open-palette></div>`;
    html += `<nav class="sidebar-nav">`;
    items.forEach(it=>{
      if(it.section){ html += `<div class="sidebar-section-title">${it.section}</div>`; return; }
      html += `<a class="nav-item ${it.key===activeKey?'active':''}" href="${rp(it.href)}"><span class="nav-icon">${ICONS[it.icon]||""}</span><span>${it.label}</span></a>`;
    });
    html += `</nav>`;
    html += `<div class="sidebar-collapse-btn"><button class="icon-btn" id="sidebarCollapseBtn" title="Collapse sidebar">${ICONS.list}</button></div>`;
    return html;
  }

  function buildNavbar(user){
    const notifCount = (DB().notifications.list(n=>n.userId===user.id && !n.read)||[]).length;
    return `
    <button class="icon-btn no-print" id="mobileSidebarToggle" style="display:none">${ICONS.list}</button>
    <div class="navbar-search">
      <span class="icon">${ICONS.search}</span>
      <input placeholder="Search tenders, projects, contractors… (Ctrl+K)" data-open-palette readonly>
    </div>
    <button class="btn btn-primary btn-sm no-print" id="quickCreateBtn">${ICONS.plus} Quick Create</button>
    <div class="navbar-clock" id="navClock"></div>
    <div style="position:relative">
      <button class="icon-btn" id="notifBtn">${ICONS.bell}${notifCount?'<span class="dot"></span>':''}</button>
      <div class="dropdown-panel" id="notifPanel"></div>
    </div>
    <button class="icon-btn" data-theme-toggle title="Toggle theme">${ICONS.moon}</button>
    <div style="position:relative">
      <button class="avatar" id="profileBtn" style="background:${user.avatarColor||'var(--sw-gradient-accent)'}">${initials(user.name)}</button>
      <div class="dropdown-panel" id="profilePanel">
        <div style="padding:16px;border-bottom:1px solid var(--border)"><b>${U().escapeHtml(user.name)}</b><div class="text-muted" style="font-size:12px">${U().escapeHtml(user.email||user.phone||"")}</div><span class="badge badge-info mt-2">${roleLabel(user.role)}</span></div>
        <a class="dropdown-item" href="${rp('/pages/profile-settings/index.html')}" id="profileEditLink">Edit Profile</a>
        <a class="dropdown-item" href="#" id="helpLink">Help & FAQ</a>
        <a class="dropdown-item" href="#" id="logoutLink" style="color:var(--sw-danger)">Logout</a>
      </div>
    </div>`;
  }

  function roleLabel(r){ return {pm:"Project Manager",contractor:"Contractor",admin:"Admin"}[r] || r; }

  function renderNotifPanel(user){
    const panel = document.getElementById("notifPanel");
    const items = DB().notifications.list(n=>n.userId===user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,20);
    if(!items.length){ panel.innerHTML = `<div class="empty-state" style="padding:32px 16px;"><div class="es-icon">${ICONS.bell}</div>No notifications yet.</div>`; return; }
    const header = items.some(n=>!n.read) ? `<div class="dropdown-item" id="markAllReadBtn" style="justify-content:center;cursor:pointer;font-weight:600;font-size:12px;color:var(--sw-primary)">Mark all as read</div>` : "";
    panel.innerHTML = header + items.map(n=>`
      <div class="dropdown-item" data-notif-id="${n.id}" style="cursor:pointer">
        ${!n.read?'<span class="dot-unread"></span>':'<span style="width:8px"></span>'}
        <div><div style="font-size:13px;font-weight:600">${U().escapeHtml(n.title)}</div><div class="text-muted" style="font-size:12px">${U().escapeHtml(n.body||"")}</div><div class="text-muted" style="font-size:11px;margin-top:4px">${U().relativeTime(n.createdAt)}</div></div>
      </div>`).join("");
    document.getElementById("markAllReadBtn")?.addEventListener("click", ()=>{
      items.forEach(n=>{ if(!n.read) DB().notifications.update(n.id, {read:true}); });
      renderNotifPanel(user);
      document.getElementById("notifBtn")?.querySelector(".dot")?.remove();
    });
    panel.querySelectorAll("[data-notif-id]").forEach(el=>{
      el.addEventListener("click", ()=>{
        const n = DB().notifications.get(el.dataset.notifId);
        if(!n) return;
        if(!n.read) DB().notifications.update(n.id, {read:true});
        if(n.link) location.href = rp(n.link);
        else renderNotifPanel(user);
      });
    });
  }

  function mountCommandPalette(role){
    if(document.getElementById("cmdPaletteOverlay")) return;
    const overlay = document.createElement("div");
    overlay.className = "command-palette-overlay";
    overlay.id = "cmdPaletteOverlay";
    overlay.innerHTML = `<div class="command-palette"><input placeholder="Type a command or search… try 'tender', 'project', 'contractor'" id="cmdInput"><div class="cp-results" id="cmdResults"></div></div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector("#cmdInput");
    const results = overlay.querySelector("#cmdResults");

    function baseCommands(){
      const list = (NAV[role]||[]).filter(i=>!i.section);
      return list.map(i=>({label:i.label, action:()=>location.href=rp(i.href)}));
    }
    function search(q){
      q = q.toLowerCase().trim();
      let items = baseCommands();
      if(q){
        const tenders = DB().tenders.list(t=>t.title.toLowerCase().includes(q)).slice(0,5)
          .map(t=>({label:"Tender: "+t.title, action:()=>location.href=rp("/pages/tender-detail/index.html?id="+t.id)}));
        const projects = DB().projects.list(p=>p.name.toLowerCase().includes(q)).slice(0,5)
          .map(p=>({label:"Project: "+p.name, action:()=>location.href=rp("/pages/project-workspace/index.html?id="+p.id)}));
        items = [...tenders, ...projects, ...items.filter(i=>i.label.toLowerCase().includes(q))];
      }
      results.innerHTML = items.slice(0,10).map((it,idx)=>`<div class="cp-item ${idx===0?'active':''}" data-idx="${idx}">${it.label}</div>`).join("") || `<div class="cp-item">No results</div>`;
      results._items = items;
    }
    input.addEventListener("input", ()=>search(input.value));
    results.addEventListener("click", e=>{
      const item = e.target.closest(".cp-item");
      if(item && results._items){ const it = results._items[+item.dataset.idx]; if(it) it.action(); closePalette(); }
    });
    function openPalette(){ overlay.classList.add("open"); input.value=""; search(""); setTimeout(()=>input.focus(),50); }
    function closePalette(){ overlay.classList.remove("open"); }
    overlay.addEventListener("click", e=>{ if(e.target===overlay) closePalette(); });
    document.addEventListener("keydown", e=>{
      if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); openPalette(); }
      if(e.key==="Escape") closePalette();
    });
    document.addEventListener("click", e=>{ if(e.target.closest("[data-open-palette]")){ e.preventDefault(); openPalette(); } });
  }

  function mountQuickCreate(role){
    const map = {
      pm: [{label:"New Tender", href:"/pages/tender-wizard/index.html"},{label:"New External Project", href:"/pages/external-project-new/index.html"},{label:"New Project Task", href:"/pages/project-workspace/index.html"}],
      contractor: [{label:"Submit a Bid", href:"/pages/contractor-tenders/index.html"},{label:"New DPR", href:"/pages/project-workspace/index.html"}],
      admin: [{label:"Review Approvals", href:"/pages/admin-dashboard/index.html"}]
    };
    const btn = document.getElementById("quickCreateBtn");
    if(!btn) return;
    btn.addEventListener("click", ()=>{
      const opts = map[role]||[];
      U().toast(opts.map(o=>o.label).join(" · "), {title:"Quick Create", type:""});
      if(opts[0]) location.href = rp(opts[0].href);
    });
  }

  function mountShell(opts){
    const user = Auth().requireRole(opts.roles);
    if(!user) return null;
    let shell = document.querySelector(".app-shell");
    if(!shell){ shell = document.createElement("div"); shell.className="app-shell"; document.body.appendChild(shell); }
    const sidebarMount = document.getElementById("sidebarMount");
    const navbarMount = document.getElementById("navbarMount");
    if(sidebarMount){ const aside=document.createElement("aside"); aside.className="sidebar"; aside.innerHTML = buildSidebar(user.role, opts.active); sidebarMount.replaceWith(aside); }
    if(navbarMount){ const nav=document.createElement("header"); nav.className="navbar no-print"; nav.innerHTML = buildNavbar(user); navbarMount.replaceWith(nav); }

    U().startClock(document.getElementById("navClock"));
    U().initTheme();
    U().bindModalDismiss();
    U().bindRipple();
    mountCommandPalette(user.role);
    mountQuickCreate(user.role);

    const notifBtn = document.getElementById("notifBtn");
    if(notifBtn) notifBtn.addEventListener("click", ()=>{ renderNotifPanel(user); toggleDropdown("notifPanel"); });
    const profileBtn = document.getElementById("profileBtn");
    if(profileBtn) profileBtn.addEventListener("click", ()=> toggleDropdown("profilePanel"));
    document.addEventListener("click", e=>{
      if(!e.target.closest("#notifBtn") && !e.target.closest("#notifPanel")) document.getElementById("notifPanel")?.classList.remove("open");
      if(!e.target.closest("#profileBtn") && !e.target.closest("#profilePanel")) document.getElementById("profilePanel")?.classList.remove("open");
    });
    document.getElementById("logoutLink")?.addEventListener("click", e=>{ e.preventDefault(); Auth().logout(); });
    document.getElementById("helpLink")?.addEventListener("click", e=>{ e.preventDefault(); document.getElementById("helpDrawerToggle")?.click() || U().toast("See the Help panel at the bottom of this page for guidance.",{title:"Help"}); });

    const collapseBtn = document.getElementById("sidebarCollapseBtn");
    if(collapseBtn) collapseBtn.addEventListener("click", ()=>{
      document.querySelector(".app-shell").classList.toggle("sidebar-collapsed");
    });
    const mobileToggle = document.getElementById("mobileSidebarToggle");
    if(window.innerWidth<=1024 && mobileToggle) mobileToggle.style.display="flex";
    if(mobileToggle) mobileToggle.addEventListener("click", ()=> document.querySelector(".app-shell").classList.toggle("sidebar-mobile-open"));

    return user;
  }

  function toggleDropdown(id){
    document.querySelectorAll(".dropdown-panel").forEach(p=>{ if(p.id!==id) p.classList.remove("open"); });
    document.getElementById(id)?.classList.toggle("open");
  }

  function helpSection(container, title, bullets){
    const el = document.createElement("details");
    el.className = "card mt-5 no-print";
    el.innerHTML = `<summary style="cursor:pointer;font-weight:700;">❔ Help — ${title}</summary>
      <div class="mt-3">${bullets.map(b=>`<p>• ${b}</p>`).join("")}</div>`;
    (container||document.querySelector(".app-content")).appendChild(el);
  }

  global.SW = global.SW || {};
  global.SW.UI = { mountShell, helpSection, ICONS, roleLabel };
})(window);
