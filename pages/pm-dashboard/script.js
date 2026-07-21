(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"pm-dashboard" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  const hour = new Date().getHours();
  document.getElementById("greeting").textContent = (hour<12?"Good morning":hour<17?"Good afternoon":"Good evening") + ", " + user.name.split(" ")[0] + " 👋";

  const tenders = DB.tenders.list(t=>t.pmId===user.id && !t.archived);
  const projects = DB.projects.list(p=>p.pmId===user.id && !p.archived);
  const bids = DB.bids.list(b=> tenders.some(t=>t.id===b.tenderId));
  const today = new Date();
  const delayed = projects.filter(p=>{
    const tasks = DB.ganttTasks.list(g=>g.projectId===p.id);
    return tasks.some(t=> new Date(t.end) < today && t.progress<100);
  });
  const critical = projects.reduce((n,p)=> n + DB.ganttTasks.list(g=>g.projectId===p.id && g.critical && g.progress<100).length, 0);
  const running = projects.filter(p=>p.status==="running").length;
  const completed = projects.filter(p=>p.status==="completed").length;
  const contractValue = projects.reduce((s,p)=>{
    const loi = DB.lois.list(l=>l.tenderId===p.tenderId)[0];
    return s + (loi ? loi.contractValue : 0);
  },0);
  const paymentPending = DB.paymentRequests.list(r=> projects.some(p=>p.id===r.projectId) && r.status==="pending").reduce((s,r)=>s+r.amount,0);

  const kpis = [
    { label:"Active Tenders", value: tenders.filter(t=>t.status==="published").length, icon:"📄", cls:"" },
    { label:"Bids Received", value: bids.length, icon:"⚖️", cls:"accent" },
    { label:"Running Projects", value: running, icon:"🏗️", cls:"success" },
    { label:"Completed Projects", value: completed, icon:"✅", cls:"" },
    { label:"Delayed Projects", value: delayed.length, icon:"⏰", cls:"warm" },
    { label:"Critical Tasks", value: critical, icon:"🚨", cls:"warm" },
    { label:"Contract Value", value: U.fmtINR(contractValue), icon:"💰", cls:"success" },
    { label:"Payment Requests Pending", value: U.fmtINR(paymentPending), icon:"🧾", cls:"accent" }
  ];
  document.getElementById("kpiGrid").innerHTML = kpis.map(k=>`
    <div class="kpi-card card-gradient ${k.cls}">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join("");

  // Tenders needing attention: draft, or published with new bids not yet reviewed, or awaiting revision responses
  const attnList = tenders.filter(t=>t.status==="draft" || t.status==="published").slice(0,5);
  document.getElementById("tendersAttention").innerHTML = attnList.length ? attnList.map(t=>{
    const tBids = DB.bids.list(b=>b.tenderId===t.id);
    return `<div class="attn-row">
      <div><b>${U.escapeHtml(t.title)}</b><div class="text-muted" style="font-size:12px">${t.district}, ${t.state} · ${tBids.length} bid(s)</div></div>
      <div class="flex gap-2 items-center">
        <span class="badge ${t.status==='draft'?'badge-neutral':'badge-info'}">${t.status}</span>
        <a href="${t.status==='draft' ? '../tender-wizard/index.html?id='+t.id : '../tender-detail/index.html?id='+t.id}" class="btn btn-sm btn-outline">${t.status==='draft'?'Continue':'Review'}</a>
      </div>
    </div>`;
  }).join("") : `<div class="empty-state">No tenders need attention right now. <a href="../tender-wizard/index.html">Create one →</a></div>`;

  document.getElementById("projectsList").innerHTML = projects.length ? projects.map(p=>{
    const h = U.projectHealth(p);
    return `<div class="proj-row">
      <div class="flex justify-between items-center mb-2"><b>${U.escapeHtml(p.name)}</b><span class="badge badge-success">${p.progressPct||0}%</span></div>
      <div class="progress mb-2"><div class="progress-bar" style="width:${p.progressPct||0}%"></div></div>
      <div class="flex justify-between text-muted" style="font-size:12px"><span>${p.district}, ${p.state}</span><span>${h.totalDays!=null?h.remainingDays+'d left'+(h.overdue?' ⚠ overdue':''):'Due '+U.fmtDate(p.endDate)}</span><span>Bal: ${U.fmtINR(h.balanceAmount)}</span></div>
      <a class="btn btn-ghost btn-sm mt-2" href="../project-workspace/index.html?id=${p.id}">Open Workspace →</a>
    </div>`;
  }).join("") : `<div class="empty-state">No active projects yet.</div>`;

  const upcoming = [];
  tenders.forEach(t=>{ if(t.bidSubmissionDeadline) upcoming.push({label:t.title+" — bid deadline", date:t.bidSubmissionDeadline}); });
  projects.forEach(p=>{
    DB.ganttTasks.list(g=>g.projectId===p.id && g.progress<100).forEach(g=> upcoming.push({label:p.name+" — "+g.name, date:g.end}));
  });
  upcoming.sort((a,b)=> new Date(a.date)-new Date(b.date));
  document.getElementById("deadlinesList").innerHTML = upcoming.slice(0,6).map(d=>`<div class="deadline-row"><span>${U.escapeHtml(d.label)}</span><b>${U.fmtDate(d.date)}</b></div>`).join("") || `<div class="empty-state" style="padding:20px">No upcoming deadlines.</div>`;

  const audits = DB._store.auditLogs.filter(a=>a.userId===user.id).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,8);
  document.getElementById("activityTimeline").innerHTML = audits.length ? audits.map(a=>`
    <div class="timeline-item"><div class="ti-time">${U.relativeTime(a.at)}</div><div>${U.escapeHtml(a.action)} · ${U.escapeHtml(a.entity)}</div></div>
  `).join("") : `<div class="empty-state" style="padding:20px">No recent activity.</div>`;

  SW.UI.helpSection(document.querySelector(".app-content"), "Dashboard", [
    "KPI cards summarise your tenders, bids, running/delayed projects and contract value in real time.",
    "\"Tenders Needing Attention\" surfaces drafts to finish and published tenders awaiting your review of new bids.",
    "Click any project to open the full Project Workspace with Gantt, Kanban, MB Sheet, RA Bill, DPR and Hindrance tracking.",
    "Use Quick Create (top navbar) or Ctrl+K to jump anywhere instantly."
  ]);
})();
