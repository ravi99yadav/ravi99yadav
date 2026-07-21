(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["contractor"], active:"contractor-dashboard" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  const hour = new Date().getHours();
  document.getElementById("greeting").textContent = (hour<12?"Good morning":hour<17?"Good afternoon":"Good evening") + ", " + user.name.split(" ")[0] + " 👋";

  const bids = DB.bids.list(b=>b.contractorId===user.id);
  const projects = DB.projects.list(p=>p.contractorId===user.id && !p.archived);
  const wins = bids.filter(b=>b.status==="mutually_accepted").length;
  const pending = bids.filter(b=>["submitted","revision_requested","pm_accepted"].includes(b.status)).length;
  const paymentPending = DB.paymentRequests.list(r=> projects.some(p=>p.id===r.projectId) && r.contractorId!=="paid" && r.status==="pending").reduce((s,r)=>s+r.amount,0);
  const hindrancesOpen = DB.hindrances.list(h=> projects.some(p=>p.id===h.projectId) && h.status==="pending").length;

  const kpis = [
    { label:"Bids Submitted", value:bids.length, icon:"⚖️", cls:"" },
    { label:"Bids Won", value:wins, icon:"🏆", cls:"success" },
    { label:"Bids Pending Review", value:pending, icon:"⏳", cls:"accent" },
    { label:"Active Projects", value:projects.filter(p=>p.status==="running").length, icon:"🏗️", cls:"" },
    { label:"Open Hindrances", value:hindrancesOpen, icon:"🚧", cls:"warm" },
    { label:"Payment Requests Pending", value:U.fmtINR(paymentPending), icon:"🧾", cls:"warm" }
  ];
  document.getElementById("kpiGrid").innerHTML = kpis.map(k=>`
    <div class="kpi-card card-gradient ${k.cls}"><div class="kpi-icon">${k.icon}</div><div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div></div>`).join("");

  document.getElementById("bidsList").innerHTML = bids.length ? bids.slice(0,6).map(b=>{
    const t = DB.tenders.get(b.tenderId);
    const map = { submitted:"badge-info", revision_requested:"badge-warning", pm_accepted:"badge-accent", mutually_accepted:"badge-success", rejected:"badge-danger", not_selected:"badge-neutral", withdrawn:"badge-neutral" };
    return `<div class="attn-row"><div><b>${U.escapeHtml(t.title)}</b><div class="text-muted" style="font-size:12px">${t.district}, ${t.state}</div></div>
      <div class="flex gap-2 items-center"><span class="badge ${map[b.status]||'badge-neutral'}">${b.status.replace(/_/g," ")}</span><a class="btn btn-sm btn-outline" href="../tender-detail/index.html?id=${t.id}">Open</a></div></div>`;
  }).join("") : `<div class="empty-state">You haven't submitted any bids yet. <a href="../contractor-tenders/index.html">Find tenders →</a></div>`;

  document.getElementById("projectsList").innerHTML = projects.length ? projects.map(p=>`
    <div class="proj-row"><div class="flex justify-between items-center mb-2"><b>${U.escapeHtml(p.name)}</b><span class="badge badge-success">${p.progressPct||0}%</span></div>
    <div class="progress mb-2"><div class="progress-bar" style="width:${p.progressPct||0}%"></div></div>
    <a class="btn btn-ghost btn-sm mt-2" href="../project-workspace/index.html?id=${p.id}">Open Workspace →</a></div>`).join("") : `<div class="empty-state">No active projects yet.</div>`;

  const upcoming = [];
  projects.forEach(p=> DB.ganttTasks.list(g=>g.projectId===p.id && g.progress<100).forEach(g=> upcoming.push({label:p.name+" — "+g.name, date:g.end})));
  upcoming.sort((a,b)=> new Date(a.date)-new Date(b.date));
  document.getElementById("deadlinesList").innerHTML = upcoming.slice(0,6).map(d=>`<div class="deadline-row"><span>${U.escapeHtml(d.label)}</span><b>${U.fmtDate(d.date)}</b></div>`).join("") || `<div class="empty-state" style="padding:20px">No upcoming deadlines.</div>`;

  const audits = DB._store.auditLogs.filter(a=>a.userId===user.id).sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,8);
  document.getElementById("activityTimeline").innerHTML = audits.length ? audits.map(a=>`<div class="timeline-item"><div class="ti-time">${U.relativeTime(a.at)}</div>${U.escapeHtml(a.action)} · ${U.escapeHtml(a.entity)}</div>`).join("") : `<div class="empty-state" style="padding:20px">No recent activity.</div>`;

  SW.UI.helpSection(document.querySelector(".app-content"), "Dashboard", [
    "Track every bid you've submitted and its live status, from submission through revision to mutual acceptance.",
    "Once a bid is mutually accepted, pay the ₹99 contact-unlock fee to reveal the Project Manager's direct phone & email.",
    "Open any active project to log DPRs, raise Hindrance requests, build your MB Sheet and submit RA Bills."
  ]);
})();
