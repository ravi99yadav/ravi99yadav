(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"project-workspace" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, isPM = user.role==="pm";

  const params = new URLSearchParams(location.search);
  const requestedId = params.get("id");
  let project = requestedId ? DB.projects.get(requestedId) : null;
  if(requestedId && project && !(isPM ? project.pmId===user.id : project.contractorId===user.id)){
    SW.UI.render403("This project isn't available to your account.", "index.html", "Back to My Projects");
    return;
  }

  function myProjects(){ return DB.projects.list(p=> (isPM ? p.pmId===user.id : p.contractorId===user.id) && !p.archived); }

  if(!project){
    document.getElementById("projectPicker").classList.remove("hidden");
    if(!isPM) document.getElementById("newExternalProjectLink").classList.add("hidden");
    const list = myProjects();
    document.getElementById("pickerGrid").innerHTML = list.length ? list.map(p=>{
      const h = U.projectHealth(p);
      return `<div class="card card-hover">
        <div class="flex justify-between items-start gap-2"><b>${U.escapeHtml(p.name)}</b>${p.external?'<span class="badge badge-accent">External</span>':''}</div>
        <div class="text-muted" style="font-size:12px">${p.district}, ${p.state}</div>
        <div class="progress mt-3 mb-2"><div class="progress-bar" style="width:${p.progressPct||0}%"></div></div>
        <div class="flex justify-between text-muted" style="font-size:11px">
          <span>Work: ${h.workPct}%</span>
          <span>${h.totalDays!=null ? (h.remainingDays+'d left'+(h.overdue?' ⚠':'')) : '—'}</span>
          <span>Bal: ${U.fmtINR(h.balanceAmount)}</span>
        </div>
        <a class="btn btn-primary btn-sm w-full mt-3" href="?id=${p.id}">Open Workspace</a>
      </div>`;
    }).join("") : `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🏗️</div>No projects yet — a project is created automatically once a Work Order is issued${isPM?', or create an External Project above':''}.</div>`;
    return;
  }

  document.getElementById("workspaceRoot").classList.remove("hidden");
  SW.UI.contextBar(document.querySelector(".app-content"), {
    entity:"projects", entityId:project.id,
    status: project.status, statusLabel: (project.status||"").charAt(0).toUpperCase()+(project.status||"").slice(1),
    permission: isPM ? "Project Manager · Owner" : "Contractor",
    version: project.version, updatedAt: project.updatedAt
  });
  const otherUser = isPM ? DB.users.get(project.contractorId) : DB.users.get(project.pmId);
  const otherPartyName = project.external ? (project.externalContractorName||"External Contractor") : (otherUser ? otherUser.name : "—");
  // External projects have no linked contractor account, so the PM must be able to
  // perform site-side actions (RA Bill, DPR, Hindrance, Payment Request) themselves.
  const canRaiseSiteActions = !isPM || project.external;

  function renderHeader(){
    const masterProject = project.masterProjectId ? DB.masterProjects.get(project.masterProjectId) : null;
    document.getElementById("projHeader").innerHTML = `
      ${masterProject && isPM ? `<a class="badge badge-accent mb-2" style="display:inline-flex" href="../pm-projects/index.html">🏗️ Part of Project: ${U.escapeHtml(masterProject.name)}</a>` : ""}
      <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:12px">
        <div><div class="flex items-center gap-2"><h1 style="margin:0">${U.escapeHtml(project.name)}</h1>${project.external?'<span class="badge badge-accent">External Project</span>':''}</div><p class="text-muted">${project.district}, ${project.state} · ${isPM?'Contractor':'Project Manager'}: ${U.escapeHtml(otherPartyName)} · ${U.fmtDate(project.startDate)} – ${U.fmtDate(project.endDate)}</p></div>
        <div style="min-width:220px"><div class="flex justify-between text-muted" style="font-size:12px"><span>Progress</span><span>${project.progressPct||0}%</span></div><div class="progress"><div class="progress-bar" style="width:${project.progressPct||0}%"></div></div></div>
      </div>`;
  }

  /* ================= BOQ / RATE / MEASUREMENT HELPERS (shared by RA Bill & Reconciliation) ================= */
  function projectBoqItems(){
    const official = project.tenderId
      ? DB.boqItems.list(i=>i.tenderId===project.tenderId)
      : DB.boqItems.list(i=>i.projectId===project.id && !i.isExtra);
    const approvedExtras = DB.boqItems.list(i=>i.projectId===project.id && i.isExtra && i.status==="approved");
    return official.concat(approvedExtras).sort((a,b)=>a.srNo-b.srNo);
  }
  function extraItems(){
    return DB.boqItems.list(i=>i.projectId===project.id && i.isExtra).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  }
  function itemRate(boqItem){
    if(boqItem.rate!=null) return boqItem.rate;
    if(project.tenderId){
      const bid = DB.bids.list(b=>b.tenderId===project.tenderId && b.contractorId===project.contractorId && (b.status==="mutually_accepted"||b.status==="accepted"))[0];
      if(bid){ const bi = DB.bidItems.list(x=>x.bidId===bid.id && x.boqItemId===boqItem.id)[0]; return bi?bi.rate:0; }
    }
    return 0;
  }
  function mbMeasuredQty(boqItem){
    if(!boqItem) return 0;
    const sheets = DB.mbSheets.list(m=>m.projectId===project.id).map(s=>s.id);
    return DB.mbRows.list(r=>sheets.includes(r.mbSheetId) && r.boqItemId===boqItem.id)
      .reduce((s,r)=>s+convertQtyToBoqUnit(r.qty||0, r.unit, boqItem.unit),0);
  }
  function cumulativeBilledQty(boqItemId, beforeBillId){
    const bills = DB.raBills.list(b=>b.projectId===project.id && b.status!=="rejected" && b.id!==beforeBillId).sort((a,b)=>new Date(a.billDate)-new Date(b.billDate));
    let latest = null;
    bills.forEach(b=>{
      const item = DB.raBillItems.list(i=>i.raBillId===b.id && i.boqItemId===boqItemId)[0];
      if(item) latest = item;
    });
    return latest ? latest.cumulativeQty : 0;
  }

  /* ================= OVERVIEW ================= */
  function renderOverview(){
    const tasks = DB.ganttTasks.list(g=>g.projectId===project.id);
    const dprCount = DB.dprs.list(d=>d.projectId===project.id).length;
    const hindOpen = DB.hindrances.list(h=>h.projectId===project.id && h.status==="pending").length;
    const bills = DB.raBills.list(r=>r.projectId===project.id);
    const billed = bills.reduce((s,b)=>s+b.currentGrossAmount,0);
    const health = U.projectHealth(project);
    document.getElementById("panelOverview").innerHTML = `
      <div class="card mb-5">
        <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
          <h3 style="margin:0">Project Health</h3>
          ${health.overdue ? `<span class="badge badge-danger">⚠ Past end date, still in progress</span>` : ""}
        </div>
        <div class="grid grid-4">
          <div><div class="text-muted" style="font-size:12px">Days Elapsed / Total</div><b>${health.totalDays!=null ? `${health.elapsedDays} / ${health.totalDays} days` : "—"}</b></div>
          <div><div class="text-muted" style="font-size:12px">Days Remaining</div><b>${health.totalDays!=null ? health.remainingDays+" days" : "—"}</b></div>
          <div><div class="text-muted" style="font-size:12px">Time Consumed</div><b>${health.totalDays!=null ? health.timeConsumedPct.toFixed(0)+"%" : "—"}</b></div>
          <div><div class="text-muted" style="font-size:12px">Work Progress</div><b>${health.workPct}%</b></div>
        </div>
        ${health.totalDays!=null ? `<div class="progress mt-3"><div class="progress-bar" style="width:${health.timeConsumedPct}%;background:${health.overdue?'var(--sw-gradient-warm)':'var(--sw-gradient-brand)'}"></div></div><div class="text-muted mt-1" style="font-size:11px">Timeline consumed</div>` : ""}
        <div class="divider"></div>
        <div class="grid grid-3">
          <div><div class="text-muted" style="font-size:12px">Contract Value</div><b>${U.fmtINR(health.contractValue)}</b></div>
          <div><div class="text-muted" style="font-size:12px">Billed to Date</div><b>${U.fmtINR(health.billedAmount)}</b></div>
          <div><div class="text-muted" style="font-size:12px">Balance</div><b>${U.fmtINR(health.balanceAmount)}</b></div>
        </div>
      </div>
      <div class="grid grid-4 mb-5">
        <div class="kpi-card card-gradient"><div class="kpi-icon">📋</div><div class="kpi-value">${tasks.length}</div><div class="kpi-label">Gantt Tasks</div></div>
        <div class="kpi-card card-gradient accent"><div class="kpi-icon">🚧</div><div class="kpi-value">${hindOpen}</div><div class="kpi-label">Open Hindrances</div></div>
        <div class="kpi-card card-gradient success"><div class="kpi-icon">🧾</div><div class="kpi-value">${bills.length}</div><div class="kpi-label">RA Bills Raised</div></div>
        <div class="kpi-card card-gradient warm"><div class="kpi-icon">💰</div><div class="kpi-value">${U.fmtINR(billed)}</div><div class="kpi-label">Total Billed</div></div>
      </div>
      <div class="card"><h3>Recent Activity</h3><div class="timeline">${DB.auditFor("projects",project.id).slice(0,8).map(l=>`<div class="timeline-item"><div class="ti-time">${U.fmtDateTime(l.at)}</div>${l.action}</div>`).join("") || '<p class="text-muted">No activity recorded yet.</p>'}</div></div>`;
  }

  /* ================= WBS (WORK BREAKDOWN STRUCTURE) ================= */
  const WBS_TEMPLATE = [
    { code:"1", name:"Pre-Construction", children:[
      { code:"1.1", name:"Site Survey & Soil Investigation" },
      { code:"1.2", name:"Statutory Approvals & NOCs" },
      { code:"1.3", name:"Mobilization & Site Setup" },
      { code:"1.4", name:"Temporary Facilities (Site Office, Store, Labour Camp)" }
    ]},
    { code:"2", name:"Earthwork", children:[
      { code:"2.1", name:"Excavation" },
      { code:"2.2", name:"Backfilling & Compaction" },
      { code:"2.3", name:"Dewatering" }
    ]},
    { code:"3", name:"Foundation", children:[
      { code:"3.1", name:"PCC (Plain Cement Concrete)" },
      { code:"3.2", name:"Footing / Raft" },
      { code:"3.3", name:"Foundation Waterproofing" },
      { code:"3.4", name:"Plinth Beam" }
    ]},
    { code:"4", name:"Substructure", children:[
      { code:"4.1", name:"Columns up to Plinth" },
      { code:"4.2", name:"Plinth Filling" }
    ]},
    { code:"5", name:"Superstructure", children:[
      { code:"5.1", name:"Columns" },
      { code:"5.2", name:"Beams" },
      { code:"5.3", name:"Slabs" },
      { code:"5.4", name:"Staircase" }
    ]},
    { code:"6", name:"Masonry", children:[
      { code:"6.1", name:"Brickwork / Blockwork — Internal" },
      { code:"6.2", name:"Brickwork / Blockwork — External" }
    ]},
    { code:"7", name:"Plastering", children:[
      { code:"7.1", name:"Internal Plastering" },
      { code:"7.2", name:"External Plastering" }
    ]},
    { code:"8", name:"Waterproofing", children:[
      { code:"8.1", name:"Terrace Waterproofing" },
      { code:"8.2", name:"Toilet / Wet Area Waterproofing" }
    ]},
    { code:"9", name:"Flooring & Tiling", children:[
      { code:"9.1", name:"Flooring" },
      { code:"9.2", name:"Wall Tiling / Dado" },
      { code:"9.3", name:"Skirting" }
    ]},
    { code:"10", name:"Electrical Works", children:[
      { code:"10.1", name:"Conduiting & Wiring" },
      { code:"10.2", name:"Panel & DB Installation" },
      { code:"10.3", name:"Fixtures & Fittings" }
    ]},
    { code:"11", name:"Plumbing & Sanitary", children:[
      { code:"11.1", name:"Internal Plumbing" },
      { code:"11.2", name:"External Plumbing" },
      { code:"11.3", name:"Sanitary Fixtures" }
    ]},
    { code:"12", name:"Fire Fighting", children:[
      { code:"12.1", name:"Fire Fighting Piping" },
      { code:"12.2", name:"Fire Fighting Equipment" }
    ]},
    { code:"13", name:"HVAC", children:[
      { code:"13.1", name:"Ducting" },
      { code:"13.2", name:"Equipment Installation" }
    ]},
    { code:"14", name:"Doors & Windows", children:[
      { code:"14.1", name:"Door Frames & Shutters" },
      { code:"14.2", name:"Windows & Glazing" }
    ]},
    { code:"15", name:"Painting & Finishing", children:[
      { code:"15.1", name:"Internal Painting" },
      { code:"15.2", name:"External Painting" },
      { code:"15.3", name:"POP / False Ceiling" }
    ]},
    { code:"16", name:"External Development", children:[
      { code:"16.1", name:"Compound Wall" },
      { code:"16.2", name:"Roads & Pavements" },
      { code:"16.3", name:"Landscaping" },
      { code:"16.4", name:"External Drainage" }
    ]},
    { code:"17", name:"Testing & Commissioning", children:[
      { code:"17.1", name:"Electrical Testing" },
      { code:"17.2", name:"Fire Fighting Testing" },
      { code:"17.3", name:"HVAC Testing" }
    ]},
    { code:"18", name:"Handover", children:[
      { code:"18.1", name:"Snagging & De-snagging" },
      { code:"18.2", name:"As-built Drawings" },
      { code:"18.3", name:"Completion Certificate" },
      { code:"18.4", name:"Final Handover" }
    ]}
  ];

  function wbsCodeSortKey(code){
    return code.split(".").map(Number).reduce((s,v,i)=> s + v/Math.pow(1000,i), 0);
  }
  function wbsNodesSorted(){
    return DB.wbsNodes.list(n=>n.projectId===project.id).sort((a,b)=> wbsCodeSortKey(a.code) - wbsCodeSortKey(b.code));
  }

  function renderWBS(){
    const nodes = wbsNodesSorted();
    const panel = document.getElementById("panelWBS");
    panel.innerHTML = `
      <div class="flex justify-between mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:560px">Break the project down into a Work Breakdown Structure — insert the full standard template for a typical building project, then add or remove line items to match this project's scope.</p>
        <div class="flex gap-2">
          <button class="btn btn-outline btn-sm" id="exportWbsCsvBtn">⬇ Export CSV</button>
          <button class="btn btn-outline btn-sm" id="printWbsBtn">🖨 Print</button>
          <button class="btn btn-primary btn-sm" id="insertWbsTemplateBtn">+ Insert Standard WBS Template</button>
          <button class="btn btn-outline btn-sm" id="addWbsNodeBtn">+ Add Item</button>
        </div>
      </div>
      ${nodes.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th style="width:90px">Code</th><th>Work Item</th><th style="width:130px">Progress %</th><th style="width:70px"></th></tr></thead>
      <tbody>${nodes.map(n=>{
        const depth = n.code.split(".").length - 1;
        return `<tr data-node="${n.id}">
          <td>${U.escapeHtml(n.code)}</td>
          <td style="padding-left:${16 + depth*22}px">${depth===0?`<b>${U.escapeHtml(n.name)}</b>`:U.escapeHtml(n.name)}</td>
          <td><input class="input wbs-progress" type="number" min="0" max="100" value="${n.progressPct||0}" style="width:80px"></td>
          <td><button class="btn-icon" data-rm-wbs="${n.id}" title="Remove">✕</button></td>
        </tr>`;
      }).join("")}</tbody></table></div>` : `<div class="empty-state"><div class="es-icon">🗂️</div>No WBS items yet — insert the standard template to get started, or add your own.</div>`}`;

    document.getElementById("insertWbsTemplateBtn").addEventListener("click", ()=>{
      if(nodes.length && !confirm("A WBS already exists for this project. Insert the standard template alongside it? (existing items are kept)")) return;
      WBS_TEMPLATE.forEach(top=>{
        const parent = DB.wbsNodes.create({ projectId:project.id, code:top.code, name:top.name, parentId:null, progressPct:0 });
        (top.children||[]).forEach(c=> DB.wbsNodes.create({ projectId:project.id, code:c.code, name:c.name, parentId:parent.id, progressPct:0 }));
      });
      U.toast("Standard WBS template inserted.", {type:"success"});
      renderWBS();
    });
    document.getElementById("addWbsNodeBtn").addEventListener("click", ()=> openWbsNodeModal());
    document.getElementById("exportWbsCsvBtn").addEventListener("click", ()=>{
      U.exportCSV(`wbs-${project.name}`, ["Code","Work Item","Progress %"], nodes.map(n=>[n.code, n.name, n.progressPct||0]));
    });
    document.getElementById("printWbsBtn").addEventListener("click", ()=> printWBS(nodes));

    panel.querySelectorAll(".wbs-progress").forEach(inp=> inp.addEventListener("change", e=>{
      const nodeId = e.target.closest("tr").dataset.node;
      let val = +e.target.value||0; val = Math.max(0, Math.min(100, val));
      DB.wbsNodes.update(nodeId, { progressPct: val });
    }));
    panel.querySelectorAll("[data-rm-wbs]").forEach(b=> b.addEventListener("click", ()=>{
      const id = b.dataset.rmWbs;
      const hasChildren = DB.wbsNodes.list(n=>n.parentId===id).length>0;
      if(hasChildren && !confirm("This item has sub-items under it, which will also be removed. Continue?")) return;
      DB.wbsNodes.list(n=>n.parentId===id).forEach(c=> DB.wbsNodes.remove(c.id));
      DB.wbsNodes.remove(id);
      renderWBS();
    }));
  }

  function openWbsNodeModal(){
    const nodes = wbsNodesSorted();
    const topLevel = nodes.filter(n=>!n.parentId);
    document.getElementById("genericModalTitle").textContent = "Add WBS Item";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="field"><label>Parent Item</label><select class="select" id="wbsParent"><option value="">— Top Level —</option>${topLevel.map(n=>`<option value="${n.id}">${U.escapeHtml(n.code)} ${U.escapeHtml(n.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Name</label><input class="input" id="wbsName" placeholder="e.g. Basement Waterproofing"></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="wbsSaveBtn">Add</button>`;
    U.openModal("genericModal");
    document.getElementById("wbsSaveBtn").addEventListener("click", ()=>{
      const name = document.getElementById("wbsName").value.trim();
      if(!name){ U.toast("Enter a name.", {type:"danger"}); return; }
      const parentId = document.getElementById("wbsParent").value || null;
      let code;
      if(parentId){
        const parent = DB.wbsNodes.get(parentId);
        const siblingCount = DB.wbsNodes.list(n=>n.parentId===parentId).length;
        code = parent.code + "." + (siblingCount+1);
      } else {
        const topCodes = nodes.filter(n=>!n.parentId).map(n=>parseInt(n.code,10)).filter(n=>!isNaN(n));
        code = String((topCodes.length ? Math.max(...topCodes) : 0) + 1);
      }
      DB.wbsNodes.create({ projectId:project.id, code, name, parentId, progressPct:0 });
      U.closeModal("genericModal"); renderWBS();
      U.toast("WBS item added.", {type:"success"});
    });
  }

  function printWBS(nodes){
    const rows = nodes.map(n=>{
      const depth = n.code.split(".").length - 1;
      return `<tr><td>${U.escapeHtml(n.code)}</td><td style="padding-left:${depth*20}px">${U.escapeHtml(n.name)}</td><td>${n.progressPct||0}%</td></tr>`;
    }).join("");
    const body = `
      <div class="title">Work Breakdown Structure</div>
      <p style="font-size:13px"><b>Project:</b> ${U.escapeHtml(project.name)} &nbsp;|&nbsp; <b>Total Items:</b> ${nodes.length}</p>
      <table><thead><tr><th style="width:90px">Code</th><th>Work Item</th><th style="width:90px">Progress</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
    SW.UI.printDocument(`WBS — ${U.escapeHtml(project.name)}`, body);
  }

  /* ================= GANTT ================= */
  function renderGantt(){
    const tasks = DB.ganttTasks.list(g=>g.projectId===project.id).sort((a,b)=> new Date(a.start)-new Date(b.start));
    const panel = document.getElementById("panelGantt");
    if(!tasks.length){
      panel.innerHTML = `<div class="empty-state"><div class="es-icon">📊</div>No tasks yet.</div><button class="btn btn-primary mt-3" id="addTaskBtn">+ Add Task</button>`;
      document.getElementById("addTaskBtn").addEventListener("click", openTaskModal);
      return;
    }
    const minDate = new Date(Math.min(...tasks.map(t=>new Date(t.start))));
    minDate.setDate(minDate.getDate()-2);
    const maxDate = new Date(Math.max(...tasks.map(t=>new Date(t.end))));
    maxDate.setDate(maxDate.getDate()+4);
    const totalDays = U.daysBetween(minDate,maxDate);
    const dayW = 32;

    let dayHeader = "";
    for(let i=0;i<totalDays;i++){
      const d = new Date(minDate); d.setDate(d.getDate()+i);
      const weekend = d.getDay()===0||d.getDay()===6;
      dayHeader += `<div class="gantt-day-cell ${weekend?'weekend':''}">${d.getDate()}<br>${d.toLocaleDateString('en-IN',{month:'short'})}</div>`;
    }
    let sideRows="", barRows="";
    tasks.forEach(t=>{
      sideRows += `<div class="gantt-side-row">${t.critical?'🚨 ':''}${U.escapeHtml(t.name)}</div>`;
      const offset = U.daysBetween(minDate, t.start) * dayW;
      const width = Math.max(dayW, U.daysBetween(t.start, t.end) * dayW) || dayW;
      if(t.type==="milestone"){
        barRows += `<div class="gantt-row"><div class="gantt-bar milestone" style="left:${offset}px" title="${U.escapeHtml(t.name)} — ${U.fmtDate(t.start)}" data-task="${t.id}"></div></div>`;
      } else {
        barRows += `<div class="gantt-row">
          <div class="gantt-bar ${t.critical?'critical':''}" style="left:${offset}px;width:${width}px" data-task="${t.id}" data-start="${t.start}" data-end="${t.end}" title="${U.escapeHtml(t.name)} (${t.progress||0}%) · ${U.fmtDate(t.start)}–${U.fmtDate(t.end)}${t.dependsOn&&t.dependsOn.length?' · depends on '+t.dependsOn.length+' task(s)':''} — drag to move, resize the right edge to extend">
            <div class="progress-fill" style="width:${t.progress||0}%"></div><span style="position:relative;z-index:1">${U.escapeHtml(t.name)}</span>
            <span class="gantt-resize-handle" data-resize="${t.id}"></span>
          </div>
        </div>`;
      }
    });

    panel.innerHTML = `
      <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
        <div class="flex gap-3 items-center" style="font-size:12px">
          <span><span class="badge" style="background:var(--sw-gradient-brand);color:#fff">■</span> Task</span>
          <span><span class="badge" style="background:var(--sw-gradient-warm);color:#fff">■</span> Critical Path</span>
          <span><span class="badge" style="background:var(--sw-accent);color:#fff">◆</span> Milestone</span>
        </div>
        <button class="btn btn-primary btn-sm" id="addTaskBtn">+ Add Task</button>
      </div>
      <div class="gantt-wrap scrollbar-thin">
        <div class="gantt-side"><div class="gantt-side-row" style="font-weight:700;background:var(--surface-solid)">Task</div>${sideRows}</div>
        <div class="gantt-scroll scrollbar-thin"><div class="gantt-grid" style="width:${totalDays*dayW}px">
          <div class="gantt-day-header">${dayHeader}</div>${barRows}
        </div></div>
      </div>
      <p class="hint mt-3">Click a bar to edit it, drag its body to move dates, or drag the right edge to extend duration.</p>`;

    document.getElementById("addTaskBtn").addEventListener("click", ()=>openTaskModal());
    bindGanttInteractions(panel, dayW);
  }

  function shiftDate(dateStr, days){
    const d = new Date(dateStr); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
  }

  function bindGanttInteractions(panel, dayW){
    let drag = null; // {type:'move'|'resize', taskId, startX, origLeft, origWidth, bar}
    U.qsa(".gantt-bar[data-task]", panel).forEach(bar=>{
      bar.addEventListener("mousedown", e=>{
        if(e.target.closest("[data-resize]")) return; // handled separately
        e.preventDefault();
        drag = { type:"move", taskId:bar.dataset.task, startX:e.clientX, moved:false, bar, origLeft:parseFloat(bar.style.left) };
      });
    });
    U.qsa("[data-resize]", panel).forEach(handle=>{
      handle.addEventListener("mousedown", e=>{
        e.preventDefault(); e.stopPropagation();
        const bar = handle.closest(".gantt-bar");
        drag = { type:"resize", taskId:handle.dataset.resize, startX:e.clientX, moved:false, bar, origWidth:parseFloat(bar.style.width) };
      });
    });
    function onMouseMove(e){
      if(!drag) return;
      const dx = e.clientX - drag.startX;
      if(Math.abs(dx) > 4) drag.moved = true;
      if(drag.type==="move") drag.bar.style.left = (drag.origLeft + dx) + "px";
      else drag.bar.style.width = Math.max(dayW, drag.origWidth + dx) + "px";
    }
    function onMouseUp(){
      if(!drag) return;
      if(drag.moved){
        const task = DB.ganttTasks.get(drag.taskId);
        const dayDelta = Math.round((drag.type==="move" ? (parseFloat(drag.bar.style.left)-drag.origLeft) : 0) / dayW);
        if(drag.type==="move" && dayDelta!==0){
          DB.ganttTasks.update(task.id, { start: shiftDate(task.start, dayDelta), end: shiftDate(task.end, dayDelta) });
          U.toast("Task dates updated.", {type:"success"});
        } else if(drag.type==="resize"){
          const newWidthDays = Math.max(1, Math.round(parseFloat(drag.bar.style.width) / dayW));
          const newEnd = shiftDate(task.start, newWidthDays);
          if(newEnd !== task.end){ DB.ganttTasks.update(task.id, { end:newEnd }); U.toast("Task duration updated.", {type:"success"}); }
        }
        recalcProjectProgress();
        renderGantt();
      } else if(drag.type==="move"){
        openTaskModal(drag.taskId);
      }
      drag = null;
    }
    document.removeEventListener("mousemove", panel._ganttMouseMove||(()=>{}));
    document.removeEventListener("mouseup", panel._ganttMouseUp||(()=>{}));
    panel._ganttMouseMove = onMouseMove;
    panel._ganttMouseUp = onMouseUp;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function openTaskModal(taskId){
    const task = taskId ? DB.ganttTasks.get(taskId) : null;
    const allTasks = DB.ganttTasks.list(g=>g.projectId===project.id && g.id!==taskId);
    document.getElementById("genericModalTitle").textContent = task ? "Edit Task" : "Add Task";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="field"><label>Task Name</label><input class="input" id="mtName" value="${task?U.escapeHtml(task.name):''}"></div>
      <div class="input-group">
        <div class="field"><label>Start Date</label><input class="input" type="date" id="mtStart" value="${task?task.start:''}"></div>
        <div class="field"><label>End Date</label><input class="input" type="date" id="mtEnd" value="${task?task.end:''}"></div>
      </div>
      <div class="input-group">
        <div class="field"><label>Type</label><select class="select" id="mtType"><option value="task" ${task&&task.type==='task'?'selected':''}>Task</option><option value="milestone" ${task&&task.type==='milestone'?'selected':''}>Milestone</option></select></div>
        <div class="field"><label>Progress %</label><input class="input" type="number" min="0" max="100" id="mtProgress" value="${task?task.progress:0}"></div>
      </div>
      <div class="field"><label>Depends On</label><select class="select" id="mtDepends" multiple size="4">${allTasks.map(t=>`<option value="${t.id}" ${task&&(task.dependsOn||[]).includes(t.id)?'selected':''}>${U.escapeHtml(t.name)}</option>`).join("")}</select></div>
      <label class="checkbox-row"><input type="checkbox" id="mtCritical" ${task&&task.critical?'checked':''}> Mark as Critical Path</label>`;
    document.getElementById("genericModalFoot").innerHTML = `${task?'<button class="btn btn-danger" id="mtDelete">Delete</button>':''}<button class="btn btn-primary" id="mtSave">${task?'Save':'Add Task'}</button>`;
    U.openModal("genericModal");
    document.getElementById("mtSave").addEventListener("click", ()=>{
      const data = {
        projectId:project.id, name:document.getElementById("mtName").value.trim()||"Untitled Task",
        start:document.getElementById("mtStart").value, end:document.getElementById("mtEnd").value||document.getElementById("mtStart").value,
        type:document.getElementById("mtType").value, progress:+document.getElementById("mtProgress").value||0,
        critical:document.getElementById("mtCritical").checked,
        dependsOn: Array.from(document.getElementById("mtDepends").selectedOptions).map(o=>o.value)
      };
      if(!data.start){ U.toast("Set a start date.", {type:"danger"}); return; }
      if(task) DB.ganttTasks.update(task.id, data); else DB.ganttTasks.create(Object.assign({baselineStart:data.start,baselineEnd:data.end}, data));
      recalcProjectProgress();
      U.closeModal("genericModal"); renderGantt(); renderOverview();
      U.toast("Task saved.", {type:"success"});
    });
    document.getElementById("mtDelete")?.addEventListener("click", ()=>{ DB.ganttTasks.remove(task.id); U.closeModal("genericModal"); renderGantt(); U.toast("Task deleted.", {type:"warning"}); });
  }

  function recalcProjectProgress(){
    const tasks = DB.ganttTasks.list(g=>g.projectId===project.id && g.type!=="milestone");
    if(!tasks.length) return;
    const avg = Math.round(tasks.reduce((s,t)=>s+(t.progress||0),0)/tasks.length);
    DB.projects.update(project.id, {progressPct:avg});
    project = DB.projects.get(project.id);
    renderHeader();
  }

  /* ================= KANBAN ================= */
  function renderKanban(){
    let cols = DB.kanbanColumns.list(c=>c.projectId===project.id).sort((a,b)=>a.order-b.order);
    if(!cols.length){ ["Backlog","To Do","In Progress","Review","Done"].forEach((name,idx)=> DB.kanbanColumns.create({projectId:project.id,name,order:idx})); cols = DB.kanbanColumns.list(c=>c.projectId===project.id).sort((a,b)=>a.order-b.order); }
    const panel = document.getElementById("panelKanban");
    panel.innerHTML = `<div class="flex justify-between mb-3"><button class="btn btn-outline btn-sm" id="addColBtn">+ Add Column</button></div>
      <div class="kanban-board scrollbar-thin">${cols.map(col=>{
        const cards = DB.kanbanCards.list(c=>c.projectId===project.id && c.columnId===col.id);
        return `<div class="kanban-col" data-col="${col.id}">
          <div class="kanban-col-head"><span>${U.escapeHtml(col.name)}</span><span class="count">${cards.length}</span></div>
          <div class="kanban-cards" data-col-drop="${col.id}">${cards.map(c=>kanbanCardHtml(c)).join("")}</div>
          <button class="btn btn-ghost btn-sm w-full mt-2" data-add-card="${col.id}">+ Add Card</button>
        </div>`;
      }).join("")}</div>`;
    document.getElementById("addColBtn").addEventListener("click", ()=>{
      const name = prompt("Column name:"); if(!name) return;
      DB.kanbanColumns.create({projectId:project.id, name, order:cols.length});
      renderKanban();
    });
    bindKanbanDnD();
  }
  function kanbanCardHtml(c){
    return `<div class="kanban-card" draggable="true" data-card="${c.id}">
      <div class="priority-bar priority-${c.priority||'low'}"></div>
      <div class="kc-title">${U.escapeHtml(c.title)}</div>
      <div class="kc-meta"><span class="avatar" style="width:22px;height:22px;font-size:10px">${(c.assignee||"?").slice(0,2).toUpperCase()}</span><span>${c.dueDate?U.fmtDate(c.dueDate):''}</span></div>
    </div>`;
  }
  function bindKanbanDnD(){
    const panel = document.getElementById("panelKanban");
    let dragCard = null;
    U.qsa(".kanban-card", panel).forEach(card=>{
      card.addEventListener("dragstart", ()=>{ dragCard = card.dataset.card; card.classList.add("dragging"); });
      card.addEventListener("dragend", ()=> card.classList.remove("dragging"));
      card.addEventListener("click", ()=> openCardModal(card.dataset.card));
    });
    U.qsa(".kanban-col", panel).forEach(col=>{
      col.addEventListener("dragover", e=>{ e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", ()=> col.classList.remove("drag-over"));
      col.addEventListener("drop", ()=>{
        col.classList.remove("drag-over");
        if(dragCard) DB.kanbanCards.update(dragCard, {columnId:col.dataset.col});
        renderKanban();
      });
      col.querySelector("[data-add-card]").addEventListener("click", e=> openCardModal(null, e.target.dataset.addCard));
    });
  }
  function openCardModal(cardId, columnId){
    const card = cardId ? DB.kanbanCards.get(cardId) : null;
    document.getElementById("genericModalTitle").textContent = card ? "Edit Card" : "Add Card";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="field"><label>Title</label><input class="input" id="ckTitle" value="${card?U.escapeHtml(card.title):''}"></div>
      <div class="input-group">
        <div class="field"><label>Priority</label><select class="select" id="ckPriority"><option value="low" ${card&&card.priority==='low'?'selected':''}>Low</option><option value="med" ${card&&card.priority==='med'?'selected':''}>Medium</option><option value="high" ${card&&card.priority==='high'?'selected':''}>High</option></select></div>
        <div class="field"><label>Due Date</label><input class="input" type="date" id="ckDue" value="${card?card.dueDate||'':''}"></div>
      </div>
      <div class="field"><label>Assignee</label><input class="input" id="ckAssignee" value="${card?U.escapeHtml(card.assignee||''):U.escapeHtml(otherUser?otherUser.name:'')}"></div>`;
    document.getElementById("genericModalFoot").innerHTML = `${card?'<button class="btn btn-danger" id="ckDelete">Delete</button>':''}<button class="btn btn-primary" id="ckSave">Save</button>`;
    U.openModal("genericModal");
    document.getElementById("ckSave").addEventListener("click", ()=>{
      const data = { title:document.getElementById("ckTitle").value.trim()||"Untitled", priority:document.getElementById("ckPriority").value, dueDate:document.getElementById("ckDue").value, assignee:document.getElementById("ckAssignee").value.trim() };
      if(card) DB.kanbanCards.update(card.id, data); else DB.kanbanCards.create(Object.assign({projectId:project.id, columnId}, data));
      U.closeModal("genericModal"); renderKanban();
    });
    document.getElementById("ckDelete")?.addEventListener("click", ()=>{ DB.kanbanCards.remove(card.id); U.closeModal("genericModal"); renderKanban(); });
  }

  /* ================= CALENDAR ================= */
  function renderCalendar(){
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    const first = new Date(year,month,1);
    const startDay = first.getDay();
    const daysInMonth = new Date(year,month+1,0).getDate();
    const tasks = DB.ganttTasks.list(g=>g.projectId===project.id);
    const dprs = DB.dprs.list(d=>d.projectId===project.id);

    let cells = "";
    for(let i=0;i<startDay;i++) cells += `<div class="cal-cell" style="visibility:hidden"></div>`;
    for(let d=1; d<=daysInMonth; d++){
      const dateStr = new Date(year,month,d).toISOString().slice(0,10);
      const isToday = new Date().toDateString() === new Date(year,month,d).toDateString();
      const events = [];
      tasks.forEach(t=>{ if(t.end===dateStr) events.push({label:t.name, color: t.type==="milestone"?"var(--sw-accent)":"var(--sw-primary)"}); });
      dprs.forEach(r=>{ if(r.date===dateStr) events.push({label:"DPR logged", color:"var(--sw-success)"}); });
      cells += `<div class="cal-cell ${isToday?'today':''}"><div class="cal-date">${d}</div>${events.map(e=>`<div class="cal-event"><span class="cal-dot" style="background:${e.color}"></span>${U.escapeHtml(e.label)}</div>`).join("")}</div>`;
    }
    document.getElementById("panelCalendar").innerHTML = `
      <div class="card">
        <h3>${first.toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</h3>
        <div class="cal-grid mt-3">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>`<div style="font-size:11px;font-weight:700;text-align:center;color:var(--text-muted)">${d}</div>`).join("")}${cells}</div>
      </div>`;
  }

  /* ================= WORK PLAN ================= */
  function workPlanStatusBadge(status){
    return { planned:"badge-info", in_progress:"badge-warning", completed:"badge-success" }[status] || "badge-neutral";
  }
  function renderWorkPlan(){
    const plans = DB.workPlans.list(w=>w.projectId===project.id).sort((a,b)=> new Date(b.dateFrom||0)-new Date(a.dateFrom||0));
    const panel = document.getElementById("panelWorkPlan");
    panel.innerHTML = `
      <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:520px">Plan ahead — define the labour, material and equipment needed for an upcoming period. Either side can add or update a plan.</p>
        <button class="btn btn-primary btn-sm" id="addWorkPlanBtn">+ Add Work Plan</button>
      </div>
      ${plans.length ? plans.map(w=>{
        const creator = DB.users.get(w.createdBy);
        const task = w.ganttTaskId ? DB.ganttTasks.get(w.ganttTaskId) : null;
        const canManage = isPM || w.createdBy===user.id;
        return `<div class="card mb-3">
          <div class="flex justify-between items-start mb-2" style="flex-wrap:wrap;gap:10px">
            <div><b>${U.fmtDate(w.dateFrom)} – ${U.fmtDate(w.dateTo)}</b>${task?` · <span class="badge badge-accent">${U.escapeHtml(task.name)}</span>`:""}</div>
            <span class="badge ${workPlanStatusBadge(w.status)}">${(w.status||"planned").replace("_"," ")}</span>
          </div>
          <div class="grid grid-3 mb-2">
            <div><div class="text-muted" style="font-size:11px">LABOUR</div>${(w.labour||[]).length ? w.labour.map(l=>`<div style="font-size:13px">${U.escapeHtml(l.trade)}: <b>${l.count}</b></div>`).join("") : `<span class="text-muted" style="font-size:12px">—</span>`}</div>
            <div><div class="text-muted" style="font-size:11px">MATERIAL</div>${(w.material||[]).length ? w.material.map(m=>`<div style="font-size:13px">${U.escapeHtml(m.item)}: <b>${m.qty} ${U.escapeHtml(m.unit)}</b></div>`).join("") : `<span class="text-muted" style="font-size:12px">—</span>`}</div>
            <div><div class="text-muted" style="font-size:11px">EQUIPMENT</div><div style="font-size:13px">${U.escapeHtml(w.equipment||"—")}</div></div>
          </div>
          ${w.remarks ? `<p style="font-size:13px" class="mb-2"><b>Remarks:</b> ${U.escapeHtml(w.remarks)}</p>` : ""}
          <div class="flex justify-between items-center">
            <span class="text-muted" style="font-size:11px">By ${creator?U.escapeHtml(creator.name):"—"} (${creator?SW.UI.roleLabel(creator.role):"—"}) · ${U.relativeTime(w.createdAt)}</span>
            ${canManage ? `<div class="flex gap-2">
              <select class="select wp-status-select" data-wp="${w.id}" style="max-width:150px">
                <option value="planned" ${w.status==='planned'?'selected':''}>Planned</option>
                <option value="in_progress" ${w.status==='in_progress'?'selected':''}>In Progress</option>
                <option value="completed" ${w.status==='completed'?'selected':''}>Completed</option>
              </select>
              <button class="btn btn-sm btn-outline" data-edit-wp="${w.id}">Edit</button>
              <button class="btn btn-sm btn-ghost" data-delete-wp="${w.id}">Delete</button>
            </div>` : ""}
          </div>
        </div>`;
      }).join("") : `<div class="empty-state"><div class="es-icon">📅</div>No work plans yet.</div>`}`;
    document.getElementById("addWorkPlanBtn").addEventListener("click", ()=> openWorkPlanModal());
    panel.addEventListener("change", e=>{
      if(e.target.classList.contains("wp-status-select")){
        DB.workPlans.update(e.target.dataset.wp, {status:e.target.value});
        U.toast("Status updated.", {type:"success"});
        renderWorkPlan();
      }
    });
    panel.addEventListener("click", e=>{
      const edit = e.target.closest("[data-edit-wp]");
      const del = e.target.closest("[data-delete-wp]");
      if(edit) openWorkPlanModal(edit.dataset.editWp);
      if(del){
        if(!confirm("Delete this work plan?")) return;
        DB.workPlans.remove(del.dataset.deleteWp);
        U.toast("Work plan deleted.", {type:"warning"});
        renderWorkPlan();
      }
    });
  }

  // Approximate standard estimation norms (material & mandays) per unit quantity of common work items.
  // These are typical construction industry averages meant as a starting point — always adjust for your site.
  const WORK_NORMS = [
    { name:"Excavation — ordinary soil", unit:"Cum",
      material:[], labour:[{trade:"Mazdoor", perUnit:0.20}] },
    { name:"PCC 1:4:8", unit:"Cum",
      material:[{item:"Cement", perUnit:4.0, unit:"Bags"},{item:"Sand", perUnit:0.45, unit:"Cum"},{item:"Aggregate", perUnit:0.90, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.15},{trade:"Mazdoor", perUnit:0.60}] },
    { name:"RCC M25 (excl. steel)", unit:"Cum",
      material:[{item:"Cement", perUnit:8.0, unit:"Bags"},{item:"Sand", perUnit:0.42, unit:"Cum"},{item:"Aggregate", perUnit:0.84, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.30},{trade:"Mazdoor", perUnit:1.20},{trade:"Bar Bender", perUnit:0.25}] },
    { name:"Brickwork 1:6", unit:"Cum",
      material:[{item:"Bricks", perUnit:500, unit:"Nos"},{item:"Cement", perUnit:1.5, unit:"Bags"},{item:"Sand", perUnit:0.30, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.80},{trade:"Mazdoor", perUnit:1.60}] },
    { name:"Plastering 12mm (1:6)", unit:"Sqm",
      material:[{item:"Cement", perUnit:0.09, unit:"Bags"},{item:"Sand", perUnit:0.015, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.10},{trade:"Mazdoor", perUnit:0.10}] },
    { name:"Flooring — vitrified tiles", unit:"Sqm",
      material:[{item:"Tiles", perUnit:1.05, unit:"Sqm"},{item:"Cement", perUnit:0.20, unit:"Bags"},{item:"Sand", perUnit:0.02, unit:"Cum"}],
      labour:[{trade:"Tile Mason", perUnit:0.15},{trade:"Mazdoor", perUnit:0.15}] },
    { name:"Painting — 2 coats emulsion", unit:"Sqm",
      material:[{item:"Emulsion Paint", perUnit:0.14, unit:"Litre"}],
      labour:[{trade:"Painter", perUnit:0.05}] },
    { name:"Steel reinforcement (TMT) fixing", unit:"MT",
      material:[{item:"Binding Wire", perUnit:10, unit:"Kg"}],
      labour:[{trade:"Bar Bender", perUnit:1.0},{trade:"Mazdoor", perUnit:0.5}] },
    { name:"RCC M20 (excl. steel)", unit:"Cum",
      material:[{item:"Cement", perUnit:6.5, unit:"Bags"},{item:"Sand", perUnit:0.45, unit:"Cum"},{item:"Aggregate", perUnit:0.90, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.28},{trade:"Mazdoor", perUnit:1.10},{trade:"Bar Bender", perUnit:0.22}] },
    { name:"Shuttering / Formwork (centering)", unit:"Sqm",
      material:[{item:"Shuttering Oil", perUnit:0.02, unit:"Litre"}],
      labour:[{trade:"Carpenter", perUnit:0.25},{trade:"Mazdoor", perUnit:0.25}] },
    { name:"Damp Proof Course (DPC)", unit:"Sqm",
      material:[{item:"Cement", perUnit:0.15, unit:"Bags"},{item:"Sand", perUnit:0.02, unit:"Cum"}],
      labour:[{trade:"Mason", perUnit:0.05},{trade:"Mazdoor", perUnit:0.05}] },
    { name:"Waterproofing (chemical coating)", unit:"Sqm",
      material:[{item:"Waterproofing Compound", perUnit:1.5, unit:"Kg"}],
      labour:[{trade:"Mazdoor", perUnit:0.06}] },
    { name:"Anti-termite treatment", unit:"Sqm",
      material:[{item:"Anti-termite Chemical", perUnit:1.0, unit:"Litre"}],
      labour:[{trade:"Mazdoor", perUnit:0.02}] },
    { name:"POP Punning (ceiling/wall)", unit:"Sqm",
      material:[{item:"POP Powder", perUnit:2.0, unit:"Kg"}],
      labour:[{trade:"Mason", perUnit:0.08},{trade:"Mazdoor", perUnit:0.04}] },
    { name:"False Ceiling — gypsum board", unit:"Sqm",
      material:[{item:"Gypsum Board", perUnit:1.05, unit:"Sqm"},{item:"GI Frame", perUnit:1.0, unit:"Set"}],
      labour:[{trade:"Carpenter", perUnit:0.20},{trade:"Helper", perUnit:0.20}] },
    { name:"Distemper/Primer painting", unit:"Sqm",
      material:[{item:"Primer", perUnit:0.10, unit:"Litre"},{item:"Distemper", perUnit:0.12, unit:"Litre"}],
      labour:[{trade:"Painter", perUnit:0.04}] },
    { name:"Tile Skirting", unit:"Rmt",
      material:[{item:"Skirting Tile", perUnit:1.05, unit:"Rmt"},{item:"Cement", perUnit:0.05, unit:"Bags"}],
      labour:[{trade:"Tile Mason", perUnit:0.05}] },
    { name:"Electrical wiring (per point)", unit:"Point",
      material:[{item:"Wire", perUnit:15, unit:"m"},{item:"Conduit Pipe", perUnit:5, unit:"m"},{item:"Switch/Socket", perUnit:1, unit:"Nos"}],
      labour:[{trade:"Electrician", perUnit:0.5}] },
    { name:"Plumbing (per point)", unit:"Point",
      material:[{item:"GI/CPVC Pipe", perUnit:3, unit:"m"},{item:"Fittings", perUnit:2, unit:"Nos"}],
      labour:[{trade:"Plumber", perUnit:0.4}] },
    { name:"Structural steel fabrication & erection", unit:"MT",
      material:[{item:"Welding Electrode", perUnit:5, unit:"Kg"},{item:"Primer Paint", perUnit:2, unit:"Litre"}],
      labour:[{trade:"Fitter", perUnit:1.5},{trade:"Welder", perUnit:1.0},{trade:"Helper", perUnit:1.0}] },
    { name:"Road / WBM (Water Bound Macadam)", unit:"Cum",
      material:[{item:"Screening", perUnit:0.15, unit:"Cum"}],
      labour:[{trade:"Mazdoor", perUnit:0.5},{trade:"Roller Operator", perUnit:0.05}] },
    { name:"Aluminium glazing / windows", unit:"Sqm",
      material:[{item:"Aluminium Section", perUnit:3.0, unit:"Kg"},{item:"Glass", perUnit:1.05, unit:"Sqm"},{item:"Sealant", perUnit:0.1, unit:"Kg"}],
      labour:[{trade:"Glazier", perUnit:0.3},{trade:"Helper", perUnit:0.3}] },
    { name:"HVAC ducting (GI sheet metal)", unit:"Sqm",
      material:[{item:"GI Sheet", perUnit:1.1, unit:"Sqm"},{item:"Duct Insulation", perUnit:1.0, unit:"Sqm"}],
      labour:[{trade:"Ducting Fitter", perUnit:0.4},{trade:"Helper", perUnit:0.4}] },
    { name:"Fire fighting piping", unit:"Rmt",
      material:[{item:"MS Pipe", perUnit:1.0, unit:"Rmt"},{item:"Fittings", perUnit:0.2, unit:"Nos"}],
      labour:[{trade:"Fire Fitter", perUnit:0.15},{trade:"Helper", perUnit:0.15}] },
    { name:"Landscaping / horticulture", unit:"Sqm",
      material:[{item:"Topsoil", perUnit:0.1, unit:"Cum"},{item:"Manure", perUnit:2, unit:"Kg"},{item:"Plants", perUnit:0.5, unit:"Nos"}],
      labour:[{trade:"Gardener", perUnit:0.1},{trade:"Mazdoor", perUnit:0.1}] }
  ];

  function wpRowsHtml(rows, cols){
    return rows.map((r,idx)=>`<tr data-idx="${idx}">${cols.map(c=>`<td contenteditable="true" data-field="${c}">${U.escapeHtml(r[c]||"")}</td>`).join("")}<td><button class="btn btn-icon btn-ghost" data-wp-rm-row>🗑</button></td></tr>`).join("");
  }

  function openWorkPlanModal(planId){
    const plan = planId ? DB.workPlans.get(planId) : null;
    let labourRows = plan ? (plan.labour||[]).map(r=>Object.assign({},r)) : [{trade:"",count:""}];
    let materialRows = plan ? (plan.material||[]).map(r=>Object.assign({},r)) : [{item:"",qty:"",unit:""}];
    const tasks = DB.ganttTasks.list(g=>g.projectId===project.id);
    document.getElementById("genericModalTitle").textContent = plan ? "Edit Work Plan" : "Add Work Plan";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="input-group">
        <div class="field"><label>From Date</label><input class="input" type="date" id="wpFrom" value="${plan?plan.dateFrom||'':''}"></div>
        <div class="field"><label>To Date</label><input class="input" type="date" id="wpTo" value="${plan?plan.dateTo||'':''}"></div>
      </div>
      <div class="field"><label>Linked Gantt Task</label><select class="select" id="wpTask"><option value="">— None (auto-create from this plan's dates) —</option>${tasks.map(t=>`<option value="${t.id}" ${plan&&plan.ganttTaskId===t.id?'selected':''}>${U.escapeHtml(t.name)}</option>`).join("")}</select>
      <p class="hint mt-1">Pick an existing Gantt task, or leave as "None" and a timeline entry will be created automatically from this plan's From/To dates.</p></div>

      <div class="card mb-4" style="background:var(--surface-2)">
        <label class="mb-1" style="font-weight:600;font-size:13px">Quick-fill from a Common Work Item</label>
        <p class="hint mb-2">Pick a standard work item and quantity — material and mandays required are added to the tables below automatically using typical estimation norms (adjust afterward for your site).</p>
        <div class="input-group" style="align-items:flex-end">
          <div class="field" style="margin-bottom:0"><label>Work Item</label><select class="select" id="wpNormSelect">${WORK_NORMS.map((n,i)=>`<option value="${i}">${U.escapeHtml(n.name)} (per ${n.unit})</option>`).join("")}</select></div>
          <div class="field" style="margin-bottom:0;max-width:140px"><label>Quantity</label><input class="input" type="number" id="wpNormQty" placeholder="e.g. 50"></div>
          <button class="btn btn-outline" id="wpApplyNormBtn" type="button">+ Add to Plan</button>
        </div>
      </div>

      <label class="mb-1" style="font-weight:600;font-size:13px">Labour Required</label>
      <p class="hint mb-1">Count is mandays/headcount for the period — paste rows from Excel (Trade, Count) directly into the first cell, or use Quick-fill above.</p>
      <div class="table-wrap mb-2"><table class="dtable" id="wpLabourTable"><thead><tr><th>Trade</th><th>Count</th><th></th></tr></thead><tbody id="wpLabourBody">${wpRowsHtml(labourRows,["trade","count"])}</tbody></table></div>
      <button class="btn btn-outline btn-sm mb-3" id="wpAddLabourRow">+ Add Labour Row</button>
      <label class="mb-1" style="font-weight:600;font-size:13px">Material Required</label>
      <p class="hint mb-1">Paste rows from Excel (Item, Qty, Unit) directly into the first cell.</p>
      <div class="table-wrap mb-2"><table class="dtable" id="wpMaterialTable"><thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th></th></tr></thead><tbody id="wpMaterialBody">${wpRowsHtml(materialRows,["item","qty","unit"])}</tbody></table></div>
      <button class="btn btn-outline btn-sm mb-3" id="wpAddMaterialRow">+ Add Material Row</button>
      <div class="field"><label>Equipment (comma separated)</label><input class="input" id="wpEquipment" value="${plan?U.escapeHtml(plan.equipment||''):''}" placeholder="e.g. JCB, Tower Crane, Concrete Mixer"></div>
      <div class="field"><label>Remarks</label><textarea class="textarea" id="wpRemarks">${plan?U.escapeHtml(plan.remarks||''):''}</textarea></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="wpSaveBtn">${plan?'Save Changes':'Create Work Plan'}</button>`;
    U.openModal("genericModal");

    function bindTable(tbodyId, rowsRef, cols){
      const tbody = document.getElementById(tbodyId);
      tbody.addEventListener("blur", e=>{
        const td = e.target.closest("td[data-field]"); if(!td) return;
        const idx = +td.closest("tr").dataset.idx;
        rowsRef[idx][td.dataset.field] = td.textContent.trim();
      }, true);
      tbody.addEventListener("click", e=>{
        if(e.target.closest("[data-wp-rm-row]")){
          const idx = +e.target.closest("tr").dataset.idx;
          rowsRef.splice(idx,1);
          if(!rowsRef.length){ const empty={}; cols.forEach(c=>empty[c]=""); rowsRef.push(empty); }
          tbody.innerHTML = wpRowsHtml(rowsRef, cols);
        }
      });
      tbody.addEventListener("paste", e=>{
        const td = e.target.closest("td[data-field]"); if(!td) return;
        const text = (e.clipboardData||window.clipboardData).getData("text");
        if(!text.includes("\t") && !text.includes("\n")) return;
        e.preventDefault();
        td.blur(); // commit any pending blur-driven update BEFORE we write the pasted values, so it can't clobber them
        const grid = U.parsePastedTable(text);
        const startRow = +td.closest("tr").dataset.idx;
        const startFieldIdx = cols.indexOf(td.dataset.field);
        grid.forEach((row, rOff)=>{
          const rIdx = startRow + rOff;
          while(rowsRef.length<=rIdx){ const empty={}; cols.forEach(c=>empty[c]=""); rowsRef.push(empty); }
          row.forEach((cell, cOff)=>{
            const fIdx = startFieldIdx + cOff;
            if(fIdx>=0 && fIdx<cols.length) rowsRef[rIdx][cols[fIdx]] = cell.trim();
          });
        });
        tbody.innerHTML = wpRowsHtml(rowsRef, cols);
        U.toast(`Pasted ${grid.length} row(s).`, {type:"success"});
      });
    }
    bindTable("wpLabourBody", labourRows, ["trade","count"]);
    bindTable("wpMaterialBody", materialRows, ["item","qty","unit"]);
    document.getElementById("wpAddLabourRow").addEventListener("click", ()=>{ labourRows.push({trade:"",count:""}); document.getElementById("wpLabourBody").innerHTML = wpRowsHtml(labourRows,["trade","count"]); });
    document.getElementById("wpAddMaterialRow").addEventListener("click", ()=>{ materialRows.push({item:"",qty:"",unit:""}); document.getElementById("wpMaterialBody").innerHTML = wpRowsHtml(materialRows,["item","qty","unit"]); });

    document.getElementById("wpApplyNormBtn").addEventListener("click", ()=>{
      const norm = WORK_NORMS[+document.getElementById("wpNormSelect").value];
      const qty = +document.getElementById("wpNormQty").value || 0;
      if(!qty){ U.toast("Enter a quantity to apply the norm to.", {type:"danger"}); return; }
      if(labourRows.length===1 && !labourRows[0].trade) labourRows.length = 0;
      if(materialRows.length===1 && !materialRows[0].item) materialRows.length = 0;
      norm.labour.forEach(l=>{
        const mandays = Math.ceil(qty * l.perUnit * 100) / 100;
        const existing = labourRows.find(r=>r.trade.toLowerCase()===l.trade.toLowerCase());
        if(existing) existing.count = (+existing.count||0) + mandays;
        else labourRows.push({ trade:l.trade, count:mandays });
      });
      norm.material.forEach(m=>{
        const mqty = Math.round(qty * m.perUnit * 100) / 100;
        const existing = materialRows.find(r=>r.item.toLowerCase()===m.item.toLowerCase() && r.unit===m.unit);
        if(existing) existing.qty = (+existing.qty||0) + mqty;
        else materialRows.push({ item:m.item, qty:mqty, unit:m.unit });
      });
      if(!labourRows.length) labourRows.push({trade:"",count:""});
      if(!materialRows.length) materialRows.push({item:"",qty:"",unit:""});
      document.getElementById("wpLabourBody").innerHTML = wpRowsHtml(labourRows,["trade","count"]);
      document.getElementById("wpMaterialBody").innerHTML = wpRowsHtml(materialRows,["item","qty","unit"]);
      U.toast(`Added standard requirement for ${qty} ${norm.unit} of ${norm.name}.`, {type:"success"});
    });

    document.getElementById("wpSaveBtn").addEventListener("click", ()=>{
      const dateFrom = document.getElementById("wpFrom").value;
      const dateTo = document.getElementById("wpTo").value;
      if(!dateFrom || !dateTo){ U.toast("Set both from and to dates.", {type:"danger"}); return; }
      let ganttTaskId = document.getElementById("wpTask").value||null;
      let createdTimeline = false;
      if(!ganttTaskId){
        // No existing Gantt task picked — this Work Plan decides its own slice of the
        // project timeline, so create one automatically instead of leaving the plan
        // disconnected from the schedule.
        const taskName = document.getElementById("wpRemarks").value.trim() || document.getElementById("wpEquipment").value.trim() || `Work Plan (${U.fmtDate(dateFrom)} – ${U.fmtDate(dateTo)})`;
        const newTask = DB.ganttTasks.create({ projectId:project.id, name:taskName, start:dateFrom, end:dateTo, type:"task", progress:0, critical:false, dependsOn:[], baselineStart:dateFrom, baselineEnd:dateTo });
        ganttTaskId = newTask.id;
        createdTimeline = true;
      }
      const data = {
        projectId:project.id, dateFrom, dateTo, ganttTaskId,
        labour: labourRows.filter(r=>r.trade && r.trade.trim()).map(r=>({trade:r.trade.trim(), count:+r.count||0})),
        material: materialRows.filter(r=>r.item && r.item.trim()).map(r=>({item:r.item.trim(), qty:+r.qty||0, unit:(r.unit||"").trim()||"Nos"})),
        equipment: document.getElementById("wpEquipment").value.trim(),
        remarks: document.getElementById("wpRemarks").value.trim()
      };
      if(plan) DB.workPlans.update(plan.id, data);
      else DB.workPlans.create(Object.assign({status:"planned", createdBy:user.id}, data));
      const otherId = isPM ? project.contractorId : project.pmId;
      if(otherId) DB.notifications.create({ userId:otherId, title: plan?"Work plan updated":"New work plan added", body:`${U.fmtDate(dateFrom)} – ${U.fmtDate(dateTo)} on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=workplan" });
      if(createdTimeline) recalcProjectProgress();
      U.closeModal("genericModal"); renderWorkPlan(); renderGantt(); renderOverview();
      U.toast(plan?"Work plan updated.":(createdTimeline ? "Work plan created — a Gantt timeline entry was added automatically." : "Work plan created."), {type:"success"});
    });
  }

  /* ================= MB SHEET ================= */
  // Standard reference weights (IS 1786 for TMT bars: w = d²/162 kg/m; MS plate: thickness(mm) × 7.85 kg/sqm;
  // MS pipe: approx medium-class values). Grouped for the Factor preset dropdown.
  const FACTOR_PRESET_GROUPS = [
    { group:"General", items:[
      { label:"No factor (1:1)", factor:1, unit:null }
    ]},
    { group:"TMT/Steel Bar — weight (kg per running m)", items:[
      { label:"6mm dia (0.222 kg/m)", factor:0.222, unit:"kg" },
      { label:"8mm dia (0.395 kg/m)", factor:0.395, unit:"kg" },
      { label:"10mm dia (0.617 kg/m)", factor:0.617, unit:"kg" },
      { label:"12mm dia (0.888 kg/m)", factor:0.888, unit:"kg" },
      { label:"16mm dia (1.578 kg/m)", factor:1.578, unit:"kg" },
      { label:"20mm dia (2.466 kg/m)", factor:2.466, unit:"kg" },
      { label:"25mm dia (3.853 kg/m)", factor:3.853, unit:"kg" },
      { label:"32mm dia (6.313 kg/m)", factor:6.313, unit:"kg" }
    ]},
    { group:"MS Plate — weight (kg per sqm)", items:[
      { label:"6mm thick (47.1 kg/sqm)", factor:47.1, unit:"kg" },
      { label:"8mm thick (62.8 kg/sqm)", factor:62.8, unit:"kg" },
      { label:"10mm thick (78.5 kg/sqm)", factor:78.5, unit:"kg" },
      { label:"12mm thick (94.2 kg/sqm)", factor:94.2, unit:"kg" },
      { label:"16mm thick (125.6 kg/sqm)", factor:125.6, unit:"kg" },
      { label:"20mm thick (157.0 kg/sqm)", factor:157.0, unit:"kg" }
    ]},
    { group:"MS Pipe — weight (kg per running m, approx medium class)", items:[
      { label:'15mm / ½" NB (1.22 kg/m)', factor:1.22, unit:"kg" },
      { label:'20mm / ¾" NB (1.62 kg/m)', factor:1.62, unit:"kg" },
      { label:'25mm / 1" NB (2.5 kg/m)', factor:2.5, unit:"kg" },
      { label:'32mm / 1¼" NB (3.2 kg/m)', factor:3.2, unit:"kg" },
      { label:'40mm / 1½" NB (3.8 kg/m)', factor:3.8, unit:"kg" },
      { label:'50mm / 2" NB (4.9 kg/m)', factor:4.9, unit:"kg" }
    ]},
    { group:"Other", items:[
      { label:"Binding wire (kg per m, approx 1.5% of steel wt)", factor:0.015, unit:"kg" }
    ]}
  ];
  const FACTOR_PRESETS = FACTOR_PRESET_GROUPS.flatMap(g=>g.items.map(it=>Object.assign({group:g.group}, it)));
  function factorPresetOptionsHtml(){
    let idx = 0, html = "";
    FACTOR_PRESET_GROUPS.forEach(g=>{
      html += `<optgroup label="${U.escapeHtml(g.group)}">`;
      g.items.forEach(it=>{ html += `<option value="${idx}">${U.escapeHtml(it.label)}</option>`; idx++; });
      html += `</optgroup>`;
    });
    return html;
  }
  function convertQtyToBoqUnit(qty, fromUnit, toUnit){
    const f = (fromUnit||"").trim().toLowerCase(), t = (toUnit||"").trim().toLowerCase();
    if(!f || !t || f===t) return qty;
    const isKg = u => ["kg","kgs","kilogram","kilograms"].includes(u);
    const isMT = u => ["mt","ton","tons","tonne","tonnes","metric ton","metric tons"].includes(u);
    const isGram = u => ["g","gm","gms","gram","grams"].includes(u);
    if(isKg(f) && isMT(t)) return qty/1000;
    if(isGram(f) && isMT(t)) return qty/1000000;
    if(isGram(f) && isKg(t)) return qty/1000;
    if(isMT(f) && isKg(t)) return qty*1000;
    if(isKg(f) && isGram(t)) return qty*1000;
    return qty;
  }
  function renderMB(){
    const sheets = DB.mbSheets.list(m=>m.projectId===project.id);
    const panel = document.getElementById("panelMB");
    panel.innerHTML = `
      <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px">
        <select class="select" id="mbSheetSelect" style="max-width:280px">${sheets.map(s=>`<option value="${s.id}">${U.escapeHtml(s.name)}</option>`).join("")}</select>
        <button class="btn btn-outline btn-sm" id="newMBBtn">+ New MB Sheet</button>
      </div>
      <div id="mbContent"></div>`;
    document.getElementById("newMBBtn").addEventListener("click", ()=>{
      const name = prompt("MB Sheet name:", "MB-"+String(sheets.length+1).padStart(2,"0"));
      if(!name) return;
      const s = DB.mbSheets.create({projectId:project.id, name, createdBy:user.id});
      renderMB(); document.getElementById("mbSheetSelect").value = s.id; renderMBContent(s.id);
    });
    document.getElementById("mbSheetSelect").addEventListener("change", e=> renderMBContent(e.target.value));
    if(sheets.length) renderMBContent(sheets[0].id);
    else document.getElementById("mbContent").innerHTML = `<div class="empty-state"><div class="es-icon">📐</div>No MB Sheets yet. Create one to start measuring.</div>`;
  }
  function renderMBContent(sheetId){
    const rows = DB.mbRows.list(r=>r.mbSheetId===sheetId);
    const boqOptions = projectBoqItems();
    document.getElementById("mbContent").innerHTML = `
      <p class="hint mb-2">💡 Every row measures against a specific BOQ item (official or an approved Extra Item) — pick it from the dropdown, and optionally label it as a sub-item/location (e.g. "Grid A1-A6", "2nd Floor Slab"). Multiple sub-item rows against the same BOQ item sum together automatically into that item's total in the Abstract below. Use a Factor preset for Steel/TMT (by bar diameter)/Pipe/Plate to auto-fill the predefined weight and switch the row to kg — the abstract converts kg → MT automatically when the BOQ item is billed in MT/Tons. You can also paste a copied Excel range (Sub Item, Unit, Nos, Length, Breadth, Height, Factor columns) directly into any cell — extra rows are added automatically.</p>
      ${!boqOptions.length ? `<div class="empty-state mb-3">This project has no BOQ items yet (lump sum contract) — add an Extra Item first, or measure isn't applicable here.</div>` : ""}
      <div class="table-wrap mb-4"><table class="dtable"><thead><tr><th>BOQ Item</th><th>Sub Item / Location</th><th>Row Unit</th><th>Nos</th><th>Length (m)</th><th>Breadth (m)</th><th>Height/Depth (m)</th><th>Factor</th><th>Qty</th><th></th></tr></thead>
      <tbody id="mbTbody">${rows.map(r=>mbRowHtml(r, boqOptions)).join("")}</tbody></table></div>
      <button class="btn btn-outline btn-sm mb-4" id="addMBRowBtn" ${!boqOptions.length?'disabled':''}>+ Add Measurement Row</button>
      <div class="card"><h3>Auto Abstract (in each BOQ item's own unit)</h3><div id="mbAbstract"></div></div>`;
    renderAbstract(sheetId);
    document.getElementById("addMBRowBtn").addEventListener("click", ()=>{
      const first = boqOptions[0];
      DB.mbRows.create({mbSheetId:sheetId, boqItemId:first?first.id:null, subItem:"", unit:first?first.unit:"Cum", nos:1, length:0, breadth:0, height:0, factor:1, qty:0});
      renderMBContent(sheetId);
    });
    const tbody = document.getElementById("mbTbody");
    tbody.addEventListener("input", e=>{
      const tr = e.target.closest("tr"); if(!tr) return;
      const id = tr.dataset.row;
      const field = e.target.dataset.field;
      let val = e.target.value;
      if(["nos","length","breadth","height","factor"].includes(field)) val = +val || 0;
      const patch = {}; patch[field] = val;
      const row = DB.mbRows.get(id);
      const updated = Object.assign({}, row, patch);
      updated.qty = (+updated.nos||0)*(+updated.length||1)*(+updated.breadth||1)*(+updated.height||1)*(+updated.factor||1);
      DB.mbRows.update(id, updated);
      tr.querySelector(".mb-qty").textContent = updated.qty.toFixed(3);
      renderAbstract(sheetId);
    });
    tbody.addEventListener("change", e=>{
      const tr = e.target.closest("tr");
      if(e.target.classList.contains("factor-select")){
        const idx = e.target.value;
        if(idx===""){ return; }
        const preset = FACTOR_PRESETS[+idx];
        const factorInput = tr.querySelector('[data-field="factor"]');
        factorInput.value = preset.factor;
        factorInput.dispatchEvent(new Event("input", {bubbles:true}));
        if(preset.unit){
          const unitInput = tr.querySelector('[data-field="unit"]');
          unitInput.value = preset.unit;
          unitInput.dispatchEvent(new Event("input", {bubbles:true}));
        }
      }
      if(e.target.classList.contains("boq-item-select")){
        const selectedItem = boqOptions.find(it=>it.id===e.target.value);
        const patch = { boqItemId: e.target.value };
        if(selectedItem) patch.unit = selectedItem.unit;
        DB.mbRows.update(tr.dataset.row, patch);
        if(selectedItem){
          const unitInput = tr.querySelector('[data-field="unit"]');
          if(unitInput) unitInput.value = selectedItem.unit;
        }
        renderAbstract(sheetId);
      }
    });
    tbody.addEventListener("click", e=>{
      const btn = e.target.closest("[data-rm-row]"); if(!btn) return;
      DB.mbRows.remove(btn.dataset.rmRow); renderMBContent(sheetId);
    });
    // Excel paste: paste a copied range (Unit, Nos, Length, Breadth, Height, Factor columns)
    // starting from whichever cell you paste into — extra rows are created automatically.
    tbody.addEventListener("paste", e=>{
      const input = e.target.closest("input[data-field]");
      if(!input) return;
      const text = (e.clipboardData||window.clipboardData).getData("text");
      if(!text.includes("\t") && !text.includes("\n")) return;
      e.preventDefault();
      const grid = U.parsePastedTable(text);
      const fields = ["subItem","unit","nos","length","breadth","height","factor"];
      const startFieldIdx = fields.indexOf(input.dataset.field);
      const trs = U.qsa("tr", tbody);
      const startRowIdx = trs.indexOf(input.closest("tr"));
      const dbRows = DB.mbRows.list(rr=>rr.mbSheetId===sheetId);
      const defaultItem = boqOptions[0];
      grid.forEach((rowVals, rOff)=>{
        const rIdx = startRowIdx + rOff;
        let row = dbRows[rIdx];
        if(!row){
          row = DB.mbRows.create({mbSheetId:sheetId, boqItemId:defaultItem?defaultItem.id:null, subItem:"", unit:defaultItem?defaultItem.unit:"Cum", nos:1, length:0, breadth:0, height:0, factor:1, qty:0});
          dbRows.push(row);
        }
        const updated = Object.assign({}, row);
        rowVals.forEach((val, cOff)=>{
          const fIdx = startFieldIdx + cOff;
          if(fIdx<0 || fIdx>=fields.length) return;
          const f = fields[fIdx];
          updated[f] = ["nos","length","breadth","height","factor"].includes(f) ? (+val||0) : val.trim();
        });
        updated.qty = (+updated.nos||0)*(+updated.length||1)*(+updated.breadth||1)*(+updated.height||1)*(+updated.factor||1);
        DB.mbRows.update(row.id, updated);
      });
      renderMBContent(sheetId);
      U.toast(`Pasted into ${grid.length} row(s).`, {type:"success"});
    });
  }
  function mbRowHtml(r, boqOptions){
    return `<tr data-row="${r.id}">
      <td><select class="select boq-item-select" style="min-width:200px">${boqOptions.map(it=>`<option value="${it.id}" ${r.boqItemId===it.id?'selected':''}>${U.escapeHtml(it.description)} (${it.unit})</option>`).join("")}</select></td>
      <td><input class="input" data-field="subItem" value="${SW.Utils.escapeHtml(r.subItem||"")}" style="min-width:140px" placeholder="e.g. Grid A1-A6"></td>
      <td><input class="input" data-field="unit" value="${SW.Utils.escapeHtml(r.unit||"")}" style="width:70px" title="Unit this row's Qty is measured in (auto-set by Factor preset for weight items)"></td>
      <td><input class="input" type="number" data-field="nos" value="${r.nos}" style="width:70px"></td>
      <td><input class="input" type="number" step="0.01" data-field="length" value="${r.length}" style="width:80px"></td>
      <td><input class="input" type="number" step="0.01" data-field="breadth" value="${r.breadth}" style="width:80px"></td>
      <td><input class="input" type="number" step="0.01" data-field="height" value="${r.height}" style="width:80px"></td>
      <td>
        <select class="select factor-select"><option value="">Preset…</option>${factorPresetOptionsHtml()}</select>
        <input class="input mt-1" type="number" step="0.00001" data-field="factor" value="${r.factor}" style="width:90px">
      </td>
      <td class="mb-qty">${(r.qty||0).toFixed(3)}</td>
      <td><button class="btn btn-icon btn-ghost mb-row-remove" data-rm-row="${r.id}">🗑</button></td>
    </tr>`;
  }
  function renderAbstract(sheetId){
    const rows = DB.mbRows.list(r=>r.mbSheetId===sheetId);
    const boqOptions = projectBoqItems();
    const groups = {};
    rows.forEach(r=>{
      const boqItem = boqOptions.find(it=>it.id===r.boqItemId);
      const key = r.boqItemId || "__unlinked";
      const desc = boqItem ? boqItem.description : "(no BOQ item selected)";
      const boqUnit = boqItem ? boqItem.unit : r.unit;
      groups[key] = groups[key] || { desc, unit:boqUnit, qty:0, subItems:[] };
      const convertedQty = convertQtyToBoqUnit(r.qty||0, r.unit, boqUnit);
      groups[key].qty += convertedQty;
      groups[key].subItems.push({ label: r.subItem||"(unlabeled)", qty: convertedQty, rawQty: r.qty||0, rawUnit: r.unit });
    });
    const list = Object.values(groups);
    document.getElementById("mbAbstract").innerHTML = list.length ? `<table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>Total Qty</th><th># Sub-items</th></tr></thead><tbody>${list.map((g,gi)=>`
      <tr class="mb-abstract-row" data-abstract-toggle="${gi}" style="cursor:pointer">
        <td>${U.escapeHtml(g.desc)} <span style="font-size:11px;color:var(--text-muted)">▾ details</span></td><td>${g.unit}</td><td><b>${g.qty.toFixed(3)}</b></td><td>${g.subItems.length}</td>
      </tr>
      <tr class="mb-abstract-detail hidden" data-abstract-detail="${gi}"><td colspan="4">
        <table class="dtable" style="margin:0"><thead><tr><th>Sub Item / Location</th><th>Measured</th><th>Contributes (in ${U.escapeHtml(g.unit)})</th></tr></thead>
        <tbody>${g.subItems.map(s=>`<tr><td>${U.escapeHtml(s.label)}</td><td>${s.rawQty.toFixed(3)} ${U.escapeHtml(s.rawUnit||"")}</td><td>${s.qty.toFixed(3)}</td></tr>`).join("")}</tbody></table>
      </td></tr>`).join("")}</tbody></table>` : `<p class="text-muted">Add measurement rows above to see the abstract.</p>`;
    document.getElementById("mbAbstract").querySelectorAll("[data-abstract-toggle]").forEach(tr=>{
      tr.addEventListener("click", ()=>{
        const detail = document.querySelector(`[data-abstract-detail="${tr.dataset.abstractToggle}"]`);
        if(detail) detail.classList.toggle("hidden");
      });
    });
  }

  /* ================= EXTRA ITEMS ================= */
  function extraStatusBadge(status){
    return { pending:"badge-warning", approved:"badge-success", rejected:"badge-danger" }[status] || "badge-neutral";
  }
  function renderExtraItems(){
    const items = extraItems();
    const panel = document.getElementById("panelExtraItems");
    panel.innerHTML = `
      <div class="flex justify-between mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:520px">Extra Items are work outside the original BOQ scope. Once approved, they automatically flow into the MB Sheet reference, RA Bill claims and Reconciliation alongside the official BOQ.</p>
        ${!isPM ? `<button class="btn btn-primary btn-sm" id="addExtraBtn">+ Raise Extra Item</button>` : ""}
      </div>
      ${items.length ? items.map(it=>`
        <div class="card mb-3">
          <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
            <div><b>${U.escapeHtml(it.description)}</b><div class="text-muted" style="font-size:12px">${it.unit} · Qty ${it.qty} · Rate ${U.fmtINR(it.rate)} · Value ${U.fmtINR((it.qty||0)*(it.rate||0))}</div></div>
            <span class="badge ${extraStatusBadge(it.status)}">${it.status}</span>
          </div>
          <p style="font-size:13px" class="mt-2 mb-2"><b>Justification:</b> ${U.escapeHtml(it.justification||"—")}</p>
          ${it.pmNote ? `<div class="item-remark mb-2">💬 PM: ${U.escapeHtml(it.pmNote)}</div>` : ""}
          ${isPM && it.status==="pending" ? `
            <div class="input-group mb-2">
              <div class="field" style="margin-bottom:0"><label>Approved Rate (₹)</label><input class="input" type="number" value="${it.rate}" data-approve-rate="${it.id}"></div>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-success btn-sm" data-approve-extra="${it.id}">Approve</button>
              <button class="btn btn-danger btn-sm" data-reject-extra="${it.id}">Reject</button>
            </div>` : ""}
        </div>`).join("") : `<div class="empty-state"><div class="es-icon">➕</div>No extra items raised yet.</div>`}`;
    document.getElementById("addExtraBtn")?.addEventListener("click", openExtraItemModal);
    panel.addEventListener("click", e=>{
      const approve = e.target.closest("[data-approve-extra]");
      const reject = e.target.closest("[data-reject-extra]");
      if(approve){
        const rateInput = panel.querySelector(`[data-approve-rate="${approve.dataset.approveExtra}"]`);
        const rate = +rateInput.value || 0;
        DB.boqItems.update(approve.dataset.approveExtra, { status:"approved", rate });
        const item = DB.boqItems.get(approve.dataset.approveExtra);
        DB.notifications.create({ userId:item.requestedBy, title:"Extra item approved", body:`"${item.description}" was approved at ${U.fmtINR(rate)}/${item.unit} and added to billing.`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=extraitems" });
        U.toast("Extra item approved and added to the project BOQ.", {type:"success"});
        renderExtraItems(); renderMB(); renderRABill(); renderReconciliation();
      }
      if(reject){
        const note = prompt("Reason for rejecting this extra item (visible to the contractor):")||"";
        DB.boqItems.update(reject.dataset.rejectExtra, { status:"rejected", pmNote:note });
        const item = DB.boqItems.get(reject.dataset.rejectExtra);
        DB.notifications.create({ userId:item.requestedBy, title:"Extra item rejected", body:`"${item.description}" was not approved.`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=extraitems" });
        U.toast("Extra item rejected.", {type:"warning"});
        renderExtraItems();
      }
    });
  }
  function openExtraItemModal(){
    document.getElementById("genericModalTitle").textContent = "Raise Extra Item";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="field"><label>Description</label><input class="input" id="exDesc" placeholder="e.g. Additional shear wall not in original drawings"></div>
      <div class="input-group">
        <div class="field"><label>Unit</label><input class="input" id="exUnit" value="Cum"></div>
        <div class="field"><label>Estimated Qty</label><input class="input" type="number" id="exQty"></div>
        <div class="field"><label>Proposed Rate (₹)</label><input class="input" type="number" id="exRate"></div>
      </div>
      <div class="field"><label>Justification</label><textarea class="textarea" id="exJustification" placeholder="Why is this extra necessary, and what site/design condition triggered it?"></textarea></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="exSave">Submit for Approval</button>`;
    U.openModal("genericModal");
    document.getElementById("exSave").addEventListener("click", ()=>{
      const description = document.getElementById("exDesc").value.trim();
      const qty = +document.getElementById("exQty").value||0;
      const rate = +document.getElementById("exRate").value||0;
      if(!description || !qty || !rate){ U.toast("Fill in description, quantity and proposed rate.", {type:"danger"}); return; }
      const existing = extraItems();
      const item = DB.boqItems.create({
        projectId:project.id, isExtra:true, srNo: 9000+existing.length+1,
        description, unit: document.getElementById("exUnit").value.trim()||"Nos", qty, rate,
        justification: document.getElementById("exJustification").value.trim(),
        status:"pending", requestedBy:user.id
      });
      DB.notifications.create({ userId:project.pmId, title:"New extra item raised", body:`"${item.description}" needs approval on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=extraitems" });
      U.closeModal("genericModal"); renderExtraItems();
      U.toast("Extra item submitted for approval.", {type:"success"});
    });
  }

  /* ================= RA BILL ================= */
  function renderRABill(){
    const bills = DB.raBills.list(r=>r.projectId===project.id).sort((a,b)=>new Date(b.billDate)-new Date(a.billDate));
    document.getElementById("panelRABill").innerHTML = `
      <div class="flex justify-between mb-3"><h3>RA Bills</h3>${canRaiseSiteActions?'<button class="btn btn-primary btn-sm" id="newRABtn">+ Raise RA Bill</button>':''}</div>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Bill No</th><th>Date</th><th>Previous</th><th>Current Gross</th><th>Retention</th><th>GST</th><th>TDS</th><th>Net Payable</th><th>Status</th><th></th></tr></thead>
      <tbody>${bills.length ? bills.map(b=>{
        const retention = b.currentGrossAmount*b.retentionPct/100;
        const gst = b.currentGrossAmount*b.gstPct/100;
        const tds = b.currentGrossAmount*b.tdsPct/100;
        const net = b.currentGrossAmount - retention - b.advanceRecovery - tds + gst;
        return `<tr><td>${b.billNo}</td><td>${U.fmtDate(b.billDate)}</td><td>${U.fmtINR(b.previousBillAmount)}</td><td>${U.fmtINR(b.currentGrossAmount)}</td><td>${U.fmtINR(retention)}</td><td>${U.fmtINR(gst)}</td><td>${U.fmtINR(tds)}</td><td><b>${U.fmtINR(net)}</b></td>
        <td><span class="badge ${b.status==='approved'?'badge-success':b.status==='rejected'?'badge-danger':'badge-warning'}">${b.status}</span></td>
        <td>${isPM && b.status==='pending' ? `<button class="btn btn-sm btn-success" data-approve-bill="${b.id}">Approve</button> <button class="btn btn-sm btn-danger" data-reject-bill="${b.id}">Reject</button>` : `<button class="btn btn-sm btn-ghost" data-print-bill="${b.id}">Print</button>`} <button class="btn btn-sm btn-ghost" data-view-items="${b.id}">Items</button></td></tr>`;
      }).join("") : `<tr><td colspan="10"><div class="empty-state">No RA Bills raised yet.</div></td></tr>`}</tbody></table></div>`;
    document.getElementById("newRABtn")?.addEventListener("click", openRABillModal);
    document.getElementById("panelRABill").addEventListener("click", e=>{
      const app = e.target.closest("[data-approve-bill]"); const rej = e.target.closest("[data-reject-bill]"); const print = e.target.closest("[data-print-bill]"); const items = e.target.closest("[data-view-items]");
      if(app){ DB.raBills.update(app.dataset.approveBill, {status:"approved"}); U.toast("RA Bill approved.", {type:"success"}); renderRABill(); }
      if(rej){ DB.raBills.update(rej.dataset.rejectBill, {status:"rejected"}); U.toast("RA Bill rejected.", {type:"warning"}); renderRABill(); }
      if(print) printRABill(print.dataset.printBill);
      if(items) viewBillItems(items.dataset.viewItems);
    });
  }

  function viewBillItems(billId){
    const rows = DB.raBillItems.list(i=>i.raBillId===billId);
    document.getElementById("genericModalTitle").textContent = "RA Bill — Item-wise Claim";
    document.getElementById("genericModalBody").innerHTML = rows.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th>Item</th><th>Cumulative Qty</th><th>This Bill Qty</th><th>Rate</th><th>Amount</th></tr></thead>
      <tbody>${rows.map(r=>{ const it = DB.boqItems.get(r.boqItemId); return `<tr><td>${U.escapeHtml(it?it.description:"—")}</td><td>${r.cumulativeQty.toFixed(2)}</td><td>${r.thisBillQty.toFixed(2)}</td><td>${U.fmtINR(r.rate)}</td><td>${U.fmtINR(r.amount)}</td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="empty-state">This bill was raised as a manual gross amount claim (no item-wise breakdown).</div>`;
    document.getElementById("genericModalFoot").innerHTML = "";
    U.openModal("genericModal");
  }

  function openRABillModal(){
    const prevBills = DB.raBills.list(r=>r.projectId===project.id && r.status==="approved").sort((a,b)=>new Date(b.billDate)-new Date(a.billDate));
    const prevAmount = prevBills[0] ? prevBills[0].currentGrossAmount : 0;
    const items = projectBoqItems();
    const canItemWise = items.length>0;
    document.getElementById("genericModalTitle").textContent = "Raise RA Bill";
    document.getElementById("genericModalBody").innerHTML = `
      <p class="hint">Auto-picked previous approved bill amount: <b>${U.fmtINR(prevAmount)}</b></p>
      ${canItemWise ? `
      <p class="hint mb-2">Claim against each BOQ item — enter a % complete (auto-computes cumulative qty) or type the cumulative measured quantity directly. This-bill qty/amount is the difference from the last billed cumulative. You can paste a copied column of % values from Excel directly into the % Complete column below.</p>
      <div class="table-wrap mb-3"><table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>BOQ Qty</th><th>Rate</th><th>Prev. Cum. Qty</th><th>% Complete</th><th>Cum. Qty</th><th>This Bill Amt</th></tr></thead>
      <tbody id="rbItemsBody">${items.map(it=>{
        const rate = itemRate(it); const prevQty = cumulativeBilledQty(it.id);
        const prevPct = it.qty ? (prevQty/it.qty*100) : 0;
        return `<tr data-boq="${it.id}" data-rate="${rate}" data-qty="${it.qty}" data-prev="${prevQty}">
          <td>${U.escapeHtml(it.description)}</td><td>${it.unit}</td><td>${it.qty}</td><td>${U.fmtINR(rate)}</td><td>${prevQty.toFixed(2)}</td>
          <td><input class="input rb-pct" type="number" min="0" max="100" value="${prevPct.toFixed(1)}" style="width:80px"></td>
          <td class="rb-cumqty">${prevQty.toFixed(2)}</td><td class="rb-amt">₹0</td></tr>`;
      }).join("")}</tbody></table></div>
      <p class="mb-3"><b>Total This-Bill Amount: <span id="rbTotalPreview">₹0</span></b></p>` : `
      <div class="field"><label>Current Gross Amount Claimed (₹)</label><input class="input" type="number" id="rbGross"></div>
      <p class="hint">This project has no item-wise BOQ (lump sum contract) — enter the manual claim amount above.</p>`}
      <div class="input-group">
        <div class="field"><label>Retention %</label><input class="input" type="number" id="rbRetention" value="${(DB.tenders.get(project.tenderId)||{}).retentionPct||5}"></div>
        <div class="field"><label>GST %</label><input class="input" type="number" id="rbGst" value="18"></div>
        <div class="field"><label>TDS %</label><input class="input" type="number" id="rbTds" value="2"></div>
      </div>
      <div class="field"><label>Advance Recovery (₹)</label><input class="input" type="number" id="rbAdvance" value="0"></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="rbSave">Submit RA Bill</button>`;
    U.openModal("genericModal");

    if(canItemWise){
      const tbody = document.getElementById("rbItemsBody");
      function recalc(){
        let total = 0;
        U.qsa("tr", tbody).forEach(tr=>{
          const qty = +tr.dataset.qty, rate = +tr.dataset.rate, prev = +tr.dataset.prev;
          let pct = +tr.querySelector(".rb-pct").value||0; pct = Math.max(0, Math.min(100, pct));
          const cumQty = qty * pct/100;
          const thisQty = Math.max(0, cumQty - prev);
          const amt = thisQty * rate;
          tr.querySelector(".rb-cumqty").textContent = cumQty.toFixed(2);
          tr.querySelector(".rb-amt").textContent = U.fmtINR(amt);
          total += amt;
        });
        document.getElementById("rbTotalPreview").textContent = U.fmtINR(total);
      }
      tbody.addEventListener("input", recalc);
      // Excel paste: paste a copied column of % values down the % Complete column.
      tbody.addEventListener("paste", e=>{
        const input = e.target.closest(".rb-pct");
        if(!input) return;
        const text = (e.clipboardData||window.clipboardData).getData("text");
        if(!text.includes("\n") && !text.includes("\t")) return;
        e.preventDefault();
        const values = U.parsePastedTable(text).map(row=>row[0]);
        const trs = U.qsa("tr", tbody);
        const startIdx = trs.indexOf(input.closest("tr"));
        values.forEach((val, i)=>{
          const tr = trs[startIdx+i];
          if(tr) tr.querySelector(".rb-pct").value = (val||"").replace(/[^\d.]/g,"");
        });
        recalc();
        U.toast(`Pasted ${values.length} value(s) into % Complete.`, {type:"success"});
      });
      recalc();
    }

    document.getElementById("rbSave").addEventListener("click", ()=>{
      let gross = 0, lineItems = [];
      if(canItemWise){
        U.qsa("#rbItemsBody tr").forEach(tr=>{
          const qty = +tr.dataset.qty, rate = +tr.dataset.rate, prev = +tr.dataset.prev;
          let pct = +tr.querySelector(".rb-pct").value||0; pct = Math.max(0, Math.min(100, pct));
          const cumQty = qty * pct/100;
          const thisQty = Math.max(0, cumQty - prev);
          const amt = thisQty * rate;
          gross += amt;
          lineItems.push({ boqItemId:tr.dataset.boq, cumulativeQty:cumQty, thisBillQty:thisQty, rate, amount:amt });
        });
        if(!gross){ U.toast("Enter at least one % complete or cumulative quantity greater than the previous bill.", {type:"danger"}); return; }
      } else {
        gross = +document.getElementById("rbGross").value||0;
        if(!gross){ U.toast("Enter the claimed amount.", {type:"danger"}); return; }
      }
      const bills = DB.raBills.list(r=>r.projectId===project.id);
      const bill = DB.raBills.create({ projectId:project.id, billNo:"RA-"+String(bills.length+1).padStart(2,"0"), billDate:DB.nowISO(),
        previousBillAmount:prevAmount, currentGrossAmount:gross, retentionPct:+document.getElementById("rbRetention").value||0,
        advanceRecovery:+document.getElementById("rbAdvance").value||0, gstPct:+document.getElementById("rbGst").value||0, tdsPct:+document.getElementById("rbTds").value||0, status:"pending" });
      lineItems.forEach(li=> DB.raBillItems.create(Object.assign({raBillId:bill.id}, li)));
      DB.notifications.create({ userId:project.pmId, title:"New RA Bill submitted", body:`${bill.billNo} raised for "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=rabill" });
      U.closeModal("genericModal"); renderRABill(); U.toast("RA Bill submitted for approval.", {type:"success"});
    });
  }
  function printRABill(id){
    const b = DB.raBills.get(id);
    const retention = b.currentGrossAmount*b.retentionPct/100, gst=b.currentGrossAmount*b.gstPct/100, tds=b.currentGrossAmount*b.tdsPct/100;
    const net = b.currentGrossAmount - retention - b.advanceRecovery - tds + gst;
    const pm = DB.users.get(project.pmId);
    const pmCompany = pm ? (DB.companies.list(c=>c.ownerId===pm.id)[0]||{}) : {};
    const contractorUser = project.external ? null : DB.users.get(project.contractorId);
    const contractorName = project.external ? (project.externalContractorName||"External Contractor") : (contractorUser?.name||"—");
    const items = projectBoqItems();
    const billItems = DB.raBillItems.list(i=>i.raBillId===b.id);
    const itemRows = billItems.length ? billItems.map(bi=>{
      const it = items.find(x=>x.id===bi.boqItemId) || DB.boqItems.get(bi.boqItemId);
      const boqQty = it ? it.qty : 0;
      const rate = bi.rate;
      const prevCum = bi.cumulativeQty - bi.thisBillQty;
      return `<tr>
        <td>${U.escapeHtml(it?it.description:"—")}</td><td>${it?it.unit:""}</td><td>${boqQty}</td><td>${U.fmtINR(rate)}</td>
        <td>${prevCum.toFixed(2)}</td><td>${bi.thisBillQty.toFixed(2)}</td><td>${bi.cumulativeQty.toFixed(2)}</td><td>${U.fmtINR(bi.amount)}</td>
      </tr>`;
    }).join("") : "";
    const body = `
      <div class="letterhead"><div class="brand">${U.escapeHtml(pmCompany.name||"SubletWorks Client")}</div><div class="meta">${U.escapeHtml(pmCompany.gst||"")}<br>${U.escapeHtml(project.district)}, ${U.escapeHtml(project.state)}</div></div>
      <div class="title">Running Account (RA) Bill</div>
      <p style="font-size:13px"><b>Bill No:</b> ${b.billNo} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(b.billDate)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)} &nbsp;|&nbsp; <b>Contractor:</b> ${U.escapeHtml(contractorName)} &nbsp;|&nbsp; <b>Status:</b> ${b.status}</p>

      ${itemRows ? `<h4>Item-wise Claim (against BOQ &amp; MB Abstract)</h4>
      <table><thead><tr><th>BOQ Item</th><th>Unit</th><th>BOQ Qty</th><th>Rate</th><th>Prev. Cum. Qty</th><th>This Bill Qty</th><th>Cum. Qty</th><th>Amount</th></tr></thead>
      <tbody>${itemRows}</tbody></table>` : `<p style="font-size:13px;color:#555">This bill was raised as a manual gross-amount claim (no item-wise BOQ breakdown available).</p>`}

      <h4>Bill Summary</h4>
      <table class="summary">
      <tr><td style="width:260px">Previous Bill Amount</td><td>${U.fmtINR(b.previousBillAmount)}</td></tr>
      <tr><td>Current Gross Claimed</td><td>${U.fmtINR(b.currentGrossAmount)}</td></tr>
      <tr><td>Retention (${b.retentionPct}%)</td><td>-${U.fmtINR(retention)}</td></tr>
      <tr><td>Advance Recovery</td><td>-${U.fmtINR(b.advanceRecovery)}</td></tr>
      <tr><td>TDS (${b.tdsPct}%)</td><td>-${U.fmtINR(tds)}</td></tr>
      <tr><td>GST (${b.gstPct}%)</td><td>+${U.fmtINR(gst)}</td></tr>
      <tr><td><b>Net Payable</b></td><td><b>${U.fmtINR(net)}</b></td></tr>
      </table>

      <div class="signoff">
        <div>${U.signatureImg(contractorUser)}${U.escapeHtml(contractorName)}<br>Contractor</div>
        <div>${U.signatureImg(pm)}${pm?U.escapeHtml(pm.name):"—"}<br>For ${U.escapeHtml(pmCompany.name||"Client")}</div>
      </div>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>Bill Status: ${b.status}</span></div>`;
    SW.UI.printDocument(b.billNo, body);
  }

  /* ================= PURCHASE ORDERS ================= */
  function poStatusBadge(status){
    const map = { draft:"badge-neutral", sent:"badge-warning", pi_received:"badge-info", confirmed:"badge-accent", received:"badge-success" };
    const label = { draft:"Draft", sent:"Sent to Vendor", pi_received:"PI Received", confirmed:"Confirmed", received:"Goods Received" };
    return `<span class="badge ${map[status]||'badge-neutral'}">${label[status]||status}</span>`;
  }
  function poTotal(po){ return (po.items||[]).reduce((s,i)=> s + (+i.qty||0)*(+i.rate||0), 0); }
  function renderPO(){
    const list = DB.purchaseOrders.list(p=>p.projectId===project.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const panel = document.getElementById("panelPO");
    panel.innerHTML = `
      <div class="flex justify-between mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:520px">Raise a Purchase Order to any material vendor, then record the vendor's Proforma Invoice against it before confirming and receiving goods.</p>
        <button class="btn btn-primary btn-sm" id="newPOBtn">+ New Purchase Order</button>
      </div>
      ${list.length ? list.map((po,pi)=>`<div class="card mb-3 card-enter" style="animation-delay:${pi*40}ms">
        <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
          <div><b>${U.escapeHtml(po.poNo)}</b> — ${U.escapeHtml(po.vendorName)}
            <div class="text-muted" style="font-size:12px">${(po.items||[]).length} item(s) · ${U.fmtINR(poTotal(po))}${po.deliveryDate?` · Delivery by ${U.fmtDate(po.deliveryDate)}`:""}</div>
          </div>
          ${poStatusBadge(po.status)}
        </div>
        ${po.piNumber ? `<p class="text-muted mt-2" style="font-size:12px;margin:6px 0 0">📄 Proforma Invoice: <b>${U.escapeHtml(po.piNumber)}</b>${po.piDate?` dated ${U.fmtDate(po.piDate)}`:""}${po.piValidTill?`, valid till ${U.fmtDate(po.piValidTill)}`:""}</p>` : ""}
        <div class="flex gap-2 mt-3" style="flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" data-print-po="${po.id}">🖨 Print PO</button>
          ${po.status==="draft" ? `<button class="btn btn-sm btn-primary" data-po-send="${po.id}">Mark Sent to Vendor</button>` : ""}
          ${po.status==="sent" ? `<button class="btn btn-sm btn-primary" data-po-pi="${po.id}">+ Record Proforma Invoice</button>` : ""}
          ${po.status==="pi_received" ? `<button class="btn btn-sm btn-primary" data-po-confirm="${po.id}">Confirm Order</button>` : ""}
          ${po.status==="confirmed" ? `<button class="btn btn-sm btn-success" data-po-receive="${po.id}">Mark Goods Received</button>` : ""}
          ${po.piNumber ? `<button class="btn btn-sm btn-outline" data-print-pi="${po.id}">🖨 Print PI</button>` : ""}
        </div>
      </div>`).join("") : `<div class="empty-state"><div class="es-icon">🧾</div>No purchase orders raised yet.</div>`}`;

    document.getElementById("newPOBtn").addEventListener("click", openPOModal);
    panel.querySelectorAll("[data-print-po]").forEach(b=> b.addEventListener("click", ()=> printPO(DB.purchaseOrders.get(b.dataset.printPo))));
    panel.querySelectorAll("[data-print-pi]").forEach(b=> b.addEventListener("click", ()=> printPI(DB.purchaseOrders.get(b.dataset.printPi))));
    panel.querySelectorAll("[data-po-send]").forEach(b=> b.addEventListener("click", ()=>{
      DB.purchaseOrders.update(b.dataset.poSend, { status:"sent" });
      U.toast("Purchase Order marked as sent to vendor.", {type:"success"}); renderPO();
    }));
    panel.querySelectorAll("[data-po-confirm]").forEach(b=> b.addEventListener("click", ()=>{
      DB.purchaseOrders.update(b.dataset.poConfirm, { status:"confirmed" });
      U.toast("Order confirmed.", {type:"success"}); renderPO();
    }));
    panel.querySelectorAll("[data-po-receive]").forEach(b=> b.addEventListener("click", ()=>{
      DB.purchaseOrders.update(b.dataset.poReceive, { status:"received", receivedAt:DB.nowISO() });
      U.toast("Goods marked as received.", {type:"success"}); renderPO();
    }));
    panel.querySelectorAll("[data-po-pi]").forEach(b=> b.addEventListener("click", ()=> openPIModal(b.dataset.poPi)));
  }

  function openPOModal(){
    document.getElementById("genericModalTitle").textContent = "New Purchase Order";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="input-group">
        <div class="field"><label>Vendor Name</label><input class="input" id="poVendorName" placeholder="e.g. Ambuja Cement Dealer"></div>
        <div class="field"><label>Vendor Contact</label><input class="input" id="poVendorContact" placeholder="Phone / email / address"></div>
      </div>
      <div class="field"><label>Delivery Date</label><input class="input" type="date" id="poDeliveryDate"></div>
      <div class="field"><label>Items</label>
        <p class="hint mb-2">💡 Tip: paste rows copied from Excel (Description, Unit, Qty, Rate) directly into the table.</p>
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Description</th><th style="width:90px">Unit</th><th style="width:90px">Qty</th><th style="width:110px">Rate (₹)</th><th style="width:110px">Amount</th><th></th></tr></thead>
        <tbody id="poItemsTbody"></tbody></table></div>
        <button class="btn btn-outline btn-sm mt-2" id="poAddRowBtn">+ Add Row</button>
        <p class="mt-2"><b>Total: <span id="poTotalPreview">₹0</span></b></p>
      </div>
      <div class="field"><label>Payment Terms</label><textarea class="textarea" id="poPaymentTerms" placeholder="e.g. 50% advance, balance on delivery"></textarea></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="poSaveBtn">Save Purchase Order</button>`;
    U.openModal("genericModal");

    const tbody = document.getElementById("poItemsTbody");
    function rowHtml(){ return `<tr><td contenteditable="true" data-field="desc"></td><td contenteditable="true" data-field="unit">Nos</td><td contenteditable="true" data-field="qty">0</td><td contenteditable="true" data-field="rate">0</td><td class="po-amount">₹0</td><td><button class="btn-icon" data-remove-row>✕</button></td></tr>`; }
    function addRow(){ tbody.insertAdjacentHTML("beforeend", rowHtml()); }
    addRow();
    document.getElementById("poAddRowBtn").addEventListener("click", addRow);

    function recalcRow(tr){
      const qty = +tr.querySelector('[data-field="qty"]').textContent.replace(/[^\d.]/g,"")||0;
      const rate = +tr.querySelector('[data-field="rate"]').textContent.replace(/[^\d.]/g,"")||0;
      tr.querySelector(".po-amount").textContent = U.fmtINR(qty*rate);
    }
    function recalcTotal(){
      let total = 0;
      U.qsa("tr", tbody).forEach(tr=>{
        const qty = +tr.querySelector('[data-field="qty"]').textContent.replace(/[^\d.]/g,"")||0;
        const rate = +tr.querySelector('[data-field="rate"]').textContent.replace(/[^\d.]/g,"")||0;
        total += qty*rate;
      });
      document.getElementById("poTotalPreview").textContent = U.fmtINR(total);
    }
    tbody.addEventListener("input", e=>{
      const tr = e.target.closest("tr"); if(!tr) return;
      recalcRow(tr); recalcTotal();
    });
    tbody.addEventListener("click", e=>{
      const rm = e.target.closest("[data-remove-row]"); if(!rm) return;
      rm.closest("tr").remove(); recalcTotal();
    });
    tbody.addEventListener("paste", e=>{
      const td = e.target.closest("td[contenteditable]"); if(!td) return;
      td.blur();
      const text = (e.clipboardData||window.clipboardData).getData("text");
      if(!text.includes("\n") && !text.includes("\t")) return;
      e.preventDefault();
      const rows = U.parsePastedTable(text);
      const startTr = td.closest("tr");
      const startIdx = U.qsa("tr", tbody).indexOf(startTr);
      rows.forEach((cols, i)=>{
        let tr = U.qsa("tr", tbody)[startIdx+i];
        if(!tr){ addRow(); tr = U.qsa("tr", tbody)[startIdx+i]; }
        if(cols[0]!=null) tr.querySelector('[data-field="desc"]').textContent = cols[0];
        if(cols[1]!=null) tr.querySelector('[data-field="unit"]').textContent = cols[1];
        if(cols[2]!=null) tr.querySelector('[data-field="qty"]').textContent = cols[2].replace(/[^\d.]/g,"");
        if(cols[3]!=null) tr.querySelector('[data-field="rate"]').textContent = cols[3].replace(/[^\d.]/g,"");
        recalcRow(tr);
      });
      recalcTotal();
    });

    document.getElementById("poSaveBtn").addEventListener("click", ()=>{
      const vendorName = document.getElementById("poVendorName").value.trim();
      if(!vendorName){ U.toast("Enter the vendor name.", {type:"danger"}); return; }
      const items = U.qsa("tr", tbody).map(tr=>({
        desc: tr.querySelector('[data-field="desc"]').textContent.trim(),
        unit: tr.querySelector('[data-field="unit"]').textContent.trim()||"Nos",
        qty: +tr.querySelector('[data-field="qty"]').textContent.replace(/[^\d.]/g,"")||0,
        rate: +tr.querySelector('[data-field="rate"]').textContent.replace(/[^\d.]/g,"")||0
      })).filter(i=>i.desc);
      if(!items.length){ U.toast("Add at least one item.", {type:"danger"}); return; }
      const existing = DB.purchaseOrders.list(p=>p.projectId===project.id);
      DB.purchaseOrders.create({
        projectId:project.id, poNo:"SW/PO/"+new Date().getFullYear()+"/"+String(existing.length+1).padStart(4,"0"),
        vendorName, vendorContact: document.getElementById("poVendorContact").value.trim(),
        deliveryDate: document.getElementById("poDeliveryDate").value||null,
        paymentTerms: document.getElementById("poPaymentTerms").value.trim(),
        items, status:"draft", raisedBy:user.id
      });
      U.closeModal("genericModal"); renderPO();
      U.toast("Purchase Order created.", {type:"success"});
    });
  }

  function openPIModal(poId){
    const po = DB.purchaseOrders.get(poId);
    document.getElementById("genericModalTitle").textContent = "Record Proforma Invoice";
    document.getElementById("genericModalBody").innerHTML = `
      <p class="hint mb-2">Enter the details from the Proforma Invoice sent by ${U.escapeHtml(po.vendorName)} against ${U.escapeHtml(po.poNo)}.</p>
      <div class="input-group">
        <div class="field"><label>PI Number</label><input class="input" id="piNumber" placeholder="e.g. PI/2026/0451"></div>
        <div class="field"><label>PI Date</label><input class="input" type="date" id="piDate"></div>
      </div>
      <div class="input-group">
        <div class="field"><label>Valid Till</label><input class="input" type="date" id="piValidTill"></div>
        <div class="field"><label>GST / Tax (%)</label><input class="input" type="number" id="piTaxPct" value="18"></div>
      </div>
      <div class="field"><label>Advance Required (%)</label><input class="input" type="number" id="piAdvancePct" placeholder="e.g. 50"></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="piSaveBtn">Save Proforma Invoice</button>`;
    U.openModal("genericModal");
    document.getElementById("piSaveBtn").addEventListener("click", ()=>{
      const piNumber = document.getElementById("piNumber").value.trim();
      if(!piNumber){ U.toast("Enter the PI number.", {type:"danger"}); return; }
      DB.purchaseOrders.update(poId, {
        piNumber, piDate: document.getElementById("piDate").value||null,
        piValidTill: document.getElementById("piValidTill").value||null,
        piTaxPct: +document.getElementById("piTaxPct").value||0,
        piAdvancePct: +document.getElementById("piAdvancePct").value||0,
        status:"pi_received"
      });
      U.closeModal("genericModal"); renderPO();
      U.toast("Proforma Invoice recorded.", {type:"success"});
    });
  }

  function printPO(po){
    const pmUser = DB.users.get(project.pmId);
    const pmCompany = pmUser ? (DB.companies.list(c=>c.ownerId===pmUser.id)[0]||{}) : {};
    const rows = (po.items||[]).map(i=>`<tr><td>${U.escapeHtml(i.desc)}</td><td>${U.escapeHtml(i.unit)}</td><td>${i.qty}</td><td>${U.fmtINR(i.rate)}</td><td>${U.fmtINR(i.qty*i.rate)}</td></tr>`).join("");
    const body = `
      <div class="letterhead"><div class="brand">${U.escapeHtml(pmCompany.name||"SubletWorks Client")}</div><div class="meta">${U.escapeHtml(pmCompany.gst||"")}<br>${U.escapeHtml(project.district)}, ${U.escapeHtml(project.state)}</div></div>
      <div class="title">Purchase Order</div>
      <p style="font-size:13px"><b>PO No:</b> ${U.escapeHtml(po.poNo)} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(po.createdAt)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)}</p>
      <p style="font-size:13px"><b>Vendor:</b> ${U.escapeHtml(po.vendorName)} ${po.vendorContact?`(${U.escapeHtml(po.vendorContact)})`:""}</p>
      ${po.deliveryDate?`<p style="font-size:13px"><b>Delivery Required By:</b> ${U.fmtDate(po.deliveryDate)}</p>`:""}
      <table><thead><tr><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right"><b>Total</b></td><td><b>${U.fmtINR(poTotal(po))}</b></td></tr></tfoot></table>
      ${po.paymentTerms?`<p style="font-size:13px"><b>Payment Terms:</b> ${U.escapeHtml(po.paymentTerms)}</p>`:""}
      <div class="signoff"><div>Vendor Acknowledgement</div><div>${U.signatureImg(pmUser)}${pmUser?U.escapeHtml(pmUser.name):"—"}<br>For ${U.escapeHtml(pmCompany.name||"Client")}</div></div>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>Status: ${po.status}</span></div>`;
    SW.UI.printDocument(`${U.escapeHtml(po.poNo)} — Purchase Order`, body);
  }

  function printPI(po){
    const rows = (po.items||[]).map(i=>`<tr><td>${U.escapeHtml(i.desc)}</td><td>${U.escapeHtml(i.unit)}</td><td>${i.qty}</td><td>${U.fmtINR(i.rate)}</td><td>${U.fmtINR(i.qty*i.rate)}</td></tr>`).join("");
    const subtotal = poTotal(po);
    const tax = subtotal * ((po.piTaxPct||0)/100);
    const grand = subtotal + tax;
    const advance = grand * ((po.piAdvancePct||0)/100);
    const body = `
      <div class="brand">${U.escapeHtml(po.vendorName)}</div>
      <div class="title">Proforma Invoice</div>
      <p style="font-size:13px"><b>PI No:</b> ${U.escapeHtml(po.piNumber)} &nbsp;|&nbsp; <b>Date:</b> ${po.piDate?U.fmtDate(po.piDate):"—"} &nbsp;|&nbsp; <b>Valid Till:</b> ${po.piValidTill?U.fmtDate(po.piValidTill):"—"}</p>
      <p style="font-size:13px"><b>Against PO:</b> ${U.escapeHtml(po.poNo)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)}</p>
      <table><thead><tr><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody>
      <tfoot>
        <tr><td colspan="4" style="text-align:right">Subtotal</td><td>${U.fmtINR(subtotal)}</td></tr>
        <tr><td colspan="4" style="text-align:right">GST / Tax (${po.piTaxPct||0}%)</td><td>${U.fmtINR(tax)}</td></tr>
        <tr><td colspan="4" style="text-align:right"><b>Grand Total</b></td><td><b>${U.fmtINR(grand)}</b></td></tr>
        ${po.piAdvancePct?`<tr><td colspan="4" style="text-align:right">Advance Required (${po.piAdvancePct}%)</td><td>${U.fmtINR(advance)}</td></tr>`:""}
      </tfoot></table>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>Reference: ${U.escapeHtml(po.poNo)}</span></div>`;
    SW.UI.printDocument(`${U.escapeHtml(po.piNumber)} — Proforma Invoice`, body);
  }

  /* ================= VEHICLE LOG ================= */
  const VEHICLE_CHECKS = [
    { key:"tyres", label:"Tyres in good condition" },
    { key:"brakes", label:"Brakes functioning properly" },
    { key:"lights", label:"Lights/indicators working" },
    { key:"documents", label:"RC / Insurance / PUC valid" },
    { key:"license", label:"Driver license valid" },
    { key:"loadSecured", label:"Load properly secured / covered" }
  ];
  function vehicleLogStatus(log){
    const checks = log.checks||{};
    const allPassed = VEHICLE_CHECKS.every(c=> checks[c.key]);
    if(!log.exitTime) return allPassed ? "on-site" : "flagged";
    return allPassed ? "exited" : "flagged";
  }
  function vehicleStatusBadge(status){
    const map = { "on-site":"badge-info", exited:"badge-success", flagged:"badge-danger" };
    const label = { "on-site":"On Site", exited:"Exited", flagged:"⚠ Flagged" };
    return `<span class="badge ${map[status]||'badge-neutral'}">${label[status]||status}</span>`;
  }
  function renderVehicle(){
    const list = DB.vehicleLogs.list(v=>v.projectId===project.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const pos = DB.purchaseOrders.list(p=>p.projectId===project.id);
    const panel = document.getElementById("panelVehicle");
    panel.innerHTML = `
      <div class="flex justify-between mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:520px">Log every transport vehicle entering site — material delivery trucks, equipment carriers, etc. — with a safety checklist before allowing entry.</p>
        <div class="flex gap-2">
          <button class="btn btn-outline btn-sm" id="exportVehicleCsvBtn">⬇ Export CSV</button>
          <button class="btn btn-primary btn-sm" id="newVehicleBtn">+ Log Vehicle Entry</button>
        </div>
      </div>
      ${list.length ? list.map((v,vi)=>{
        const status = vehicleLogStatus(v);
        const failedChecks = VEHICLE_CHECKS.filter(c=> !(v.checks||{})[c.key]);
        return `<div class="card mb-3 card-enter" style="animation-delay:${vi*40}ms">
          <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
            <div><b>${U.escapeHtml(v.vehicleNo)}</b> — ${U.escapeHtml(v.purpose)}
              <div class="text-muted" style="font-size:12px">Driver: ${U.escapeHtml(v.driverName)}${v.driverPhone?` (${U.escapeHtml(v.driverPhone)})`:""} · Entry ${U.fmtDateTime(v.entryTime)}${v.exitTime?` · Exit ${U.fmtDateTime(v.exitTime)}`:""}</div>
              ${v.poId ? `<div class="text-muted" style="font-size:12px">Against PO: ${U.escapeHtml((pos.find(p=>p.id===v.poId)||{}).poNo||"—")}</div>` : ""}
            </div>
            ${vehicleStatusBadge(status)}
          </div>
          ${failedChecks.length ? `<p class="mt-2" style="font-size:12px;color:var(--sw-danger)">⚠ Failed checks: ${failedChecks.map(c=>U.escapeHtml(c.label)).join(", ")}</p>` : ""}
          ${v.notes ? `<p class="text-muted mt-1" style="font-size:12px">📝 ${U.escapeHtml(v.notes)}</p>` : ""}
          <div class="flex gap-2 mt-3">
            <button class="btn btn-sm btn-outline" data-print-vehicle="${v.id}">🖨 Print Gate Pass</button>
            ${!v.exitTime ? `<button class="btn btn-sm btn-primary" data-vehicle-exit="${v.id}">Mark Exit</button>` : ""}
          </div>
        </div>`;
      }).join("") : `<div class="empty-state"><div class="es-icon">🚚</div>No vehicle entries logged yet.</div>`}`;

    document.getElementById("newVehicleBtn").addEventListener("click", ()=> openVehicleModal(pos));
    document.getElementById("exportVehicleCsvBtn").addEventListener("click", ()=>{
      U.exportCSV(`vehicle-log-${project.name}`,
        ["Vehicle No","Purpose","Driver","Driver Phone","Entry Time","Exit Time","Status","Failed Checks","Notes"],
        list.map(v=>{
          const failed = VEHICLE_CHECKS.filter(c=> !(v.checks||{})[c.key]).map(c=>c.label).join("; ");
          return [v.vehicleNo, v.purpose, v.driverName, v.driverPhone||"", U.fmtDateTime(v.entryTime), v.exitTime?U.fmtDateTime(v.exitTime):"", vehicleLogStatus(v), failed, v.notes||""];
        }));
    });
    panel.querySelectorAll("[data-print-vehicle]").forEach(b=> b.addEventListener("click", ()=> printVehiclePass(DB.vehicleLogs.get(b.dataset.printVehicle))));
    panel.querySelectorAll("[data-vehicle-exit]").forEach(b=> b.addEventListener("click", ()=>{
      DB.vehicleLogs.update(b.dataset.vehicleExit, { exitTime: DB.nowISO() });
      U.toast("Vehicle exit recorded.", {type:"success"}); renderVehicle();
    }));
  }

  function openVehicleModal(pos){
    document.getElementById("genericModalTitle").textContent = "Log Vehicle Entry";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="input-group">
        <div class="field"><label>Vehicle Number</label><input class="input" id="vNo" placeholder="e.g. HR26 AB 1234"></div>
        <div class="field"><label>Purpose</label>
          <select class="select" id="vPurpose"><option>Material Delivery</option><option>Equipment</option><option>Waste Removal</option><option>Other</option></select>
        </div>
      </div>
      <div class="input-group">
        <div class="field"><label>Driver Name</label><input class="input" id="vDriverName"></div>
        <div class="field"><label>Driver Phone</label><input class="input" id="vDriverPhone"></div>
      </div>
      ${pos.length ? `<div class="field"><label>Against Purchase Order (optional)</label><select class="select" id="vPO"><option value="">— None —</option>${pos.map(p=>`<option value="${p.id}">${U.escapeHtml(p.poNo)} — ${U.escapeHtml(p.vendorName)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Safety Checklist</label>
        ${VEHICLE_CHECKS.map(c=>`<label class="checkbox-row"><input type="checkbox" class="vCheck" data-check="${c.key}" checked> ${U.escapeHtml(c.label)}</label>`).join("")}
      </div>
      <div class="field"><label>Notes (optional)</label><textarea class="textarea" id="vNotes" placeholder="e.g. Minor tyre wear noted, cleared for entry"></textarea></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="vSaveBtn">Log Entry</button>`;
    U.openModal("genericModal");
    document.getElementById("vSaveBtn").addEventListener("click", ()=>{
      const vehicleNo = document.getElementById("vNo").value.trim();
      const driverName = document.getElementById("vDriverName").value.trim();
      if(!vehicleNo || !driverName){ U.toast("Enter the vehicle number and driver name.", {type:"danger"}); return; }
      const checks = {};
      document.querySelectorAll(".vCheck").forEach(c=> checks[c.dataset.check] = c.checked);
      DB.vehicleLogs.create({
        projectId:project.id, vehicleNo, purpose:document.getElementById("vPurpose").value,
        driverName, driverPhone:document.getElementById("vDriverPhone").value.trim(),
        poId: document.getElementById("vPO") ? (document.getElementById("vPO").value||null) : null,
        checks, notes:document.getElementById("vNotes").value.trim(),
        entryTime:DB.nowISO(), exitTime:null, loggedBy:user.id
      });
      U.closeModal("genericModal"); renderVehicle();
      U.toast("Vehicle entry logged.", {type:"success"});
    });
  }

  function printVehiclePass(v){
    const checksHtml = VEHICLE_CHECKS.map(c=>`<tr><td>${U.escapeHtml(c.label)}</td><td>${(v.checks||{})[c.key] ? "✅ Passed" : "❌ Failed"}</td></tr>`).join("");
    const body = `
      <div class="brand">SubletWorks.com</div>
      <div class="title">Vehicle Gate Pass</div>
      <p style="font-size:13px"><b>Vehicle No:</b> ${U.escapeHtml(v.vehicleNo)} &nbsp;|&nbsp; <b>Purpose:</b> ${U.escapeHtml(v.purpose)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)}</p>
      <p style="font-size:13px"><b>Driver:</b> ${U.escapeHtml(v.driverName)} ${v.driverPhone?`(${U.escapeHtml(v.driverPhone)})`:""}</p>
      <p style="font-size:13px"><b>Entry Time:</b> ${U.fmtDateTime(v.entryTime)} &nbsp;|&nbsp; <b>Exit Time:</b> ${v.exitTime?U.fmtDateTime(v.exitTime):"— (still on site)"}</p>
      <table><thead><tr><th>Safety Check</th><th>Result</th></tr></thead><tbody>${checksHtml}</tbody></table>
      ${v.notes?`<p style="font-size:13px"><b>Notes:</b> ${U.escapeHtml(v.notes)}</p>`:""}
      <div class="footer"><span>Generated via SubletWorks.com</span><span>Overall: ${vehicleLogStatus(v)==='flagged' ? '⚠ Flagged' : 'Cleared'}</span></div>`;
    SW.UI.printDocument(`Gate Pass — ${U.escapeHtml(v.vehicleNo)}`, body);
  }

  /* ================= MATERIAL INWARD (GRN) ================= */
  function grnHasVariance(grn){
    return (grn.items||[]).some(i => (+i.receivedQty||0) < (+i.orderedQty||0) || (+i.damagedQty||0) > 0);
  }
  function renderGRN(){
    const list = DB.materialInwards.list(g=>g.projectId===project.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const pos = DB.purchaseOrders.list(p=>p.projectId===project.id);
    const vehicles = DB.vehicleLogs.list(v=>v.projectId===project.id);
    const panel = document.getElementById("panelGRN");
    panel.innerHTML = `
      <div class="flex justify-between mb-3" style="flex-wrap:wrap;gap:10px">
        <p class="text-muted" style="margin:0;max-width:520px">Record what actually arrived against a Purchase Order — quantity, damage or shortfall vs. what was ordered — before goods are accepted into store.</p>
        <button class="btn btn-primary btn-sm" id="newGRNBtn" ${!pos.length?'disabled title="Raise a Purchase Order first"':''}>+ Record Goods Received</button>
      </div>
      ${list.length ? list.map((g,gi)=>{
        const po = pos.find(p=>p.id===g.poId);
        const variance = grnHasVariance(g);
        return `<div class="card mb-3 card-enter" style="animation-delay:${gi*40}ms">
          <div class="flex justify-between items-start" style="flex-wrap:wrap;gap:10px">
            <div><b>${U.escapeHtml(g.grnNo)}</b> ${po?`— against ${U.escapeHtml(po.poNo)} (${U.escapeHtml(po.vendorName)})`:""}
              <div class="text-muted" style="font-size:12px">${(g.items||[]).length} item(s) · Received ${U.fmtDateTime(g.createdAt)}</div>
            </div>
            <span class="badge ${variance?'badge-warning':'badge-success'}">${variance?'⚠ Variance':'Matches PO'}</span>
          </div>
          <div class="table-wrap mt-2"><table class="dtable"><thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Damaged/Short</th></tr></thead>
          <tbody>${(g.items||[]).map(i=>`<tr><td>${U.escapeHtml(i.desc)}</td><td>${i.orderedQty} ${U.escapeHtml(i.unit)}</td><td>${i.receivedQty} ${U.escapeHtml(i.unit)}</td><td>${i.damagedQty>0?`<span style="color:var(--sw-danger)">${i.damagedQty} ${U.escapeHtml(i.unit)}</span>`:"—"}</td></tr>`).join("")}</tbody></table></div>
          ${g.notes?`<p class="text-muted mt-2" style="font-size:12px">📝 ${U.escapeHtml(g.notes)}</p>`:""}
          <div class="flex gap-2 mt-3"><button class="btn btn-sm btn-outline" data-print-grn="${g.id}">🖨 Print GRN</button></div>
        </div>`;
      }).join("") : `<div class="empty-state"><div class="es-icon">📦</div>No material inward entries yet.</div>`}`;

    document.getElementById("newGRNBtn").addEventListener("click", ()=> openGRNModal(pos, vehicles));
    panel.querySelectorAll("[data-print-grn]").forEach(b=> b.addEventListener("click", ()=> printGRN(DB.materialInwards.get(b.dataset.printGrn), pos.find(p=>p.id===DB.materialInwards.get(b.dataset.printGrn).poId))));
  }

  function openGRNModal(pos, vehicles){
    document.getElementById("genericModalTitle").textContent = "Record Goods Received";
    document.getElementById("genericModalBody").innerHTML = `
      <div class="field"><label>Against Purchase Order</label><select class="select" id="grnPO">${pos.map(p=>`<option value="${p.id}">${U.escapeHtml(p.poNo)} — ${U.escapeHtml(p.vendorName)}</option>`).join("")}</select></div>
      ${vehicles.length ? `<div class="field"><label>Delivery Vehicle (optional)</label><select class="select" id="grnVehicle"><option value="">— None —</option>${vehicles.map(v=>`<option value="${v.id}">${U.escapeHtml(v.vehicleNo)} — ${U.escapeHtml(v.driverName)}</option>`).join("")}</select></div>` : ""}
      <div class="field"><label>Items Received</label>
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Item</th><th style="width:110px">Ordered</th><th style="width:110px">Received</th><th style="width:110px">Damaged/Short</th></tr></thead>
        <tbody id="grnItemsTbody"></tbody></table></div>
      </div>
      <div class="field"><label>Notes (optional)</label><textarea class="textarea" id="grnNotes" placeholder="e.g. 2 bags torn on arrival, credit note requested from vendor"></textarea></div>`;
    document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="grnSaveBtn">Save Goods Received Note</button>`;
    U.openModal("genericModal");

    function populateItems(poId){
      const po = pos.find(p=>p.id===poId);
      const tbody = document.getElementById("grnItemsTbody");
      tbody.innerHTML = (po?.items||[]).map(i=>`<tr data-desc="${U.escapeHtml(i.desc)}" data-unit="${U.escapeHtml(i.unit)}" data-ordered="${i.qty}">
        <td>${U.escapeHtml(i.desc)}</td><td>${i.qty} ${U.escapeHtml(i.unit)}</td>
        <td><input class="input" type="number" data-field="receivedQty" value="${i.qty}"></td>
        <td><input class="input" type="number" data-field="damagedQty" value="0"></td>
      </tr>`).join("");
    }
    document.getElementById("grnPO").addEventListener("change", e=> populateItems(e.target.value));
    populateItems(pos[0]?.id);

    document.getElementById("grnSaveBtn").addEventListener("click", ()=>{
      const poId = document.getElementById("grnPO").value;
      const items = U.qsa("#grnItemsTbody tr").map(tr=>({
        desc: tr.dataset.desc, unit: tr.dataset.unit, orderedQty: +tr.dataset.ordered,
        receivedQty: +tr.querySelector('[data-field="receivedQty"]').value||0,
        damagedQty: +tr.querySelector('[data-field="damagedQty"]').value||0
      }));
      const existing = DB.materialInwards.list(g=>g.projectId===project.id);
      DB.materialInwards.create({
        projectId:project.id, grnNo:"SW/GRN/"+new Date().getFullYear()+"/"+String(existing.length+1).padStart(4,"0"),
        poId, vehicleLogId: document.getElementById("grnVehicle") ? (document.getElementById("grnVehicle").value||null) : null,
        items, notes: document.getElementById("grnNotes").value.trim(), receivedBy:user.id
      });
      U.closeModal("genericModal"); renderGRN();
      U.toast("Goods Received Note saved.", {type:"success"});
    });
  }

  function printGRN(g, po){
    const rows = (g.items||[]).map(i=>`<tr><td>${U.escapeHtml(i.desc)}</td><td>${U.escapeHtml(i.unit)}</td><td>${i.orderedQty}</td><td>${i.receivedQty}</td><td>${i.damagedQty>0?i.damagedQty:"—"}</td></tr>`).join("");
    const body = `
      <div class="brand">SubletWorks.com</div>
      <div class="title">Goods Received Note</div>
      <p style="font-size:13px"><b>GRN No:</b> ${U.escapeHtml(g.grnNo)} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(g.createdAt)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)}</p>
      ${po?`<p style="font-size:13px"><b>Against PO:</b> ${U.escapeHtml(po.poNo)} &nbsp;|&nbsp; <b>Vendor:</b> ${U.escapeHtml(po.vendorName)}</p>`:""}
      <table><thead><tr><th>Description</th><th>Unit</th><th>Ordered</th><th>Received</th><th>Damaged/Short</th></tr></thead><tbody>${rows}</tbody></table>
      ${g.notes?`<p style="font-size:13px"><b>Notes:</b> ${U.escapeHtml(g.notes)}</p>`:""}
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${grnHasVariance(g)?'⚠ Variance from PO':'Matches PO'}</span></div>`;
    SW.UI.printDocument(`${U.escapeHtml(g.grnNo)} — Goods Received Note`, body);
  }

  /* ================= RECONCILIATION ================= */
  function renderReconciliation(){
    const items = projectBoqItems();
    const panel = document.getElementById("panelReconciliation");
    if(!items.length){
      panel.innerHTML = `<div class="empty-state"><div class="es-icon">🧮</div>This project has no item-wise BOQ (lump sum contract) — reconciliation applies only to item-wise BOQs.</div>`;
      return;
    }
    let overBilledCount = 0;
    const rows = items.map(it=>{
      const rate = itemRate(it);
      const boqValue = it.qty*rate;
      const measured = mbMeasuredQty(it);
      const billed = cumulativeBilledQty(it.id);
      const pctBilled = it.qty ? (billed/it.qty*100) : 0;
      const variance = measured - billed;
      const overBilled = billed > measured + 0.001;
      if(overBilled) overBilledCount++;
      return `<tr>
        <td>${U.escapeHtml(it.description)}</td><td>${it.unit}</td><td>${it.qty}</td><td>${U.fmtINR(rate)}</td><td>${U.fmtINR(boqValue)}</td>
        <td>${measured.toFixed(2)}</td><td>${billed.toFixed(2)}</td><td>${pctBilled.toFixed(1)}%</td>
        <td>${overBilled ? `<span class="badge badge-danger" title="Billed quantity exceeds MB-measured quantity">⚠ ${variance.toFixed(2)}</span>` : `<span class="badge badge-success">${variance.toFixed(2)}</span>`}</td>
      </tr>`;
    }).join("");
    panel.innerHTML = `
      ${overBilledCount ? `<div class="card mb-4" style="border-left:4px solid var(--sw-danger)"><b>⚠ ${overBilledCount} item(s) billed beyond measured quantity.</b><p class="text-muted" style="margin:4px 0 0">Review the MB Sheet measurements before approving the related RA Bill(s).</p></div>` : `<div class="card mb-4" style="border-left:4px solid var(--sw-success)"><b>✓ All billed quantities are within measured (MB Sheet) quantities.</b></div>`}
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>BOQ Qty</th><th>Rate</th><th>BOQ Value</th><th>MB Measured Qty</th><th>Cum. Billed Qty</th><th>% Billed</th><th>Variance (Measured − Billed)</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  /* ================= DPR ================= */
  function renderDPR(){
    const dprs = DB.dprs.list(d=>d.projectId===project.id).sort((a,b)=> new Date(b.date)-new Date(a.date));
    document.getElementById("panelDPR").innerHTML = `
      <div class="flex justify-between mb-3"><h3>Daily Progress Reports</h3>${canRaiseSiteActions?'<button class="btn btn-primary btn-sm" id="newDPRBtn">+ Log Today\'s DPR</button>':''}</div>
      ${dprs.length ? dprs.map(d=>`<div class="dpr-card"><div class="flex justify-between mb-2"><b>${U.fmtDate(d.date)}</b><span class="badge badge-info">${d.weather}</span></div>
        <p style="font-size:13px"><b>Labour:</b> ${d.labourCount} · <b>Equipment:</b> ${U.escapeHtml(d.equipment||'—')}</p>
        <p style="font-size:13px"><b>Work Done:</b> ${U.escapeHtml(d.workDone)}</p>
        ${d.delay?`<p style="font-size:13px;color:var(--sw-warning)"><b>Delay:</b> ${U.escapeHtml(d.delay)}</p>`:""}
      </div>`).join("") : `<div class="empty-state"><div class="es-icon">📝</div>No DPRs logged yet.</div>`}`;
    document.getElementById("newDPRBtn")?.addEventListener("click", ()=>{
      document.getElementById("genericModalTitle").textContent = "Log Daily Progress Report";
      document.getElementById("genericModalBody").innerHTML = `
        <div class="input-group"><div class="field"><label>Date</label><input class="input" type="date" id="dprDate" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="field"><label>Weather</label><select class="select" id="dprWeather"><option>Clear</option><option>Cloudy</option><option>Light Rain</option><option>Heavy Rain</option><option>Extreme Heat</option></select></div></div>
        <div class="input-group"><div class="field"><label>Labour Count</label><input class="input" type="number" id="dprLabour"></div><div class="field"><label>Equipment on Site</label><input class="input" id="dprEquip" placeholder="e.g. 1 JCB, 1 Mixer"></div></div>
        <div class="field"><label>Work Done Today</label><textarea class="textarea" id="dprWork"></textarea></div>
        <div class="field"><label>Delay / Remarks (if any)</label><input class="input" id="dprDelay"></div>
        <div class="field"><label>Site Photo</label><div class="dropzone" style="padding:20px"><p style="margin:0">📷 Photo upload placeholder (stored as filename reference only in this build)</p></div></div>`;
      document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="dprSave">Save DPR</button>`;
      U.openModal("genericModal");
      document.getElementById("dprSave").addEventListener("click", ()=>{
        DB.dprs.create({ projectId:project.id, date:document.getElementById("dprDate").value, weather:document.getElementById("dprWeather").value,
          labourCount:+document.getElementById("dprLabour").value||0, equipment:document.getElementById("dprEquip").value.trim(),
          workDone:document.getElementById("dprWork").value.trim(), delay:document.getElementById("dprDelay").value.trim(), createdBy:user.id });
        U.closeModal("genericModal"); renderDPR(); U.toast("DPR logged.", {type:"success"});
      });
    });
  }

  /* ================= ATTENDANCE & WAGES ================= */
  // Each party (PM or contractor) tracks attendance only for their OWN team members
  // who have been allotted to this project from Profile & Settings.
  let attSelectedDate = new Date().toISOString().slice(0,10);
  const ATT_STATUS = [
    { v:"present", label:"Present", factor:1 },
    { v:"half", label:"Half Day", factor:0.5 },
    { v:"overtime", label:"Present + OT", factor:1.5 },
    { v:"absent", label:"Absent", factor:0 }
  ];
  function attFactor(v){ const s=ATT_STATUS.find(x=>x.v===v); return s?s.factor:0; }
  function attMembers(){
    return DB.teamMembers.list(t=>t.ownerId===user.id && (t.projectIds||[]).includes(project.id))
      .sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  }
  function renderAttendance(){
    const panel = document.getElementById("panelAttendance");
    const members = attMembers();
    if(!members.length){
      panel.innerHTML = `<h3>Attendance &amp; Wages</h3>
        <div class="empty-state"><div class="es-icon">🧑‍🏭</div>No team members are allotted to this project yet.
        <br><a class="btn btn-outline btn-sm mt-3" href="../profile-settings/index.html">Manage team &amp; allot to projects</a></div>
        <p class="text-muted" style="font-size:12.5px;max-width:560px;margin:12px auto 0;text-align:center">Add team members in Profile &amp; Settings and tick this project under "Allot to Projects", then mark daily attendance here — wages are auto-calculated from each member's daily rate.</p>`;
      return;
    }
    const records = DB.teamAttendance.list(a=>a.ownerId===user.id && a.projectId===project.id);
    const forDate = {};
    records.filter(r=>r.date===attSelectedDate).forEach(r=> forDate[r.memberId]=r);
    const marking = members.map(m=>{
      const cur = forDate[m.id] ? forDate[m.id].status : "present";
      return `<tr><td>${U.escapeHtml(m.name)}</td><td class="text-muted">${U.escapeHtml(m.designation||m.skill||"—")}</td>
        <td>${m.dailyRate?U.fmtINR(m.dailyRate):'<span class="text-muted">no rate set</span>'}</td>
        <td><select class="select att-status" data-member="${m.id}" style="min-width:150px">${ATT_STATUS.map(s=>`<option value="${s.v}" ${s.v===cur?"selected":""}>${s.label}</option>`).join("")}</select></td></tr>`;
    }).join("");
    const summary = members.map(m=>{
      const recs = records.filter(r=>r.memberId===m.id);
      const present = recs.filter(r=>r.status==="present").length;
      const half = recs.filter(r=>r.status==="half").length;
      const ot = recs.filter(r=>r.status==="overtime").length;
      const absent = recs.filter(r=>r.status==="absent").length;
      const manDays = recs.reduce((s,r)=>s+attFactor(r.status),0);
      const wage = manDays * (m.dailyRate||0);
      return { m, present, half, ot, absent, manDays, wage };
    });
    const totalWage = summary.reduce((s,x)=>s+x.wage,0);
    const totalManDays = summary.reduce((s,x)=>s+x.manDays,0);
    panel.innerHTML = `
      <div class="flex justify-between items-center mb-3" style="flex-wrap:wrap;gap:10px"><h3 style="margin:0">Attendance &amp; Wages</h3>
        <div class="flex gap-2"><button class="btn btn-outline btn-sm" id="attCsvBtn">⬇ Export CSV</button><button class="btn btn-outline btn-sm" id="attPrintBtn">🖨 Print Muster</button></div></div>
      <div class="card mb-4">
        <div class="flex items-end gap-3 mb-3" style="flex-wrap:wrap">
          <div class="field" style="margin:0"><label>Attendance Date</label><input class="input" type="date" id="attDate" value="${attSelectedDate}" style="max-width:190px"></div>
          <button class="btn btn-primary btn-sm" id="attSaveBtn">Save Attendance for this Date</button>
        </div>
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Role</th><th>Rate/day</th><th>Status</th></tr></thead><tbody>${marking}</tbody></table></div>
      </div>
      <h4 class="mb-2">Wage Summary <span class="text-muted" style="font-weight:400;font-size:13px">(across all recorded dates)</span></h4>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Present</th><th>Half</th><th>OT</th><th>Absent</th><th>Man-days</th><th>Rate/day</th><th>Wage Payable</th></tr></thead>
        <tbody>${summary.map(x=>`<tr><td>${U.escapeHtml(x.m.name)}</td><td>${x.present}</td><td>${x.half}</td><td>${x.ot}</td><td>${x.absent}</td><td>${x.manDays}</td><td>${x.m.dailyRate?U.fmtINR(x.m.dailyRate):"—"}</td><td><b>${U.fmtINR(x.wage)}</b></td></tr>`).join("")}
        <tr style="font-weight:700;background:var(--surface-2)"><td colspan="5">Total</td><td>${totalManDays}</td><td></td><td>${U.fmtINR(totalWage)}</td></tr></tbody></table></div>
      <p class="text-muted mt-2" style="font-size:12px">Man-days: Present = 1 · Half Day = 0.5 · Present + OT = 1.5 · Absent = 0. Wage = man-days × daily rate.</p>`;

    document.getElementById("attDate").addEventListener("change", e=>{ attSelectedDate = e.target.value; renderAttendance(); });
    document.getElementById("attSaveBtn").addEventListener("click", ()=>{
      U.qsa("#panelAttendance .att-status").forEach(sel=>{
        const memberId = sel.dataset.member, status = sel.value;
        const existing = DB.teamAttendance.list(a=>a.ownerId===user.id && a.projectId===project.id && a.memberId===memberId && a.date===attSelectedDate)[0];
        if(existing) DB.teamAttendance.update(existing.id, {status});
        else DB.teamAttendance.create({ ownerId:user.id, projectId:project.id, memberId, date:attSelectedDate, status });
      });
      renderAttendance();
      U.toast("Attendance saved for "+U.fmtDate(attSelectedDate)+".", {type:"success"});
    });
    document.getElementById("attCsvBtn").addEventListener("click", ()=>{
      U.exportCSV(`attendance-${project.name}`,
        ["Name","Role","Present","Half","OT","Absent","Man-days","Rate/day","Wage Payable"],
        summary.map(x=>[x.m.name, x.m.designation||x.m.skill||"", x.present, x.half, x.ot, x.absent, x.manDays, x.m.dailyRate||0, x.wage]));
    });
    document.getElementById("attPrintBtn").addEventListener("click", ()=> printMuster(summary, totalManDays, totalWage));
  }
  function printMuster(summary, totalManDays, totalWage){
    const rows = summary.map(x=>`<tr><td>${U.escapeHtml(x.m.name)}</td><td>${U.escapeHtml(x.m.designation||x.m.skill||"—")}</td><td>${x.present}</td><td>${x.half}</td><td>${x.ot}</td><td>${x.absent}</td><td>${x.manDays}</td><td>${U.fmtINR(x.m.dailyRate||0)}</td><td>${U.fmtINR(x.wage)}</td></tr>`).join("");
    const body = `
      <div class="title">Muster Roll &amp; Wage Sheet</div>
      <p style="font-size:13px"><b>Project:</b> ${U.escapeHtml(project.name)} &nbsp;|&nbsp; <b>Location:</b> ${U.escapeHtml(project.district||"")}, ${U.escapeHtml(project.state||"")}</p>
      <table><thead><tr><th>Name</th><th>Role</th><th>Present</th><th>Half</th><th>OT</th><th>Absent</th><th>Man-days</th><th>Rate/day</th><th>Wage Payable</th></tr></thead>
      <tbody>${rows}<tr style="font-weight:700"><td colspan="6">Total</td><td>${totalManDays}</td><td></td><td>${U.fmtINR(totalWage)}</td></tr></tbody></table>
      <div class="signoff"><div>Prepared By</div><div>Verified By</div></div>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
    SW.UI.printDocument(`Muster Roll — ${U.escapeHtml(project.name)}`, body, {landscape:true});
  }

  /* ================= HINDRANCE ================= */
  function hindranceLibrary(){ return DB.hindranceLibrary.list().sort((a,b)=>(a.category||"").localeCompare(b.category)||(a.title||"").localeCompare(b.title)); }
  function computeEOT(hindrances){
    const ranges = hindrances.filter(h=>h.delayFrom && h.delayTo).map(h=>({from:new Date(h.delayFrom), to:new Date(h.delayTo), items:[h]})).sort((a,b)=>a.from-b.from);
    const merged = [];
    ranges.forEach(r=>{
      const last = merged[merged.length-1];
      if(last && r.from <= new Date(last.to.getTime()+86400000)){
        if(r.to > last.to) last.to = r.to;
        last.items.push(r.items[0]);
      } else merged.push({from:r.from, to:r.to, items:r.items.slice()});
    });
    const totalDays = merged.reduce((s,m)=> s + (U.daysBetween(m.from,m.to)+1), 0);
    return { totalDays, merged };
  }
  function eotStatusBadge(status){
    const map = { draft:"badge-neutral", submitted:"badge-warning", approved:"badge-success", rejected:"badge-danger", returned:"badge-info" };
    return `<span class="badge ${map[status]||"badge-neutral"} status-badge">${status}</span>`;
  }
  function eotStepper(status){
    const steps = ["draft","submitted", status==="rejected"?"rejected":status==="returned"?"returned":"approved"];
    const labels = { draft:"Draft", submitted:"Submitted", approved:"Approved", rejected:"Rejected", returned:"Returned" };
    const order = ["draft","submitted","approved"];
    const curIdx = status==="rejected"||status==="returned" ? 1 : order.indexOf(status);
    return `<div class="eot-stepper">${steps.map((s,i)=>{
      const done = status==="rejected"||status==="returned" ? i<2 : i<=curIdx;
      const isCurrent = s===status || (i===steps.length-1 && (status==="rejected"||status==="returned"));
      const cls = (status==="rejected"&&s==="rejected") ? "step-rejected" : (status==="returned"&&s==="returned") ? "step-returned" : done ? "step-done" : "step-pending";
      return `<span class="eot-step ${cls}" title="${labels[s]}"></span>`;
    }).join("")}</div>`;
  }
  function renderHindrance(){
    const list = DB.hindrances.list(h=>h.projectId===project.id).sort((a,b)=>new Date(b.raisedAt)-new Date(a.raisedAt));
    const qualifying = list.filter(h=> h.delayFrom && h.delayTo);
    const eot = computeEOT(qualifying);
    const eotRequests = DB.eotRequests.list(r=>r.projectId===project.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const panel = document.getElementById("panelHindrance");
    panel.innerHTML = `
      <div class="flex justify-between mb-3"><h3>Hindrance Register</h3>
        <div class="flex gap-2">
          <button class="btn btn-outline btn-sm" id="exportHindCsvBtn">⬇ Export CSV</button>
          <button class="btn btn-outline btn-sm" id="printHindRegisterBtn">🖨 Print Register</button>
          ${canRaiseSiteActions?'<button class="btn btn-primary btn-sm" id="newHindBtn">+ Raise Hindrance</button>':''}
        </div>
      </div>
      <div class="card mb-4" style="border-left:4px solid var(--sw-accent)">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px">
          <div><b>⏱ EOT (Extension of Time) Overlap Calculator</b><p class="text-muted mt-1" style="margin:4px 0 0;font-size:12px">Live preview across all hindrances with a delay period set — overlapping dates are merged so days are never double-counted. Raise a formal EOT Request to submit this for approval.</p></div>
          <div class="flex gap-3 items-center">
            <div style="text-align:center"><div style="font-size:22px;font-weight:800">${eot.totalDays}</div><div class="text-muted" style="font-size:11px">day(s) potential EOT</div></div>
            <button class="btn btn-primary btn-sm" id="newEotReqBtn" ${!qualifying.length?'disabled title="Raise a hindrance with a delay period first"':''}>+ New EOT Request</button>
          </div>
        </div>
      </div>
      <div class="card mb-4">
        <div class="flex justify-between items-center mb-2"><h3>EOT Requests (${eotRequests.length})</h3>
          <div class="flex gap-2"><button class="btn btn-outline btn-sm" id="exportEotCsvBtn">⬇ Export EOT Register CSV</button><button class="btn btn-outline btn-sm" id="printEotRegisterBtn">🖨 Print EOT Register</button></div>
        </div>
        ${eotRequests.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th>Request No</th><th>Raised</th><th>Delay Events</th><th>Net EOT Days</th><th>Progress</th><th>Revised Completion</th><th></th></tr></thead>
        <tbody>${eotRequests.map((r,ri)=>`<tr class="row-enter" style="animation-delay:${ri*40}ms">
          <td>${U.escapeHtml(r.requestNo)}</td><td>${U.relativeTime(r.createdAt)}</td><td>${(r.hindranceIds||[]).length}</td><td><b class="eot-days-counter" data-target="${r.totalDays}">0</b></td>
          <td>${eotStepper(r.status)} ${eotStatusBadge(r.status)}${r.pmComment ? `<div class="text-muted mt-1" style="font-size:11px;max-width:220px">💬 ${U.escapeHtml(r.pmComment)}</div>` : ""}</td>
          <td>${r.revisedCompletionDate?U.fmtDate(r.revisedCompletionDate):"—"}</td>
          <td class="flex gap-2">
            <button class="btn btn-sm btn-outline" data-eot-view="${r.id}">View</button>
            ${isPM && r.status==="submitted" ? `<button class="btn btn-sm btn-success" data-eot-approve="${r.id}">Approve</button><button class="btn btn-sm btn-outline" data-eot-return="${r.id}">Return</button><button class="btn btn-sm btn-danger" data-eot-reject="${r.id}">Reject</button>` : ""}
            ${r.raisedBy===user.id && (r.status==="draft"||r.status==="returned") ? `<button class="btn btn-sm btn-outline" data-eot-edit="${r.id}">Edit</button><button class="btn btn-sm btn-primary" data-eot-submit="${r.id}">Submit</button>` : ""}
          </td>
        </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><div class="es-icon">📄</div>No EOT requests raised yet.</div>`}
      </div>
      ${list.length ? list.map((h,hi)=>`<div class="hindrance-card card-enter" style="animation-delay:${hi*40}ms">
        <div><div class="flex gap-2 items-center mb-1">${h.category?`<span class="badge badge-neutral">${U.escapeHtml(h.category)}</span>`:""}<span class="badge badge-warning">${U.escapeHtml(h.type)}</span><span class="badge status-badge ${h.status==='resolved'?'badge-success':h.status==='acknowledged'?'badge-info':'badge-neutral'}">${h.status}</span>${h.criticalPathImpact?`<span class="badge badge-danger">Critical Path</span>`:""}${h.delayFrom&&h.delayTo?`<span class="badge badge-neutral">${U.fmtDate(h.delayFrom)} – ${U.fmtDate(h.delayTo)} (${U.daysBetween(h.delayFrom,h.delayTo)+1}d)</span>`:""}</div>
        <p style="font-size:13px;margin:0">${U.escapeHtml(h.description)}</p>
        ${h.evidenceRequired?`<p class="text-muted mt-1" style="font-size:11px;margin:2px 0 0">📎 Evidence required: ${U.escapeHtml(h.evidenceRequired)}</p>`:""}
        <span class="text-muted" style="font-size:11px">${U.relativeTime(h.raisedAt)}</span></div>
        ${isPM && h.status==="pending" ? `<div class="flex gap-2"><button class="btn btn-sm btn-outline" data-ack="${h.id}">Acknowledge</button><button class="btn btn-sm btn-success" data-resolve="${h.id}">Mark Resolved</button></div>` : ""}
        ${isPM && h.status==="acknowledged" ? `<button class="btn btn-sm btn-success" data-resolve="${h.id}">Mark Resolved</button>` : ""}
      </div>`).join("") : `<div class="empty-state"><div class="es-icon">🚧</div>No hindrances raised.</div>`}`;

    document.getElementById("exportHindCsvBtn")?.addEventListener("click", ()=>{
      U.exportCSV(`hindrance-register-${project.name}`,
        ["Category","Type","Status","Critical Path","Delay From","Delay To","Days","Description","Evidence Required","Responsible Party","Raised"],
        list.map(h=>[h.category||"", h.type, h.status, h.criticalPathImpact?"Yes":"No", h.delayFrom?U.fmtDate(h.delayFrom):"", h.delayTo?U.fmtDate(h.delayTo):"", h.delayFrom&&h.delayTo?U.daysBetween(h.delayFrom,h.delayTo)+1:"", h.description, h.evidenceRequired||"", h.responsibleParty||"", U.fmtDateTime(h.raisedAt)]));
    });
    document.getElementById("printHindRegisterBtn")?.addEventListener("click", ()=> printHindranceRegister(list));
    document.getElementById("exportEotCsvBtn")?.addEventListener("click", ()=>{
      U.exportCSV(`eot-register-${project.name}`,
        ["Request No","Raised","Delay Events","Net EOT Days","Status","Original Completion","Revised Completion","PM Comment"],
        eotRequests.map(r=>[r.requestNo, U.fmtDateTime(r.createdAt), (r.hindranceIds||[]).length, r.totalDays, r.status, r.originalCompletionDate?U.fmtDate(r.originalCompletionDate):"", r.revisedCompletionDate?U.fmtDate(r.revisedCompletionDate):"", r.pmComment||""]));
    });
    document.getElementById("printEotRegisterBtn")?.addEventListener("click", ()=> printEotRegister(eotRequests));
    document.getElementById("newEotReqBtn")?.addEventListener("click", ()=> openEotRequestModal(qualifying));
    panel.querySelectorAll("[data-eot-view]").forEach(b=> b.addEventListener("click", ()=> printEOTRequestLetter(DB.eotRequests.get(b.dataset.eotView))));
    panel.querySelectorAll("[data-eot-edit]").forEach(b=> b.addEventListener("click", ()=> openEotRequestModal(qualifying, DB.eotRequests.get(b.dataset.eotEdit))));
    panel.querySelectorAll(".eot-days-counter").forEach(el=> U.animateCounter(el, +el.dataset.target||0));
    panel.querySelectorAll("[data-eot-submit]").forEach(b=> b.addEventListener("click", ()=>{
      const r = DB.eotRequests.get(b.dataset.eotSubmit);
      DB.eotRequests.update(r.id, { status:"submitted", submittedAt:DB.nowISO() });
      DB.notifications.create({ userId:project.pmId, title:"EOT Request submitted", body:`${r.requestNo} submitted for approval on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
      U.toast("EOT Request submitted for approval.", {type:"success"}); renderHindrance();
    }));
    panel.querySelectorAll("[data-eot-approve]").forEach(b=> b.addEventListener("click", ()=>{
      const r = DB.eotRequests.get(b.dataset.eotApprove);
      DB.eotRequests.update(r.id, { status:"approved", decidedBy:user.id, decidedAt:DB.nowISO() });
      if(r.revisedCompletionDate) DB.projects.update(project.id, { endDate:r.revisedCompletionDate });
      DB.notifications.create({ userId:r.raisedBy, title:"EOT Request approved", body:`${r.requestNo} approved — ${r.totalDays} day(s) granted on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
      U.toast("EOT Request approved.", {type:"success"}); renderHindrance();
    }));
    panel.querySelectorAll("[data-eot-return]").forEach(b=> b.addEventListener("click", ()=>{
      const comment = prompt("Reason for returning this EOT Request for revision:");
      if(comment===null) return;
      const r = DB.eotRequests.get(b.dataset.eotReturn);
      DB.eotRequests.update(r.id, { status:"returned", pmComment:comment, decidedBy:user.id, decidedAt:DB.nowISO() });
      DB.notifications.create({ userId:r.raisedBy, title:"EOT Request returned", body:`${r.requestNo} returned for revision on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
      U.toast("EOT Request returned for revision.", {type:"warning"}); renderHindrance();
    }));
    panel.querySelectorAll("[data-eot-reject]").forEach(b=> b.addEventListener("click", ()=>{
      const comment = prompt("Reason for rejecting this EOT Request:");
      if(comment===null) return;
      const r = DB.eotRequests.get(b.dataset.eotReject);
      DB.eotRequests.update(r.id, { status:"rejected", pmComment:comment, decidedBy:user.id, decidedAt:DB.nowISO() });
      DB.notifications.create({ userId:r.raisedBy, title:"EOT Request rejected", body:`${r.requestNo} rejected on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
      U.toast("EOT Request rejected.", {type:"danger"}); renderHindrance();
    }));

    document.getElementById("newHindBtn")?.addEventListener("click", ()=>{
      const lib = hindranceLibrary();
      const categories = [...new Set(lib.map(l=>l.category))].sort();
      document.getElementById("genericModalTitle").textContent = "Raise Hindrance";
      document.getElementById("genericModalBody").innerHTML = `
        <div class="input-group">
          <div class="field"><label>Category</label><select class="select" id="hCategory"><option value="">All Categories</option>${categories.map(c=>`<option value="${U.escapeHtml(c)}">${U.escapeHtml(c)}</option>`).join("")}</select></div>
          <div class="field"><label>Hindrance Type</label><select class="select" id="hLib"></select></div>
        </div>
        <div class="card" id="hLibInfo" style="background:var(--surface-2);margin-bottom:14px;display:none"></div>
        <div class="field hidden" id="hOtherWrap"><label>Specify Custom Type</label><input class="input" id="hOtherType" placeholder="e.g. Design Change"></div>
        <div class="input-group">
          <div class="field"><label>Delay Period From</label><input class="input" type="date" id="hFrom"></div>
          <div class="field"><label>Delay Period To</label><input class="input" type="date" id="hTo"></div>
        </div>
        <p class="hint mb-2">Setting a delay period lets this hindrance be counted toward the EOT (Extension of Time) calculation once acknowledged.</p>
        <div class="field"><label>Description</label><textarea class="textarea" id="hDesc" placeholder="e.g. Cement delivery delayed, material storage location not allocated…"></textarea></div>`;
      document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="hSave">Submit</button>`;
      U.openModal("genericModal");

      function libOptionsFor(cat){
        const filtered = cat ? lib.filter(l=>l.category===cat) : lib;
        return filtered.map(l=>`<option value="${l.id}">${U.escapeHtml(l.category)} — ${U.escapeHtml(l.title)}</option>`).join("") + `<option value="__custom">+ Custom / Other (not in library)</option>`;
      }
      const hLibSel = document.getElementById("hLib");
      hLibSel.innerHTML = libOptionsFor("");
      let lastAutoDesc = "";
      function applyLibSelection(){
        const val = hLibSel.value;
        const info = document.getElementById("hLibInfo");
        document.getElementById("hOtherWrap").classList.toggle("hidden", val!=="__custom");
        if(val==="__custom"){ info.style.display="none"; return; }
        const l = lib.find(x=>x.id===val);
        if(!l){ info.style.display="none"; return; }
        info.style.display="block";
        info.classList.remove("animate-fadeInUp"); void info.offsetWidth; info.classList.add("animate-fadeInUp");
        info.innerHTML = `
          <p style="font-size:12px;margin:0 0 6px"><b>Typical Root Cause:</b> ${U.escapeHtml(l.rootCause||"—")}</p>
          <p style="font-size:12px;margin:0 0 6px"><b>Typical Impact:</b> ${U.escapeHtml(l.impact||"—")}</p>
          <p style="font-size:12px;margin:0 0 6px"><b>Recovery Method:</b> ${U.escapeHtml(l.recoveryMethod||"—")}</p>
          <p style="font-size:12px;margin:0 0 6px"><b>Evidence Required:</b> ${U.escapeHtml(l.evidenceRequired||"—")}</p>
          <p style="font-size:12px;margin:0"><b>Responsible Party:</b> ${U.escapeHtml(l.responsibleParty||"—")} &nbsp;|&nbsp; <b>Critical Path:</b> ${l.criticalPathImpact?"Yes":"No"} &nbsp;|&nbsp; <b>Risk:</b> ${U.escapeHtml(l.riskLevel||"—")}`;
        const descEl = document.getElementById("hDesc");
        if(!descEl.value.trim() || descEl.value===lastAutoDesc){ descEl.value = l.description||""; lastAutoDesc = l.description||""; }
      }
      document.getElementById("hCategory").addEventListener("change", e=>{
        hLibSel.innerHTML = libOptionsFor(e.target.value);
        applyLibSelection();
      });
      hLibSel.addEventListener("change", applyLibSelection);
      applyLibSelection();

      document.getElementById("hSave").addEventListener("click", ()=>{
        const desc = document.getElementById("hDesc").value.trim();
        if(!desc){ U.toast("Describe the hindrance.", {type:"danger"}); return; }
        const libVal = hLibSel.value;
        const l = libVal!=="__custom" ? lib.find(x=>x.id===libVal) : null;
        let type;
        if(l) type = l.title;
        else {
          type = document.getElementById("hOtherType").value.trim();
          if(!type){ U.toast("Specify the custom hindrance type.", {type:"danger"}); return; }
        }
        const delayFrom = document.getElementById("hFrom").value, delayTo = document.getElementById("hTo").value;
        if(delayFrom && delayTo && new Date(delayTo) < new Date(delayFrom)){ U.toast("Delay 'To' date must be on/after the 'From' date.", {type:"danger"}); return; }
        DB.hindrances.create({ projectId:project.id, type, description:desc, delayFrom:delayFrom||null, delayTo:delayTo||null,
          libraryId: l?l.id:null, category: l?l.category:"Others", criticalPathImpact: l?!!l.criticalPathImpact:false,
          evidenceRequired: l?l.evidenceRequired:"", responsibleParty: l?l.responsibleParty:"", riskLevel: l?l.riskLevel:"",
          raisedBy:user.id, status:"pending", raisedAt:DB.nowISO() });
        DB.notifications.create({ userId:project.pmId, title:"New hindrance raised", body:`${type} reported on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
        U.closeModal("genericModal"); renderHindrance(); U.toast("Hindrance submitted to Project Manager.", {type:"success"});
      });
    });
    panel.addEventListener("click", e=>{
      const ack = e.target.closest("[data-ack]"); const res = e.target.closest("[data-resolve]");
      if(ack){ DB.hindrances.update(ack.dataset.ack, {status:"acknowledged"}); renderHindrance(); }
      if(res){ DB.hindrances.update(res.dataset.resolve, {status:"resolved"}); U.toast("Hindrance marked resolved.", {type:"success"}); renderHindrance(); }
    });
  }

  function openEotRequestModal(qualifying, existingReq){
    document.getElementById("genericModalTitle").textContent = existingReq ? "Revise EOT Request" : "New EOT Request";
    document.getElementById("genericModalBody").innerHTML = `
      <p class="hint mb-2">All outstanding delay events are pre-selected — uncheck any that shouldn't count toward this request. Overlapping periods are merged automatically so no day is double-counted.</p>
      <div class="table-wrap" style="max-height:260px;overflow-y:auto"><table class="dtable"><thead><tr><th></th><th>Type</th><th>Category</th><th>Period</th><th>Days</th><th>Critical</th></tr></thead>
      <tbody>${qualifying.map(h=>`<tr>
        <td><input type="checkbox" class="eotHindChk" value="${h.id}" ${existingReq ? ((existingReq.hindranceIds||[]).includes(h.id)?"checked":"") : "checked"}></td>
        <td>${U.escapeHtml(h.type)}</td><td>${U.escapeHtml(h.category||"—")}</td>
        <td>${U.fmtDate(h.delayFrom)} – ${U.fmtDate(h.delayTo)}</td><td>${U.daysBetween(h.delayFrom,h.delayTo)+1}</td>
        <td>${h.criticalPathImpact?"Yes":"No"}</td>
      </tr>`).join("")}</tbody></table></div>
      <div class="card mt-3" id="eotPreview" style="background:var(--surface-2)"></div>`;
    document.getElementById("genericModalFoot").innerHTML = `
      <button class="btn btn-outline" id="eotSaveDraftBtn">Save as Draft</button>
      <button class="btn btn-primary" id="eotSubmitBtn">Submit for Approval</button>`;
    U.openModal("genericModal");

    function selectedHindrances(){
      const ids = [...document.querySelectorAll(".eotHindChk:checked")].map(c=>c.value);
      return qualifying.filter(h=>ids.includes(h.id));
    }
    function updatePreview(){
      const sel = selectedHindrances();
      const eot = computeEOT(sel);
      const newEndDate = project.endDate && eot.totalDays ? (()=>{ const d=new Date(project.endDate); d.setDate(d.getDate()+eot.totalDays); return d; })() : null;
      const preview = document.getElementById("eotPreview");
      preview.innerHTML = sel.length ? `
        <p style="font-size:13px;margin:0 0 6px"><b>Merged Delay Periods:</b></p>
        ${eot.merged.map(m=>`<div style="font-size:12px;margin-bottom:4px">${U.fmtDate(m.from)} – ${U.fmtDate(m.to)} (${U.daysBetween(m.from,m.to)+1}d) — ${m.items.map(h=>U.escapeHtml(h.type)).join(", ")}</div>`).join("")}
        <p style="font-size:13px;margin:8px 0 0"><b>Net EOT Days: <span class="eot-days-counter" data-target="${eot.totalDays}">0</span></b> &nbsp;|&nbsp; Revised Completion: <b>${newEndDate?U.fmtDate(newEndDate):"—"}</b></p>
      ` : `<p class="text-muted" style="font-size:12px;margin:0">Select at least one delay event to preview the overlap calculation.</p>`;
      preview.classList.remove("animate-fadeInUp"); void preview.offsetWidth; preview.classList.add("animate-fadeInUp");
      const counter = preview.querySelector(".eot-days-counter");
      if(counter) U.animateCounter(counter, eot.totalDays, 400);
    }
    document.querySelectorAll(".eotHindChk").forEach(c=> c.addEventListener("change", updatePreview));
    updatePreview();

    function saveRequest(status){
      const sel = selectedHindrances();
      if(!sel.length){ U.toast("Select at least one delay event.", {type:"danger"}); return; }
      const eot = computeEOT(sel);
      const newEndDate = project.endDate ? (()=>{ const d=new Date(project.endDate); d.setDate(d.getDate()+eot.totalDays); return d.toISOString().slice(0,10); })() : null;
      const payload = {
        hindranceIds: sel.map(h=>h.id),
        mergedRanges: eot.merged.map(m=>({ from:m.from.toISOString().slice(0,10), to:m.to.toISOString().slice(0,10), items:m.items.map(h=>({type:h.type, category:h.category, description:h.description, criticalPathImpact:!!h.criticalPathImpact})) })),
        totalDays: eot.totalDays,
        originalCompletionDate: project.endDate||null,
        revisedCompletionDate: newEndDate,
        status
      };
      if(existingReq){
        DB.eotRequests.update(existingReq.id, Object.assign({}, payload, status==="submitted"?{submittedAt:DB.nowISO()}:{}));
      } else {
        DB.eotRequests.create(Object.assign({ projectId:project.id, requestNo:"EOT-"+String(DB._store.eotRequests.length+1).padStart(3,"0"), raisedBy:user.id }, payload, status==="submitted"?{submittedAt:DB.nowISO()}:{}));
      }
      if(status==="submitted") DB.notifications.create({ userId:project.pmId, title:"EOT Request submitted", body:`New EOT Request submitted for approval on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
      U.closeModal("genericModal"); renderHindrance();
      U.toast(status==="submitted" ? "EOT Request submitted for approval." : "EOT Request saved as draft.", {type:"success"});
    }
    document.getElementById("eotSaveDraftBtn").addEventListener("click", ()=> saveRequest("draft"));
    document.getElementById("eotSubmitBtn").addEventListener("click", ()=> saveRequest("submitted"));
  }

  function printRegisterWindow(title, headerHtml, tableHtml){
    const body = `
      <div class="title" style="text-align:left;text-transform:none;letter-spacing:normal;font-size:18px;margin:0 0 4px">${title}</div>
      <p class="meta" style="font-size:12px;color:#555;margin-bottom:16px">${headerHtml}</p>
      ${tableHtml}
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.fmtDateTime(new Date())}</span></div>`;
    SW.UI.printDocument(`${title} — ${U.escapeHtml(project.name)}`, body);
  }
  function printHindranceRegister(list){
    const rows = list.map(h=>`<tr><td>${U.escapeHtml(h.category||"—")}</td><td>${U.escapeHtml(h.type)}</td><td>${h.status}</td><td>${h.criticalPathImpact?"Yes":"No"}</td>
      <td>${h.delayFrom&&h.delayTo?`${U.fmtDate(h.delayFrom)} – ${U.fmtDate(h.delayTo)} (${U.daysBetween(h.delayFrom,h.delayTo)+1}d)`:"—"}</td>
      <td>${U.escapeHtml(h.description)}</td><td>${U.escapeHtml(h.evidenceRequired||"—")}</td></tr>`).join("");
    printRegisterWindow("Hindrance Register",
      `Project: ${U.escapeHtml(project.name)} &nbsp;|&nbsp; District: ${U.escapeHtml(project.district)}, ${U.escapeHtml(project.state)} &nbsp;|&nbsp; Total Hindrances: ${list.length}`,
      `<table><thead><tr><th>Category</th><th>Type</th><th>Status</th><th>Critical</th><th>Delay Period</th><th>Description</th><th>Evidence Required</th></tr></thead><tbody>${rows||'<tr><td colspan="7">No hindrances raised.</td></tr>'}</tbody></table>`);
  }
  function printEotRegister(eotRequests){
    const rows = eotRequests.map(r=>`<tr><td>${U.escapeHtml(r.requestNo)}</td><td>${U.fmtDate(r.createdAt)}</td><td>${(r.hindranceIds||[]).length}</td><td>${r.totalDays}</td>
      <td>${r.status}</td><td>${r.originalCompletionDate?U.fmtDate(r.originalCompletionDate):"—"}</td><td>${r.revisedCompletionDate?U.fmtDate(r.revisedCompletionDate):"—"}</td>
      <td>${U.escapeHtml(r.pmComment||"—")}</td></tr>`).join("");
    printRegisterWindow("EOT (Extension of Time) Register",
      `Project: ${U.escapeHtml(project.name)} &nbsp;|&nbsp; Total EOT Requests: ${eotRequests.length} &nbsp;|&nbsp; Approved Days: ${eotRequests.filter(r=>r.status==='approved').reduce((s,r)=>s+r.totalDays,0)}`,
      `<table><thead><tr><th>Request No</th><th>Raised</th><th>Delay Events</th><th>Net Days</th><th>Status</th><th>Original Completion</th><th>Revised Completion</th><th>PM Comment</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No EOT requests raised.</td></tr>'}</tbody></table>`);
  }

  function printEOTRequestLetter(r){
    const pm = DB.users.get(project.pmId);
    const pmCompany = pm ? (DB.companies.list(c=>c.ownerId===pm.id)[0]||{}) : {};
    const contractorUser = project.external ? null : DB.users.get(project.contractorId);
    const contractorName = project.external ? (project.externalContractorName||"External Contractor") : (contractorUser?.name||"—");
    const periodRows = (r.mergedRanges||[]).map(m=>`
      <tr><td>${U.fmtDate(m.from)} – ${U.fmtDate(m.to)}</td><td>${U.daysBetween(m.from,m.to)+1}</td>
      <td>${m.items.map(h=>`<b>[${U.escapeHtml(h.category||"—")}] ${U.escapeHtml(h.type)}:</b> ${U.escapeHtml(h.description)}`).join("<br><br>")}</td></tr>`).join("");
    const criticalCount = (r.mergedRanges||[]).reduce((s,m)=>s+m.items.filter(h=>h.criticalPathImpact).length,0);
    const statusColor = r.status==='approved'?'#16a34a':r.status==='rejected'?'#dc2626':r.status==='returned'?'#0284c7':'#d97706';
    const body = `
      <div class="letterhead"><div class="brand">${U.escapeHtml(pmCompany.name||"SubletWorks Client")}</div><div class="meta">${U.escapeHtml(pmCompany.gst||"")}<br>${U.escapeHtml(project.district)}, ${U.escapeHtml(project.state)}</div></div>
      <div class="title">Extension of Time (EOT) Request</div>
      <p style="font-size:13px"><b>Ref:</b> ${U.escapeHtml(r.requestNo)} &nbsp;|&nbsp; <b>Project:</b> ${U.escapeHtml(project.name)} &nbsp;|&nbsp; <b>Contractor:</b> ${U.escapeHtml(contractorName)} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(r.createdAt)} &nbsp;|&nbsp; <b>Status:</b> <span class="badge-inline" style="background:${statusColor}">${r.status}</span> &nbsp;|&nbsp; <b>Rev:</b> ${r.version||1}</p>
      <h4>Background</h4>
      <p>This request is submitted in accordance with the contract, seeking an Extension of Time on account of the delay event(s) described below, none of which are attributable to the Contractor's default. A total Extension of Time of <b>${r.totalDays} day(s)</b> is claimed, computed after merging overlapping delay periods so that no calendar day is counted more than once.</p>
      <h4>Chronology of Delay Events</h4>
      <table><thead><tr><th>Delay Period</th><th>Days</th><th>Cause &amp; Effect</th></tr></thead><tbody>${periodRows}</tbody></table>
      <h4>Critical Path Impact</h4>
      <p>${criticalCount>0 ? `${criticalCount} of the contributing delay event(s) are assessed as impacting the critical path, directly delaying the contract completion date on a day-for-day basis.` : `The contributing delay events are assessed as non-critical in isolation; the merged net impact above is nonetheless claimed as it affected the overall progress of works.`}</p>
      <h4>Summary &amp; Requested Extension</h4>
      <table><tr><td style="width:260px"><b>Original Completion Date</b></td><td>${r.originalCompletionDate?U.fmtDate(r.originalCompletionDate):"—"}</td></tr>
      <tr><td><b>Total EOT Days Claimed</b></td><td>${r.totalDays}</td></tr>
      <tr><td><b>Revised Completion Date (requested)</b></td><td>${r.revisedCompletionDate?U.fmtDate(r.revisedCompletionDate):"—"}</td></tr></table>
      ${r.pmComment ? `<h4>Project Manager Remarks</h4><p>${U.escapeHtml(r.pmComment)}</p>` : ""}
      <h4>Declaration</h4>
      <p style="font-size:12px">The Contractor declares that the above delay events and periods are true and correct to the best of its knowledge, and supporting evidence is available on request.</p>
      <div class="signoff"><div>${U.signatureImg(contractorUser)}${U.escapeHtml(contractorName)}<br>Contractor</div><div>${U.signatureImg(pm)}${pm?U.escapeHtml(pm.name):"—"}<br>For ${U.escapeHtml(pmCompany.name||"Client")}</div></div>
      <div class="footer"><span>Generated via SubletWorks.com</span><span>${U.escapeHtml(r.requestNo)} · Revision ${r.version||1}</span></div>`;
    SW.UI.printDocument(`${U.escapeHtml(r.requestNo)} — EOT Letter — ${U.escapeHtml(project.name)}`, body);
  }

  /* ================= PAYMENT REQUESTS ================= */
  function renderPayments(){
    const list = DB.paymentRequests.list(p=>p.projectId===project.id).sort((a,b)=>new Date(b.raisedAt)-new Date(a.raisedAt));
    document.getElementById("panelPayments").innerHTML = `
      <div class="flex justify-between mb-3"><h3>Payment Requests</h3>${canRaiseSiteActions?'<button class="btn btn-primary btn-sm" id="newPayBtn">+ Request Payment</button>':''}</div>
      ${list.length ? list.map(p=>`<div class="payment-card">
        <div><b>${U.fmtINR(p.amount)}</b><div class="text-muted" style="font-size:12px">${U.escapeHtml(p.note||"")}</div><span class="text-muted" style="font-size:11px">${U.relativeTime(p.raisedAt)}</span></div>
        <div class="flex gap-2 items-center">
          <span class="badge ${p.status==='approved'?'badge-success':p.status==='rejected'?'badge-danger':'badge-warning'}">${p.status}</span>
          ${isPM && p.status==="pending" ? `<button class="btn btn-sm btn-success" data-approve-pay="${p.id}">Approve</button><button class="btn btn-sm btn-danger" data-reject-pay="${p.id}">Reject</button>` : ""}
        </div>
      </div>`).join("") : `<div class="empty-state"><div class="es-icon">🧾</div>No payment requests yet.</div>`}`;
    document.getElementById("newPayBtn")?.addEventListener("click", ()=>{
      document.getElementById("genericModalTitle").textContent = "Request Payment";
      document.getElementById("genericModalBody").innerHTML = `<div class="field"><label>Amount (₹)</label><input class="input" type="number" id="payAmount"></div><div class="field"><label>Note</label><textarea class="textarea" id="payNote"></textarea></div>`;
      document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="paySave">Submit Request</button>`;
      U.openModal("genericModal");
      document.getElementById("paySave").addEventListener("click", ()=>{
        const amount = +document.getElementById("payAmount").value||0;
        if(!amount){ U.toast("Enter an amount.", {type:"danger"}); return; }
        DB.paymentRequests.create({ projectId:project.id, amount, note:document.getElementById("payNote").value.trim(), raisedBy:user.id, status:"pending", raisedAt:DB.nowISO() });
        DB.notifications.create({ userId:project.pmId, title:"New payment request", body:`${U.fmtINR(amount)} requested on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=payments" });
        U.closeModal("genericModal"); renderPayments(); U.toast("Payment request submitted.", {type:"success"});
      });
    });
    document.getElementById("panelPayments").addEventListener("click", e=>{
      const app = e.target.closest("[data-approve-pay]"); const rej = e.target.closest("[data-reject-pay]");
      if(app){ DB.paymentRequests.update(app.dataset.approvePay, {status:"approved"}); U.toast("Payment approved.", {type:"success"}); renderPayments(); }
      if(rej){ DB.paymentRequests.update(rej.dataset.rejectPay, {status:"rejected"}); U.toast("Payment rejected.", {type:"warning"}); renderPayments(); }
    });
  }

  renderHeader(); renderOverview(); renderWBS(); renderGantt(); renderKanban(); renderCalendar(); renderWorkPlan(); renderMB(); renderExtraItems(); renderRABill(); renderPO(); renderVehicle(); renderGRN(); renderReconciliation(); renderDPR(); renderAttendance(); renderHindrance(); renderPayments();
  U.initTabs();
  document.querySelector('#wsTabs [data-tab="reconciliation"]').addEventListener("click", renderReconciliation);
  document.querySelector('#wsTabs [data-tab="overview"]').addEventListener("click", renderOverview);
  document.querySelector('#wsTabs [data-tab="vehicle"]').addEventListener("click", renderVehicle);
  document.querySelector('#wsTabs [data-tab="grn"]').addEventListener("click", renderGRN);
  // Attendance depends on team-member allotments managed in Profile & Settings, so
  // re-render on tab open to reflect any allotment/rate changes made since page load.
  document.querySelector('#wsTabs [data-tab="attendance"]').addEventListener("click", renderAttendance);
  // Statutory compliance registers — mounted lazily (and re-mounted on tab open,
  // since the registers derive from team members & attendance managed elsewhere).
  function renderCompliance(){ if(window.SW.Compliance) SW.Compliance.mount(document.getElementById("panelCompliance"), { project, user }); }
  renderCompliance();
  document.querySelector('#wsTabs [data-tab="compliance"]').addEventListener("click", renderCompliance);
  const requestedTab = params.get("tab");
  if(requestedTab){ document.querySelector(`#wsTabs [data-tab="${requestedTab}"]`)?.click(); }

  SW.UI.helpSection(document.querySelector(".app-content"), "Project Workspace", [
    "WBS: break the project into a Work Breakdown Structure — insert the full standard 18-phase building-construction template (Pre-Construction through Handover) in one click, then add or remove line items to match this project's actual scope. Track % progress per item, export to CSV or print.",
    "Gantt: add tasks with start/end dates, mark critical-path items, and track % progress — project progress rolls up automatically.",
    "Kanban: drag cards between columns; add your own columns and cards with priority and due dates.",
    "Work Plan: either the Project Manager or the Contractor can plan ahead — define the labour (trade + count), material (item + qty + unit) and equipment needed for an upcoming date range. Link it to an existing Gantt task, or leave it unlinked and a Gantt timeline entry is created automatically from the plan's From/To dates — so raising a Work Plan is what actually decides and builds out the project's schedule. Both sides can update status (Planned/In Progress/Completed); paste Excel rows directly into the labour/material tables, or use \"Quick-fill from a Common Work Item\" to auto-calculate standard material and mandays for common items (Brickwork, PCC, RCC, Plastering, Flooring, Painting, Steel fixing) from a quantity.",
    "MB Sheet: every row is measured against a specific BOQ item (official or an approved Extra Item) picked from a dropdown — Nos × Length × Breadth × Height × Factor computes quantity automatically, with ready factor presets for Steel/TMT/Pipe/Plate that also switch the row to a weight unit (kg). The abstract sums every row per BOQ item automatically and converts kg → MT when that item is billed in MT/Tons.",
    "RA Bill: for item-wise BOQs, claim against each item using % complete or a manual cumulative quantity — this-bill qty/amount is auto-computed from the last billed cumulative. Retention, advance recovery, GST and TDS are then calculated automatically. Project Managers approve or reject.",
    "Extra Items: raise work outside the original BOQ scope with a proposed rate and justification — once the Project Manager approves it (optionally adjusting the rate), it's automatically included in MB Sheet, RA Billing and Reconciliation.",
    "Reconciliation: compares MB Sheet measured quantities against cumulative RA-billed quantities per BOQ item, flagging any item billed beyond what's actually been measured.",
    "DPR: log daily labour, equipment, weather and work done — useful for dispute resolution and progress tracking.",
    "Attendance: for team members you've allotted to this project (from Profile & Settings), pick a date and mark each person Present / Half Day / Present + OT / Absent. The Wage Summary tallies man-days and auto-calculates wages payable from each member's daily rate across every recorded date — export it as CSV or print a Muster Roll & Wage Sheet. Each party (PM and contractor) tracks only their own crew.",
    "Compliance: the statutory labour-law registers, per project — Form A (Employee), Form B (Wage), Form C (Loan/Fines), Form D (Attendance/Muster), Form E (Leave) per the Ease of Compliance Rules 2017, plus Overtime, ESIC (0.75%/3.25%), EPF/ECR (12% + 8.33% EPS) and an Accident register. Each register auto-fills from your allotted team members and their attendance/wages, every cell is editable, you can add blank rows or reset to actual data, and print either the filled register or a blank template — all without altering anything else. Switch to \"Declaration & Nomination Forms\" for the per-employee statutory forms — EPF Form 11 (composite declaration), EPF Form 2 (nomination), ESIC Form 1 (declaration) and Gratuity Form F (nomination) — pick a team member to auto-fill known details or keep it blank, then print filled or blank.",
    "Hindrance: report blockers by picking a category and type from the admin-managed Hindrance Library (or \"Custom / Other\" to specify your own) — the library auto-fills typical root cause, impact, evidence required and responsible party.",
    "EOT Requests: once one or more hindrances have a delay period set, raise a formal EOT Request by selecting which delay events it covers — overlapping periods are merged automatically so no day is double-counted. Save as Draft to keep editing, or Submit for Approval. The Project Manager can Approve (which updates the project's completion date), Return for Revision with a comment, or Reject. Every request can be printed as a professional EOT letter with full chronology and revision history.",
    "Use Export CSV / Print Register on the Hindrance Register and EOT Requests cards to generate the full Hindrance Register and EOT Register for reporting or client submission.",
    "RA Bill print now shows the full item-wise claim referenced against the BOQ and MB abstract (BOQ qty, rate, previous/this-bill/cumulative quantity) alongside the retention/GST/TDS summary — ready to hand to the client for record.",
    "Purchase Orders: raise a PO to any material vendor with an item table (paste from Excel supported), then record the vendor's Proforma Invoice (PI number, validity, GST%, advance%) once received. Status moves Draft → Sent → PI Received → Confirmed → Goods Received, with a professional print view for both the PO and the PI.",
    "Vehicle Log: log every transport vehicle entering site (material delivery, equipment, waste removal) with driver details, an optional link to a Purchase Order, and a safety checklist (tyres, brakes, lights, documents, license, load secured). Any failed check flags the entry; print a Gate Pass or mark the vehicle's exit once it leaves.",
    "Material Inward: record what actually arrived against a Purchase Order — the item list auto-fills from the PO with ordered quantity, and you enter what was actually received plus any damaged/short quantity. Any shortfall or damage is automatically flagged as a variance, with a printable Goods Received Note (GRN).",
    "Payment Requests: a lightweight way to formally request release of funds against measured or billed work."
  ]);
})();
