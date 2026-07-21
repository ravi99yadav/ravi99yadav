(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active: rawUser.role==="pm"?"pm-tenders":"contractor-tenders" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, isPM = user.role==="pm";

  const params = new URLSearchParams(location.search);
  const loi = DB.lois.get(params.get("id"));
  if(!loi){ document.querySelector(".app-content").innerHTML = `<div class="empty-state">LOI not found.</div>`; return; }
  const tender = DB.tenders.get(loi.tenderId);
  const bid = DB.bids.get(loi.bidId);
  const pm = DB.users.get(loi.pmId);
  const contractor = DB.users.get(loi.contractorId);
  const pmCompany = DB.companies.list(c=>c.ownerId===pm.id)[0]||{};
  const items = DB.boqItems.list(i=>i.tenderId===tender.id);
  const bidItems = DB.bidItems.list(bi=>bi.bidId===bid.id);

  function render(){
    document.getElementById("loiDoc").innerHTML = `
      <div class="doc-watermark">${tender.status==="awarded"?"ISSUED":"DRAFT"}</div>
      <div class="doc-letterhead">
        <div class="lh-logo"><span class="mark">SW</span> ${U.escapeHtml(pmCompany.name||"SubletWorks Client")}</div>
        <div class="lh-meta">${U.escapeHtml(pmCompany.gst||"")}<br>${U.escapeHtml(pmCompany.district||"")}, ${U.escapeHtml(pmCompany.state||"")}</div>
      </div>
      <div class="doc-title">Letter of Intent</div>
      <p style="font-size:13px"><b>LOI No:</b> ${loi.loiNo} &nbsp;|&nbsp; <b>Date:</b> ${U.fmtDate(loi.issuedAt)} &nbsp;|&nbsp; <b>Version:</b> v${loi.version||1}</p>
      <div class="doc-section"><h4>To</h4><p ${isPM?'contenteditable="true" class="editable-region"':""} id="toBlock">${U.escapeHtml(contractor.name)}<br>${U.escapeHtml(loi.contractorAddress||"Address on file with SubletWorks")}</p></div>
      <div class="doc-section"><h4>Subject</h4><p>Letter of Intent for award of work: <b>${U.escapeHtml(tender.title)}</b> at ${U.escapeHtml(tender.district)}, ${U.escapeHtml(tender.state)}.</p></div>
      <div class="doc-section">
        <h4>Project & Contract Summary</h4>
        <table class="doc-table">
          <tr><th style="width:220px">Project</th><td>${U.escapeHtml(tender.title)}</td></tr>
          <tr><th>Scope</th><td>${U.escapeHtml(tender.description||"—")}</td></tr>
          <tr><th>Contract Value</th><td><b>${U.fmtINR(loi.contractValue)}</b> (${bid.mode})</td></tr>
          <tr><th>Payment Terms</th><td>${U.escapeHtml(tender.paymentTerms||"—")}</td></tr>
          <tr><th>Retention / BG / SD</th><td>${tender.retentionPct||0}% / ${tender.bgRequiredPct||0}% / ${tender.securityDepositPct||0}%</td></tr>
          <tr><th>Expected Completion</th><td>${U.fmtDate(tender.endDate)}</td></tr>
        </table>
      </div>
      ${items.length ? `<div class="doc-section"><h4>BOQ Summary</h4><table class="doc-table"><thead><tr><th>Sr</th><th>Description</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
        <tbody>${items.map(it=>{ const bi=bidItems.find(x=>x.boqItemId===it.id)||{rate:0,amount:0}; return `<tr><td>${it.srNo}</td><td>${U.escapeHtml(it.description)}</td><td>${it.unit}</td><td>${it.qty}</td><td>${U.fmtINR(bi.rate)}</td><td>${U.fmtINR(bi.amount)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}
      <div class="doc-section" ${isPM?'contenteditable="true" class="editable-region"':""} id="termsBlock">
        <h4>Additional Terms</h4>
        <p>${U.escapeHtml(loi.additionalTerms || "This LOI confirms our intent to award the above work to you subject to execution of a formal Work Order. Please acknowledge acceptance within 3 working days.")}</p>
      </div>
      <div class="doc-signoff">
        <div><div class="sig-line">${U.escapeHtml(pm.name)}<br>For ${U.escapeHtml(pmCompany.name||"Client")}</div></div>
        <div><div class="doc-qr" title="Scan to verify on SubletWorks.com"></div><div style="font-size:10px;margin-top:4px">Scan to verify</div></div>
        <div><div class="sig-line">${U.escapeHtml(contractor.name)}<br>Contractor Acceptance</div></div>
      </div>
      <div class="doc-footer"><span>Generated via SubletWorks.com</span><span>Revision ${loi.version||1}</span><span>Page 1 of 1</span></div>`;
  }
  render();

  document.getElementById("portraitBtn").addEventListener("click", ()=>{ document.getElementById("printModeWrap").className="print-portrait"; setActive("portraitBtn"); });
  document.getElementById("landscapeBtn").addEventListener("click", ()=>{ document.getElementById("printModeWrap").className="print-landscape"; setActive("landscapeBtn"); });
  function setActive(id){ ["portraitBtn","landscapeBtn"].forEach(b=> document.getElementById(b).classList.toggle("active", b===id)); }

  let editing = false;
  document.getElementById("editBtn").addEventListener("click", ()=>{
    editing = !editing;
    const btn = document.getElementById("editBtn");
    if(!isPM){ U.toast("Only the Project Manager can edit the LOI.", {type:"danger"}); return; }
    if(editing){ btn.textContent="💾 Save Changes"; }
    else {
      const additionalTerms = document.getElementById("termsBlock").querySelector("p").textContent;
      DB.lois.update(loi.id, { additionalTerms });
      btn.textContent="✎ Edit";
      U.toast("LOI updated — new version saved.", {type:"success"});
    }
  });

  document.getElementById("printBtn").addEventListener("click", ()=> window.print());

  document.getElementById("historyBtn").addEventListener("click", ()=>{
    const logs = DB.auditFor("lois", loi.id);
    document.getElementById("historyList").innerHTML = logs.length ? logs.map(l=>`<div class="timeline-item"><div class="ti-time">${U.fmtDateTime(l.at)}</div><b>${l.action}</b></div>`).join("") : `<div class="empty-state">No edits yet.</div>`;
    U.openModal("historyModal");
  });

  const woExisting = DB.workOrders.list(w=>w.loiId===loi.id)[0];
  const genBtn = document.getElementById("genWOBtn");
  if(isPM && !woExisting){
    genBtn.classList.remove("hidden");
    genBtn.addEventListener("click", ()=>{
      const wo = DB.workOrders.create({ tenderId:tender.id, loiId:loi.id, pmId:pm.id, contractorId:contractor.id,
        woNo:"SW/WO/"+new Date().getFullYear()+"/"+String(DB._store.workOrders.length+1).padStart(4,"0"),
        issuedAt:DB.nowISO(), status:"issued", scope:tender.description, penaltyClause:"0.5% of contract value per week of delay, max 10%.",
        warranty:"12 months defect liability period.", safety:"Contractor to comply with all site safety norms & provide PPE.",
        insurance:"Contractor to maintain CAR/WC policy for full contract duration.", retentionPct:tender.retentionPct||0, bgPct:tender.bgRequiredPct||0 });
      let proj = DB.projects.list(p=>p.tenderId===tender.id)[0];
      if(!proj) proj = DB.projects.create({ tenderId:tender.id, workOrderId:wo.id, name:tender.title, pmId:pm.id, contractorId:contractor.id, district:tender.district, state:tender.state, startDate:tender.startDate, endDate:tender.endDate, status:"running", progressPct:0 });
      DB.notifications.create({ userId:contractor.id, title:"Work Order issued", body:`Work Order ${wo.woNo} issued for "${tender.title}".`, read:false, link:"/pages/work-order-view/index.html?id="+wo.id });
      U.toast("Work Order generated.", {title:"Success", type:"success"});
      setTimeout(()=> location.href = "../work-order-view/index.html?id="+wo.id, 700);
    });
  }

  SW.UI.helpSection(document.querySelector(".app-content"), "Letter of Intent", [
    "This LOI is auto-populated from the accepted bid — project, BOQ, contract value and terms all pull from your tender data.",
    "The Project Manager can edit the addressee and additional terms inline; every save creates a new version visible in Version History.",
    "Use Portrait/Landscape to change print orientation, then Print / Save PDF using your browser's print dialog.",
    "Once both parties are satisfied, generate the Work Order directly from this LOI."
  ]);
})();
