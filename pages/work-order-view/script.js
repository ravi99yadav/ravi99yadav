(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active: rawUser.role==="pm"?"pm-tenders":"contractor-tenders" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, isPM = user.role==="pm";

  const params = new URLSearchParams(location.search);
  const wo = DB.workOrders.get(params.get("id"));
  if(!wo){ document.querySelector(".app-content").innerHTML = `<div class="empty-state">Work Order not found.</div>`; return; }
  const tender = DB.tenders.get(wo.tenderId);
  const pm = DB.users.get(wo.pmId);
  const contractor = DB.users.get(wo.contractorId);
  const pmCompany = DB.companies.list(c=>c.ownerId===pm.id)[0]||{};
  const loi = DB.lois.get(wo.loiId);
  const project = DB.projects.list(p=>p.tenderId===tender.id)[0];
  document.getElementById("openProjectBtn").href = project ? "../project-workspace/index.html?id="+project.id : "#";

  function render(){
    document.getElementById("woDoc").innerHTML = `
      <div class="doc-watermark">WORK ORDER</div>
      <div class="doc-letterhead">
        <div class="lh-logo"><span class="mark">SW</span> ${U.escapeHtml(pmCompany.name||"SubletWorks Client")}</div>
        <div class="lh-meta">${U.escapeHtml(pmCompany.gst||"")}<br>${U.escapeHtml(pmCompany.district||"")}, ${U.escapeHtml(pmCompany.state||"")}</div>
      </div>
      <div class="doc-title">Work Order</div>
      <p style="font-size:13px"><b>WO No:</b> ${wo.woNo} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(wo.issuedAt)} &nbsp;|&nbsp; <b>Ref LOI:</b> ${loi?loi.loiNo:"—"} &nbsp;|&nbsp; <b>Version:</b> v${wo.version||1}</p>
      <div class="doc-section"><h4>Issued To</h4><p>${U.escapeHtml(contractor.name)}</p></div>
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="scopeBlock"><h4>Scope of Work</h4><p>${U.escapeHtml(wo.scope||tender.description||"—")}</p></div>
      <div class="doc-section"><h4>Commercial Terms</h4><table class="doc-table">
        <tr><th style="width:220px">Contract Value</th><td><b>${U.fmtINR(loi?loi.contractValue:tender.estimatedValue)}</b></td></tr>
        <tr><th>Payment Terms</th><td>${U.escapeHtml(tender.paymentTerms||"—")}</td></tr>
        <tr><th>Retention</th><td>${wo.retentionPct||0}%</td></tr>
        <tr><th>Bank Guarantee</th><td>${wo.bgPct||0}%</td></tr>
        <tr><th>Completion Date</th><td>${U.fmtDate(tender.endDate)}</td></tr>
      </table></div>
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="penaltyBlock"><h4>Penalty for Delay</h4><p>${U.escapeHtml(wo.penaltyClause||"—")}</p></div>
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="warrantyBlock"><h4>Warranty / Defect Liability</h4><p>${U.escapeHtml(wo.warranty||"—")}</p></div>
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="safetyBlock"><h4>Safety Requirements</h4><p>${U.escapeHtml(wo.safety||"—")}</p></div>
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="insuranceBlock"><h4>Insurance</h4><p>${U.escapeHtml(wo.insurance||"—")}</p></div>
      <div class="doc-signoff">
        <div><div class="sig-line">${U.escapeHtml(pm.name)}<br>For ${U.escapeHtml(pmCompany.name||"Client")}</div></div>
        <div><div class="doc-qr" title="Scan to verify on SubletWorks.com"></div><div style="font-size:10px;margin-top:4px">Scan to verify</div></div>
        <div><div class="sig-line">${U.escapeHtml(contractor.name)}<br>Contractor</div></div>
      </div>
      <div class="doc-footer"><span>Generated via SubletWorks.com</span><span>Revision ${wo.version||1}</span><span>Page 1 of 1</span></div>`;
  }
  render();

  document.getElementById("portraitBtn").addEventListener("click", ()=>{ document.getElementById("printModeWrap").className="print-portrait"; setActive("portraitBtn"); });
  document.getElementById("landscapeBtn").addEventListener("click", ()=>{ document.getElementById("printModeWrap").className="print-landscape"; setActive("landscapeBtn"); });
  function setActive(id){ ["portraitBtn","landscapeBtn"].forEach(b=> document.getElementById(b).classList.toggle("active", b===id)); }

  let editing=false;
  document.getElementById("editBtn").addEventListener("click", ()=>{
    if(!isPM){ U.toast("Only the Project Manager can edit the Work Order.", {type:"danger"}); return; }
    editing = !editing;
    const btn = document.getElementById("editBtn");
    if(editing) btn.textContent="💾 Save Changes";
    else {
      DB.workOrders.update(wo.id, {
        scope: document.getElementById("scopeBlock").querySelector("p").textContent,
        penaltyClause: document.getElementById("penaltyBlock").querySelector("p").textContent,
        warranty: document.getElementById("warrantyBlock").querySelector("p").textContent,
        safety: document.getElementById("safetyBlock").querySelector("p").textContent,
        insurance: document.getElementById("insuranceBlock").querySelector("p").textContent
      });
      btn.textContent="✎ Edit";
      U.toast("Work Order updated — new version saved.", {type:"success"});
    }
  });
  document.getElementById("printBtn").addEventListener("click", ()=> window.print());
  document.getElementById("historyBtn").addEventListener("click", ()=>{
    const logs = DB.auditFor("workOrders", wo.id);
    document.getElementById("historyList").innerHTML = logs.length ? logs.map(l=>`<div class="timeline-item"><div class="ti-time">${U.fmtDateTime(l.at)}</div><b>${l.action}</b></div>`).join("") : `<div class="empty-state">No edits yet.</div>`;
    U.openModal("historyModal");
  });

  SW.UI.helpSection(document.querySelector(".app-content"), "Work Order", [
    "The Work Order is generated from the accepted LOI and carries scope, penalty, warranty, safety and insurance clauses.",
    "Project Managers can edit any clause inline — each save is versioned and visible in Version History.",
    "Once issued, open the linked Project Workspace to start planning with Gantt, Kanban, MB Sheet and RA Billing."
  ]);
})();
