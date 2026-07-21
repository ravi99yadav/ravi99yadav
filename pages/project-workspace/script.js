(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"project-workspace" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, isPM = user.role==="pm";

  const params = new URLSearchParams(location.search);
  let project = params.get("id") ? DB.projects.get(params.get("id")) : null;
  if(project && !(isPM ? project.pmId===user.id : project.contractorId===user.id)){
    project = null; // not this user's project — fall back to the picker rather than leaking another company's data
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
      <div class="field"><label>Linked Gantt Task (optional)</label><select class="select" id="wpTask"><option value="">— None —</option>${tasks.map(t=>`<option value="${t.id}" ${plan&&plan.ganttTaskId===t.id?'selected':''}>${U.escapeHtml(t.name)}</option>`).join("")}</select></div>

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
      const data = {
        projectId:project.id, dateFrom, dateTo, ganttTaskId: document.getElementById("wpTask").value||null,
        labour: labourRows.filter(r=>r.trade && r.trade.trim()).map(r=>({trade:r.trade.trim(), count:+r.count||0})),
        material: materialRows.filter(r=>r.item && r.item.trim()).map(r=>({item:r.item.trim(), qty:+r.qty||0, unit:(r.unit||"").trim()||"Nos"})),
        equipment: document.getElementById("wpEquipment").value.trim(),
        remarks: document.getElementById("wpRemarks").value.trim()
      };
      if(plan) DB.workPlans.update(plan.id, data);
      else DB.workPlans.create(Object.assign({status:"planned", createdBy:user.id}, data));
      const otherId = isPM ? project.contractorId : project.pmId;
      if(otherId) DB.notifications.create({ userId:otherId, title: plan?"Work plan updated":"New work plan added", body:`${U.fmtDate(dateFrom)} – ${U.fmtDate(dateTo)} on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=workplan" });
      U.closeModal("genericModal"); renderWorkPlan();
      U.toast(plan?"Work plan updated.":"Work plan created.", {type:"success"});
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
      <p class="hint mb-2">💡 Every row measures against a specific BOQ item (official or an approved Extra Item) — pick it from the dropdown. Multiple rows against the same item sum together automatically in the Abstract below. Use a Factor preset for Steel/TMT (by bar diameter)/Pipe/Plate to auto-fill the predefined weight and switch the row to kg — the abstract converts kg → MT automatically when the BOQ item is billed in MT/Tons. You can also paste a copied Excel range (Unit, Nos, Length, Breadth, Height, Factor columns) directly into any cell — extra rows are added automatically.</p>
      ${!boqOptions.length ? `<div class="empty-state mb-3">This project has no BOQ items yet (lump sum contract) — add an Extra Item first, or measure isn't applicable here.</div>` : ""}
      <div class="table-wrap mb-4"><table class="dtable"><thead><tr><th>BOQ Item</th><th>Row Unit</th><th>Nos</th><th>Length (m)</th><th>Breadth (m)</th><th>Height/Depth (m)</th><th>Factor</th><th>Qty</th><th></th></tr></thead>
      <tbody id="mbTbody">${rows.map(r=>mbRowHtml(r, boqOptions)).join("")}</tbody></table></div>
      <button class="btn btn-outline btn-sm mb-4" id="addMBRowBtn" ${!boqOptions.length?'disabled':''}>+ Add Measurement Row</button>
      <div class="card"><h3>Auto Abstract (in each BOQ item's own unit)</h3><div id="mbAbstract"></div></div>`;
    renderAbstract(sheetId);
    document.getElementById("addMBRowBtn").addEventListener("click", ()=>{
      const first = boqOptions[0];
      DB.mbRows.create({mbSheetId:sheetId, boqItemId:first?first.id:null, unit:first?first.unit:"Cum", nos:1, length:0, breadth:0, height:0, factor:1, qty:0});
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
        DB.mbRows.update(tr.dataset.row, { boqItemId: e.target.value });
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
      const fields = ["unit","nos","length","breadth","height","factor"];
      const startFieldIdx = fields.indexOf(input.dataset.field);
      const trs = U.qsa("tr", tbody);
      const startRowIdx = trs.indexOf(input.closest("tr"));
      const dbRows = DB.mbRows.list(rr=>rr.mbSheetId===sheetId);
      const defaultItem = boqOptions[0];
      grid.forEach((rowVals, rOff)=>{
        const rIdx = startRowIdx + rOff;
        let row = dbRows[rIdx];
        if(!row){
          row = DB.mbRows.create({mbSheetId:sheetId, boqItemId:defaultItem?defaultItem.id:null, unit:defaultItem?defaultItem.unit:"Cum", nos:1, length:0, breadth:0, height:0, factor:1, qty:0});
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
      groups[key] = groups[key] || { desc, unit:boqUnit, qty:0 };
      groups[key].qty += convertQtyToBoqUnit(r.qty||0, r.unit, boqUnit);
    });
    const list = Object.values(groups);
    document.getElementById("mbAbstract").innerHTML = list.length ? `<table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>Total Qty</th></tr></thead><tbody>${list.map(g=>`<tr><td>${U.escapeHtml(g.desc)}</td><td>${g.unit}</td><td><b>${g.qty.toFixed(3)}</b></td></tr>`).join("")}</tbody></table>` : `<p class="text-muted">Add measurement rows above to see the abstract.</p>`;
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
    const w = window.open("", "_blank");
    w.document.write(`<html><head><title>${b.billNo}</title></head><body style="font-family:Arial;padding:40px">
      <h2>RA Bill — ${b.billNo}</h2><p>${project.name} · ${U.fmtDate(b.billDate)}</p>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
      <tr><td>Previous Bill</td><td>${U.fmtINR(b.previousBillAmount)}</td></tr>
      <tr><td>Current Gross</td><td>${U.fmtINR(b.currentGrossAmount)}</td></tr>
      <tr><td>Retention (${b.retentionPct}%)</td><td>-${U.fmtINR(retention)}</td></tr>
      <tr><td>Advance Recovery</td><td>-${U.fmtINR(b.advanceRecovery)}</td></tr>
      <tr><td>TDS (${b.tdsPct}%)</td><td>-${U.fmtINR(tds)}</td></tr>
      <tr><td>GST (${b.gstPct}%)</td><td>+${U.fmtINR(gst)}</td></tr>
      <tr><td><b>Net Payable</b></td><td><b>${U.fmtINR(net)}</b></td></tr>
      </table><script>window.print()<\/script></body></html>`);
    w.document.close();
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

  /* ================= HINDRANCE ================= */
  function renderHindrance(){
    const list = DB.hindrances.list(h=>h.projectId===project.id).sort((a,b)=>new Date(b.raisedAt)-new Date(a.raisedAt));
    document.getElementById("panelHindrance").innerHTML = `
      <div class="flex justify-between mb-3"><h3>Hindrance Register</h3>${canRaiseSiteActions?'<button class="btn btn-primary btn-sm" id="newHindBtn">+ Raise Hindrance</button>':''}</div>
      ${list.length ? list.map(h=>`<div class="hindrance-card">
        <div><div class="flex gap-2 items-center mb-1"><span class="badge badge-warning">${h.type}</span><span class="badge ${h.status==='resolved'?'badge-success':h.status==='acknowledged'?'badge-info':'badge-neutral'}">${h.status}</span></div>
        <p style="font-size:13px;margin:0">${U.escapeHtml(h.description)}</p><span class="text-muted" style="font-size:11px">${U.relativeTime(h.raisedAt)}</span></div>
        ${isPM && h.status==="pending" ? `<div class="flex gap-2"><button class="btn btn-sm btn-outline" data-ack="${h.id}">Acknowledge</button><button class="btn btn-sm btn-success" data-resolve="${h.id}">Mark Resolved</button></div>` : ""}
        ${isPM && h.status==="acknowledged" ? `<button class="btn btn-sm btn-success" data-resolve="${h.id}">Mark Resolved</button>` : ""}
      </div>`).join("") : `<div class="empty-state"><div class="es-icon">🚧</div>No hindrances raised.</div>`}`;
    document.getElementById("newHindBtn")?.addEventListener("click", ()=>{
      document.getElementById("genericModalTitle").textContent = "Raise Hindrance";
      document.getElementById("genericModalBody").innerHTML = `
        <div class="field"><label>Type</label><select class="select" id="hType"><option>Material Delay</option><option>Drawing Delay</option><option>Shutdown</option><option>Rain</option><option>Power</option><option>Permit</option><option>Client Delay</option></select></div>
        <div class="field"><label>Description</label><textarea class="textarea" id="hDesc" placeholder="e.g. Cement delivery delayed, material storage location not allocated…"></textarea></div>`;
      document.getElementById("genericModalFoot").innerHTML = `<button class="btn btn-primary" id="hSave">Submit</button>`;
      U.openModal("genericModal");
      document.getElementById("hSave").addEventListener("click", ()=>{
        const desc = document.getElementById("hDesc").value.trim();
        if(!desc){ U.toast("Describe the hindrance.", {type:"danger"}); return; }
        DB.hindrances.create({ projectId:project.id, type:document.getElementById("hType").value, description:desc, raisedBy:user.id, status:"pending", raisedAt:DB.nowISO() });
        DB.notifications.create({ userId:project.pmId, title:"New hindrance raised", body:`${document.getElementById("hType").value} reported on "${project.name}".`, read:false, link:"/pages/project-workspace/index.html?id="+project.id+"&tab=hindrance" });
        U.closeModal("genericModal"); renderHindrance(); U.toast("Hindrance submitted to Project Manager.", {type:"success"});
      });
    });
    document.getElementById("panelHindrance").addEventListener("click", e=>{
      const ack = e.target.closest("[data-ack]"); const res = e.target.closest("[data-resolve]");
      if(ack){ DB.hindrances.update(ack.dataset.ack, {status:"acknowledged"}); renderHindrance(); }
      if(res){ DB.hindrances.update(res.dataset.resolve, {status:"resolved"}); U.toast("Hindrance marked resolved.", {type:"success"}); renderHindrance(); }
    });
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

  renderHeader(); renderOverview(); renderGantt(); renderKanban(); renderCalendar(); renderWorkPlan(); renderMB(); renderExtraItems(); renderRABill(); renderReconciliation(); renderDPR(); renderHindrance(); renderPayments();
  U.initTabs();
  document.querySelector('#wsTabs [data-tab="reconciliation"]').addEventListener("click", renderReconciliation);
  document.querySelector('#wsTabs [data-tab="overview"]').addEventListener("click", renderOverview);
  const requestedTab = params.get("tab");
  if(requestedTab){ document.querySelector(`#wsTabs [data-tab="${requestedTab}"]`)?.click(); }

  SW.UI.helpSection(document.querySelector(".app-content"), "Project Workspace", [
    "Gantt: add tasks with start/end dates, mark critical-path items, and track % progress — project progress rolls up automatically.",
    "Kanban: drag cards between columns; add your own columns and cards with priority and due dates.",
    "Work Plan: either the Project Manager or the Contractor can plan ahead — define the labour (trade + count), material (item + qty + unit) and equipment needed for an upcoming date range, optionally linked to a Gantt task. Both sides can update status (Planned/In Progress/Completed); paste Excel rows directly into the labour/material tables, or use \"Quick-fill from a Common Work Item\" to auto-calculate standard material and mandays for common items (Brickwork, PCC, RCC, Plastering, Flooring, Painting, Steel fixing) from a quantity.",
    "MB Sheet: every row is measured against a specific BOQ item (official or an approved Extra Item) picked from a dropdown — Nos × Length × Breadth × Height × Factor computes quantity automatically, with ready factor presets for Steel/TMT/Pipe/Plate that also switch the row to a weight unit (kg). The abstract sums every row per BOQ item automatically and converts kg → MT when that item is billed in MT/Tons.",
    "RA Bill: for item-wise BOQs, claim against each item using % complete or a manual cumulative quantity — this-bill qty/amount is auto-computed from the last billed cumulative. Retention, advance recovery, GST and TDS are then calculated automatically. Project Managers approve or reject.",
    "Extra Items: raise work outside the original BOQ scope with a proposed rate and justification — once the Project Manager approves it (optionally adjusting the rate), it's automatically included in MB Sheet, RA Billing and Reconciliation.",
    "Reconciliation: compares MB Sheet measured quantities against cumulative RA-billed quantities per BOQ item, flagging any item billed beyond what's actually been measured.",
    "DPR: log daily labour, equipment, weather and work done — useful for dispute resolution and progress tracking.",
    "Hindrance: contractors report blockers (material delay, drawings, permits, etc.); Project Managers acknowledge and resolve them.",
    "Payment Requests: a lightweight way to formally request release of funds against measured or billed work."
  ]);
})();
