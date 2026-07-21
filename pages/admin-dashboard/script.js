(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["admin"], active:"admin-dashboard" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  function revenue(){
    const unlocks = DB.contactUnlocks.list(c=>c.pmPaid && c.contractorPaid);
    const unlockRevenue = unlocks.reduce((s,u)=>s+u.amountEach*2,0);
    const mpRevenue = DB.marketplaceInquiries.list(i=>i.paid).length * DB.settings.get("marketplaceFee",49);
    return unlockRevenue + mpRevenue;
  }

  function renderKPIs(){
    const pendingUsers = DB.users.list(u=>u.status==="pending").length;
    const tenders = DB.tenders.list(t=>!t.archived).length;
    const projects = DB.projects.list(p=>!p.archived).length;
    const kpis = [
      { label:"Pending Approvals", value:pendingUsers, icon:"👤", cls:"warm" },
      { label:"Total Tenders", value:tenders, icon:"📄", cls:"" },
      { label:"Active Projects", value:projects, icon:"🏗️", cls:"success" },
      { label:"Platform Revenue", value:U.fmtINR(revenue()), icon:"💰", cls:"accent" }
    ];
    document.getElementById("kpiGrid").innerHTML = kpis.map(k=>`<div class="kpi-card card-gradient ${k.cls}"><div class="kpi-icon">${k.icon}</div><div class="kpi-value">${k.value}</div><div class="kpi-label">${k.label}</div></div>`).join("");
  }

  function renderApprovals(){
    const pending = DB.users.list(u=>u.status==="pending");
    document.getElementById("panelApprovals").innerHTML = `<div class="card"><h3>Pending Contractor Approvals</h3>
      ${pending.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Email</th><th>District</th><th>Registered</th><th></th></tr></thead>
      <tbody>${pending.map(u=>`<tr><td>${U.escapeHtml(u.name)}</td><td>${U.escapeHtml(u.email)}</td><td>${U.escapeHtml(u.district||"—")}</td><td>${U.fmtDate(u.createdAt)}</td>
        <td><button class="btn btn-sm btn-success" data-approve-user="${u.id}">Approve</button> <button class="btn btn-sm btn-danger" data-suspend-user="${u.id}">Reject</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-state">No pending approvals.</div>`}
      <h3 class="mt-5">All Users</h3>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
      <tbody>${DB.users.list().map(u=>`<tr><td>${U.escapeHtml(u.name)}</td><td>${SW.UI.roleLabel(u.role)}</td><td><span class="badge ${u.status==='active'?'badge-success':u.status==='pending'?'badge-warning':'badge-danger'}">${u.status}</span></td>
        <td>${u.status==='active' && u.role!=='admin' ? `<button class="btn btn-sm btn-ghost" data-suspend-user="${u.id}">Suspend</button>` : u.status==='suspended' ? `<button class="btn btn-sm btn-ghost" data-approve-user="${u.id}">Reactivate</button>` : ""}</td></tr>`).join("")}</tbody></table></div>
      </div>`;
  }
  document.getElementById("panelApprovals").addEventListener("click", e=>{
    const app = e.target.closest("[data-approve-user]"); const sus = e.target.closest("[data-suspend-user]");
    if(app){ DB.users.update(app.dataset.approveUser, {status:"active"}); U.toast("User approved.", {type:"success"}); renderApprovals(); }
    if(sus){ DB.users.update(sus.dataset.suspendUser, {status:"suspended"}); U.toast("User suspended.", {type:"warning"}); renderApprovals(); }
  });

  function renderPayments(){
    const unlocks = DB.contactUnlocks.list();
    const mp = DB.marketplaceInquiries.list();
    document.getElementById("panelPayments").innerHTML = `
      <div class="card mb-4"><h3>Contact Unlock Payments</h3>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Tender</th><th>PM Paid</th><th>Contractor Paid</th><th>Amount Each</th><th>Unlocked</th></tr></thead>
      <tbody>${unlocks.length ? unlocks.map(u=>{ const t = DB.tenders.get(u.tenderId); return `<tr><td>${t?U.escapeHtml(t.title):'—'}</td><td>${u.pmPaid?'✅':'—'}</td><td>${u.contractorPaid?'✅':'—'}</td><td>${U.fmtINR(u.amountEach)}</td><td>${u.unlockedAt?U.fmtDate(u.unlockedAt):'—'}</td></tr>`; }).join("") : `<tr><td colspan="5"><div class="empty-state">No contact unlock transactions yet.</div></td></tr>`}</tbody></table></div></div>
      <div class="card"><h3>Marketplace Connect Payments</h3>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Listing</th><th>Buyer</th><th>Paid</th></tr></thead>
      <tbody>${mp.length ? mp.map(m=>{ const l = DB.marketplaceListings.get(m.listingId); const b = DB.users.get(m.buyerId); return `<tr><td>${l?U.escapeHtml(l.title):'—'}</td><td>${b?U.escapeHtml(b.name):'—'}</td><td>${m.paid?'✅ Paid':'Pending'}</td></tr>`; }).join("") : `<tr><td colspan="3"><div class="empty-state">No marketplace transactions yet.</div></td></tr>`}</tbody></table></div></div>`;
  }

  function renderPricing(){
    document.getElementById("panelPricing").innerHTML = `
      <div class="card">
        <h3>Contact Unlock Pricing</h3>
        <div class="input-group">
          <div class="field"><label>Regular Price (₹)</label><input class="input" id="pRegular" type="number" value="${DB.settings.get('contactUnlockRegularPrice',999)}"></div>
          <div class="field"><label>Offer Price (₹, per side)</label><input class="input" id="pOffer" type="number" value="${DB.settings.get('contactUnlockOfferPrice',99)}"></div>
        </div>
        <h3 class="mt-4">Marketplace Connect Fee</h3>
        <label class="checkbox-row mb-2"><input type="checkbox" id="pMpEnabled" ${DB.settings.get('marketplaceFeeEnabled',false)?'checked':''}> Enable marketplace connect fee (currently ${DB.settings.get('marketplaceFeeEnabled',false)?'ON':'FREE'})</label>
        <div class="field"><label>Fee Amount (₹)</label><input class="input" id="pMpFee" type="number" value="${DB.settings.get('marketplaceFee',49)}"></div>
        <h3 class="mt-4">Platform Commission</h3>
        <div class="field"><label>Commission on Awarded Contracts (%)</label><input class="input" id="pCommission" type="number" value="${DB.settings.get('platformCommissionPct',2)}"></div>
        <button class="btn btn-primary mt-3" id="savePricingBtn">Save Settings</button>
      </div>`;
    document.getElementById("savePricingBtn").addEventListener("click", ()=>{
      DB.settings.set("contactUnlockRegularPrice", +document.getElementById("pRegular").value||999);
      DB.settings.set("contactUnlockOfferPrice", +document.getElementById("pOffer").value||99);
      DB.settings.set("marketplaceFeeEnabled", document.getElementById("pMpEnabled").checked);
      DB.settings.set("marketplaceFee", +document.getElementById("pMpFee").value||49);
      DB.settings.set("platformCommissionPct", +document.getElementById("pCommission").value||2);
      U.toast("Pricing settings saved.", {type:"success"});
    });
  }

  function renderAnalytics(){
    const byStatus = {};
    DB.tenders.list().forEach(t=> byStatus[t.status] = (byStatus[t.status]||0)+1);
    const max = Math.max(1, ...Object.values(byStatus));
    const workTypes = {};
    DB.tenders.list().forEach(t=> workTypes[t.workType] = (workTypes[t.workType]||0)+1);
    const maxWt = Math.max(1, ...Object.values(workTypes));
    document.getElementById("panelAnalytics").innerHTML = `
      <div class="grid grid-2">
        <div class="card"><h3>Tenders by Status</h3><div class="bar-chart">${Object.entries(byStatus).map(([k,v])=>`<div class="bar" style="height:${(v/max)*120+20}px"><span>${v}</span><div class="bar-label">${k}</div></div>`).join("")}</div></div>
        <div class="card"><h3>Tenders by Trade</h3><div class="bar-chart">${Object.entries(workTypes).map(([k,v])=>`<div class="bar" style="height:${(v/maxWt)*120+20}px;background:var(--sw-gradient-accent)"><span>${v}</span><div class="bar-label">${k}</div></div>`).join("")}</div></div>
      </div>
      <div class="card mt-4"><h3>Project Analytics</h3>
        <div class="grid grid-4">
          <div><b>${DB.projects.list().length}</b><div class="text-muted" style="font-size:12px">Total Projects</div></div>
          <div><b>${DB.projects.list(p=>p.status==='running').length}</b><div class="text-muted" style="font-size:12px">Running</div></div>
          <div><b>${DB.projects.list(p=>p.status==='completed').length}</b><div class="text-muted" style="font-size:12px">Completed</div></div>
          <div><b>${DB.hindrances.list(h=>h.status==='pending').length}</b><div class="text-muted" style="font-size:12px">Open Hindrances</div></div>
        </div>
      </div>`;
  }

  function renderFraud(){
    const users = DB.users.list();
    const phoneMap = {};
    users.forEach(u=>{ if(u.phone){ phoneMap[u.phone] = phoneMap[u.phone]||[]; phoneMap[u.phone].push(u); } });
    const flags = Object.values(phoneMap).filter(list=>list.length>1)
      .map(list=>`Multiple accounts share phone number ${list[0].phone}: ${list.map(u=>u.name).join(", ")}`);
    DB.tenders.list().forEach(t=>{
      if(t.estimatedValue>0){
        DB.bids.list(b=>b.tenderId===t.id).forEach(b=>{
          const total = DB.bidItems.list(bi=>bi.bidId===b.id).reduce((s,i)=>s+i.amount,0);
          if(total && total < t.estimatedValue*0.4) flags.push(`Suspiciously low bid (${U.fmtINR(total)}) vs estimate ${U.fmtINR(t.estimatedValue)} on "${t.title}" — possible lowballing.`);
        });
      }
    });
    document.getElementById("panelFraud").innerHTML = `<div class="card"><h3>Automated Fraud Flags</h3>${flags.length ? flags.map(f=>`<div class="fraud-flag">⚠️ ${U.escapeHtml(f)}</div>`).join("") : `<div class="empty-state">No fraud signals detected.</div>`}</div>`;
  }

  function renderAudit(){
    const logs = DB._store.auditLogs.slice().sort((a,b)=>new Date(b.at)-new Date(a.at)).slice(0,100);
    document.getElementById("panelAudit").innerHTML = `<div class="card"><h3>Platform Audit Log</h3><div class="table-wrap"><table class="dtable"><thead><tr><th>Time</th><th>Entity</th><th>Action</th><th>User</th></tr></thead>
      <tbody>${logs.map(l=>{ const u = DB.users.get(l.userId); return `<tr><td>${U.fmtDateTime(l.at)}</td><td>${l.entity}</td><td>${l.action}</td><td>${u?U.escapeHtml(u.name):'System'}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  }

  function renderSupport(){
    const tickets = DB.supportTickets.list().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const open = tickets.filter(t=>t.status==="open").length;
    document.getElementById("panelSupport").innerHTML = `
      <div class="card"><div class="flex justify-between items-center mb-3"><h3>Support Tickets</h3><span class="badge badge-warning">${open} open</span></div>
      <div class="table-wrap"><table class="dtable"><thead><tr><th>Subject</th><th>From</th><th>Category</th><th>Priority</th><th>Status</th><th>Raised</th><th></th></tr></thead>
      <tbody>${tickets.length ? tickets.map(t=>`<tr>
        <td>${U.escapeHtml(t.subject)}</td><td>${U.escapeHtml(t.userName)} <span class="badge badge-neutral">${SW.UI.roleLabel(t.userRole)}</span></td>
        <td>${U.escapeHtml(t.category)}</td><td><span class="badge ${t.priority==='Urgent'?'badge-danger':t.priority==='High'?'badge-warning':'badge-neutral'}">${t.priority}</span></td>
        <td><span class="badge ${t.status==='resolved'?'badge-success':t.status==='open'?'badge-warning':'badge-info'}">${t.status}</span></td>
        <td>${U.relativeTime(t.createdAt)}</td>
        <td><button class="btn btn-sm btn-outline" data-ticket="${t.id}">View / Reply</button></td>
      </tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">No support tickets yet.</div></td></tr>`}</tbody></table></div></div>`;
    document.getElementById("panelSupport").addEventListener("click", e=>{
      const btn = e.target.closest("[data-ticket]"); if(!btn) return;
      openTicket(btn.dataset.ticket);
    });
  }
  function openTicket(id){
    const t = DB.supportTickets.get(id);
    document.getElementById("ticketModalBody").innerHTML = `
      <p><b>${U.escapeHtml(t.subject)}</b></p>
      <p class="text-muted" style="font-size:12px">${U.escapeHtml(t.userName)} (${SW.UI.roleLabel(t.userRole)}) · ${t.category} · ${U.fmtDateTime(t.createdAt)}</p>
      <p class="mt-3">${U.escapeHtml(t.message)}</p>
      <div class="field mt-4"><label>Admin Reply</label><textarea class="textarea" id="ticketReply">${U.escapeHtml(t.adminReply||"")}</textarea></div>
      <div class="field"><label>Status</label><select class="select" id="ticketStatus">
        <option value="open" ${t.status==='open'?'selected':''}>Open</option>
        <option value="in_progress" ${t.status==='in_progress'?'selected':''}>In Progress</option>
        <option value="resolved" ${t.status==='resolved'?'selected':''}>Resolved</option>
      </select></div>`;
    document.getElementById("ticketModalFoot").innerHTML = `<button class="btn btn-primary" id="ticketSaveBtn">Save &amp; Notify User</button>`;
    U.openModal("ticketModal");
    document.getElementById("ticketSaveBtn").addEventListener("click", ()=>{
      const adminReply = document.getElementById("ticketReply").value.trim();
      const status = document.getElementById("ticketStatus").value;
      DB.supportTickets.update(t.id, {adminReply, status});
      DB.notifications.create({ userId:t.userId, title:"Support ticket update", body:`Your ticket "${t.subject}" is now ${status.replace("_"," ")}.`, read:false });
      U.toast("Ticket updated.", {type:"success"});
      U.closeModal("ticketModal"); renderSupport();
    });
  }

  function renderHindrance(){
    const lib = DB.hindranceLibrary.list().sort((a,b)=> (a.category||"").localeCompare(b.category)||(a.title||"").localeCompare(b.title));
    document.getElementById("panelHindrance").innerHTML = `
      <div class="card">
        <div class="flex justify-between items-center mb-3"><h3>Hindrance Library (${lib.length})</h3><button class="btn btn-primary btn-sm" id="hlAddBtn">+ Add Entry</button></div>
        <p class="text-muted" style="font-size:13px">Predefined delay/hindrance types used across EOT requests and project hindrance tabs. PM &amp; Contractor pick from this library when raising a hindrance; admins can add unlimited entries.</p>
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Category</th><th>Title</th><th>Responsible</th><th>Critical Path</th><th>Default Range</th><th>Risk</th><th></th></tr></thead>
        <tbody>${lib.length ? lib.map(l=>`<tr>
          <td><span class="badge badge-neutral">${U.escapeHtml(l.category)}</span></td>
          <td>${U.escapeHtml(l.title)}</td>
          <td>${U.escapeHtml(l.responsibleParty||"—")}</td>
          <td>${l.criticalPathImpact ? '<span class="badge badge-danger">Yes</span>' : '<span class="badge badge-neutral">No</span>'}</td>
          <td>${U.escapeHtml(l.defaultDelayRangeDays||"—")} days</td>
          <td><span class="badge ${l.riskLevel==='High'?'badge-danger':l.riskLevel==='Medium'?'badge-warning':'badge-success'}">${l.riskLevel||"—"}</span></td>
          <td><button class="btn btn-sm btn-outline" data-hl-edit="${l.id}">Edit</button> <button class="btn btn-sm btn-danger" data-hl-delete="${l.id}">Delete</button></td>
        </tr>`).join("") : `<tr><td colspan="7"><div class="empty-state">No hindrance library entries yet.</div></td></tr>`}</tbody></table></div>
      </div>`;
  }
  document.getElementById("panelHindrance").addEventListener("click", e=>{
    const addBtn = e.target.closest("#hlAddBtn"); if(addBtn){ openHlModal(null); return; }
    const editBtn = e.target.closest("[data-hl-edit]"); if(editBtn){ openHlModal(editBtn.dataset.hlEdit); return; }
    const delBtn = e.target.closest("[data-hl-delete]");
    if(delBtn){
      if(confirm("Delete this hindrance library entry?")){
        DB.hindranceLibrary.remove(delBtn.dataset.hlDelete);
        U.toast("Hindrance library entry deleted.", {type:"success"});
        renderHindrance();
      }
    }
  });
  function openHlModal(id){
    const l = id ? DB.hindranceLibrary.get(id) : null;
    document.getElementById("hlModalTitle").textContent = l ? "Edit Hindrance Library Entry" : "Add Hindrance Library Entry";
    document.getElementById("hlId").value = l ? l.id : "";
    document.getElementById("hlCategory").value = l ? l.category : "Civil";
    document.getElementById("hlTitle").value = l ? l.title : "";
    document.getElementById("hlDescription").value = l ? l.description||"" : "";
    document.getElementById("hlRootCause").value = l ? l.rootCause||"" : "";
    document.getElementById("hlImpact").value = l ? l.impact||"" : "";
    document.getElementById("hlRecoveryMethod").value = l ? l.recoveryMethod||"" : "";
    document.getElementById("hlEvidenceRequired").value = l ? l.evidenceRequired||"" : "";
    document.getElementById("hlResponsibleParty").value = l ? l.responsibleParty||"PM" : "PM";
    document.getElementById("hlCriticalPathImpact").value = l ? String(!!l.criticalPathImpact) : "true";
    document.getElementById("hlDefaultDelayRangeDays").value = l ? l.defaultDelayRangeDays||"" : "";
    document.getElementById("hlRiskLevel").value = l ? l.riskLevel||"Medium" : "Medium";
    document.getElementById("hlMitigation").value = l ? l.mitigation||"" : "";
    U.openModal("hlModal");
  }
  document.getElementById("hlSaveBtn").addEventListener("click", ()=>{
    const title = document.getElementById("hlTitle").value.trim();
    if(!title){ U.toast("Title is required.", {type:"danger"}); return; }
    const payload = {
      category: document.getElementById("hlCategory").value,
      title,
      description: document.getElementById("hlDescription").value.trim(),
      rootCause: document.getElementById("hlRootCause").value.trim(),
      impact: document.getElementById("hlImpact").value.trim(),
      recoveryMethod: document.getElementById("hlRecoveryMethod").value.trim(),
      evidenceRequired: document.getElementById("hlEvidenceRequired").value.trim(),
      responsibleParty: document.getElementById("hlResponsibleParty").value,
      criticalPathImpact: document.getElementById("hlCriticalPathImpact").value==="true",
      defaultDelayRangeDays: document.getElementById("hlDefaultDelayRangeDays").value.trim(),
      riskLevel: document.getElementById("hlRiskLevel").value,
      mitigation: document.getElementById("hlMitigation").value.trim()
    };
    const id = document.getElementById("hlId").value;
    if(id) DB.hindranceLibrary.update(id, payload);
    else DB.hindranceLibrary.create(payload);
    U.toast(id?"Hindrance library entry updated.":"Hindrance library entry added.", {type:"success"});
    U.closeModal("hlModal");
    renderHindrance();
  });

  renderKPIs(); renderApprovals(); renderPayments(); renderPricing(); renderAnalytics(); renderFraud(); renderSupport(); renderHindrance(); renderAudit();
  U.initTabs();

  SW.UI.helpSection(document.querySelector(".app-content"), "Admin Panel", [
    "Approve or reject newly registered contractor accounts before they can bid on tenders.",
    "Track every contact-unlock (₹99) and marketplace connect (₹49) payment across the platform.",
    "Change the contact unlock offer price, marketplace fee (default off/free) and platform commission at any time — changes apply platform-wide immediately.",
    "Fraud Detection flags shared phone numbers across accounts and unusually low bids as early warning signals.",
    "Manage the Hindrance Library — add unlimited predefined delay/hindrance types with root cause, impact, evidence and recovery guidance used across every project's Hindrance tab and EOT requests.",
    "The Audit Log gives a full trail of every create/update/delete action for compliance."
  ]);
})();
