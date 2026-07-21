(function(){
  "use strict";
  const rawUser = SW.Auth.requireRole(["pm","contractor"]);
  if(!rawUser) return;
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active: rawUser.role==="pm"?"pm-tenders":"contractor-tenders" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils, isPM = user.role==="pm";

  const params = new URLSearchParams(location.search);
  const tenderId = params.get("id");
  let tender = tenderId ? DB.tenders.get(tenderId) : null;
  if(!tender){
    document.querySelector(".app-content").innerHTML = `<div class="empty-state"><div class="es-icon">🔍</div>Tender not found. <a href="${isPM?'../pm-tenders/index.html':'../contractor-tenders/index.html'}">Go back →</a></div>`;
    return;
  }
  // Data isolation: a PM can only manage their own tenders; a contractor can only view
  // tenders that have actually been published (not another PM's private draft).
  if((isPM && tender.pmId!==user.id) || (!isPM && tender.status==="draft")){
    SW.UI.render403("This tender isn't available to your account.", isPM?'../pm-tenders/index.html':'../contractor-tenders/index.html', "Go Back");
    return;
  }
  SW.UI.contextBar(document.querySelector(".app-content"), {
    entity:"tenders", entityId:tender.id,
    status: tender.status, statusLabel: (tender.status||"").replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase()),
    permission: SW.UI.roleLabel(user.role) + (isPM ? " · Owner" : " · Bidder"),
    version: tender.version, updatedAt: tender.updatedAt
  });
  let selectedBidId = null;

  function boqItems(){ return DB.boqItems.list(i=>i.tenderId===tender.id).sort((a,b)=>a.srNo-b.srNo); }
  function bidTotal(bid){
    if(bid.mode==="lumpsum") return bid.lumpsumAmount||0;
    if(bid.mode==="percentage") return tender.estimatedValue * (1 + (bid.percentageValue||0)/100);
    const items = DB.bidItems.list(bi=>bi.bidId===bid.id);
    return items.reduce((s,i)=>s+(i.amount||0),0);
  }
  function rankedBids(){
    const bids = DB.bids.list(b=>b.tenderId===tender.id && b.status!=="withdrawn");
    return bids.map(b=>({ bid:b, total: bidTotal(b) })).sort((a,b)=>a.total-b.total);
  }
  function rankLabel(idx){ return idx===0?"L1":idx===1?"L2":idx===2?"L3":"L"+(idx+1); }
  function rankClass(idx){ return idx===0?"rank-l1":idx===1?"rank-l2":idx===2?"rank-l3":"rank-other"; }
  function myBid(){ return DB.bids.list(b=>b.tenderId===tender.id && b.contractorId===user.id)[0]; }
  function unlock(){ return DB.contactUnlocks.list(c=>c.tenderId===tender.id)[0]; }

  function statusBadge(status){
    const map = { submitted:"badge-info", revision_requested:"badge-warning", pm_accepted:"badge-accent", mutually_accepted:"badge-success", rejected:"badge-danger", not_selected:"badge-neutral", withdrawn:"badge-neutral" };
    const label = { submitted:"Submitted", revision_requested:"Revision Requested", pm_accepted:"Accepted by PM — awaiting your confirmation", mutually_accepted:"Mutually Accepted", rejected:"Rejected", not_selected:"Not Selected", withdrawn:"Withdrawn by You" };
    return `<span class="badge ${map[status]||'badge-neutral'}">${label[status]||status}</span>`;
  }

  /* ============================= HEADER ============================= */
  function renderHeader(){
    const daysLeft = tender.bidSubmissionDeadline ? U.daysBetween(new Date(), tender.bidSubmissionDeadline) : null;
    document.getElementById("tenderHeader").innerHTML = `
      <div class="flex justify-between items-start mb-4" style="flex-wrap:wrap;gap:14px">
        <div>
          <div class="flex items-center gap-2 mb-2"><h1 style="margin:0">${U.escapeHtml(tender.title)}</h1><span class="badge badge-info">${tender.workType}</span><span class="badge badge-neutral">${tender.status}</span></div>
          <p class="text-muted">${U.escapeHtml(tender.district)}, ${U.escapeHtml(tender.state)} · Est. value ${U.fmtINR(tender.estimatedValue)} ${daysLeft!==null ? `· ${daysLeft>=0? daysLeft+' day(s) left to bid':'Bidding closed'}` : ""}</p>
        </div>
        ${isPM ? `<a href="../tender-wizard/index.html?id=${tender.id}" class="btn btn-outline btn-sm">Edit Tender</a>` : ""}
      </div>`;
  }

  /* ============================= UNLOCK BANNER ============================= */
  function renderUnlockBanner(){
    const slot = document.getElementById("unlockBannerSlot");
    const mutuallyAccepted = DB.bids.list(b=>b.tenderId===tender.id && b.status==="mutually_accepted")[0];
    if(!mutuallyAccepted){ slot.innerHTML=""; return; }
    let u = unlock();
    if(!u) u = DB.contactUnlocks.create({ tenderId:tender.id, pmPaid:false, contractorPaid:false, amountEach:DB.settings.get("contactUnlockOfferPrice",99) });
    const myPaid = isPM ? u.pmPaid : u.contractorPaid;
    const bothPaid = u.pmPaid && u.contractorPaid;
    if(bothPaid){
      const other = isPM ? DB.users.get(mutuallyAccepted.contractorId) : DB.users.get(tender.pmId);
      slot.innerHTML = `<div class="card" style="border-left:4px solid var(--sw-success)">
        <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:10px">
          <div><b>🔓 Contact Unlocked</b><div class="text-muted" style="font-size:13px">You can now reach ${U.escapeHtml(other.name)} directly.</div></div>
          <div class="flex gap-4 items-center">
            <span>📞 ${U.escapeHtml(other.phone)}</span><span>✉️ ${U.escapeHtml(other.email)}</span>
            ${isPM && !DB.lois.list(l=>l.bidId===mutuallyAccepted.id).length ? `<button class="btn btn-primary btn-sm" id="genLoiBtn">Generate LOI →</button>` : ""}
            ${DB.lois.list(l=>l.bidId===mutuallyAccepted.id).length ? `<a class="btn btn-outline btn-sm" href="../loi-view/index.html?id=${DB.lois.list(l=>l.bidId===mutuallyAccepted.id)[0].id}">View LOI</a>` : ""}
          </div>
        </div></div>`;
      document.getElementById("genLoiBtn")?.addEventListener("click", ()=> generateLOI(mutuallyAccepted));
    } else {
      slot.innerHTML = `<div class="unlock-banner">
        <div><div style="font-weight:700">Both sides accepted the terms 🎉</div><div style="font-size:13px;opacity:.9">Pay the one-time fee to unlock direct phone, chat &amp; email for this project.</div>
        <div class="unlock-price mt-2"><span class="old">₹999</span><span class="new">₹99</span></div></div>
        <div>${myPaid ? `<span class="badge" style="background:rgba(255,255,255,.3);color:#fff">✓ You've paid — waiting for the other side</span>` : `<button class="btn" style="background:#fff;color:var(--sw-primary)" id="unlockPayBtn">Pay ₹99 to Unlock</button>`}</div>
      </div>`;
      document.getElementById("unlockPayBtn")?.addEventListener("click", ()=> U.openModal("payModal"));
    }
  }
  document.getElementById("payNowBtn").addEventListener("click", ()=>{
    let u = unlock();
    const patch = isPM ? {pmPaid:true} : {contractorPaid:true};
    u = DB.contactUnlocks.update(u.id, patch);
    if(u.pmPaid && u.contractorPaid){ DB.contactUnlocks.update(u.id, {unlockedAt:DB.nowISO()}); U.confetti(); U.toast("Both sides have paid — contact details are now unlocked!", {title:"🎉 Unlocked", type:"success"}); }
    else U.toast("Payment received. Waiting for the other party to pay ₹99 too.", {type:"success"});
    U.closeModal("payModal"); renderUnlockBanner();
  });

  function generateLOI(bid){
    const contractor = DB.users.get(bid.contractorId);
    const loi = DB.lois.create({ tenderId:tender.id, bidId:bid.id, pmId:tender.pmId, contractorId:bid.contractorId,
      loiNo:"SW/LOI/"+new Date().getFullYear()+"/"+String(DB._store.lois.length+1).padStart(4,"0"),
      contractValue: bidTotal(bid), issuedAt:DB.nowISO(), status:"issued" });
    DB.tenders.update(tender.id, { status:"awarded", awardedTo:bid.contractorId });
    DB.notifications.create({ userId:contractor.id, title:"Letter of Intent issued", body:`LOI ${loi.loiNo} has been generated for "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
    U.toast("LOI generated successfully.", {title:"Success", type:"success"});
    setTimeout(()=> location.href = "../loi-view/index.html?id="+loi.id, 800);
  }

  /* ============================= OVERVIEW ============================= */
  function renderOverview(){
    document.getElementById("panelOverview").innerHTML = `
      <div class="grid" style="grid-template-columns:2fr 1fr;gap:20px">
        <div class="card"><h3>Scope Description</h3><p>${U.escapeHtml(tender.description||"—")}</p>
          <h3 class="mt-4">Technical Specification</h3><p>${U.escapeHtml(tender.techSpec||"Not specified.")}</p>
          <h3 class="mt-4">Milestones</h3>
          ${(tender.milestones||[]).length ? `<div class="timeline">${tender.milestones.map(m=>`<div class="timeline-item"><div class="ti-time">${U.fmtDate(m.date)}</div>${U.escapeHtml(m.name)}</div>`).join("")}</div>` : `<p class="text-muted">No milestones defined.</p>`}
        </div>
        <div class="card">
          <h3>Commercial Terms</h3>
          <div class="review-row" style="display:flex;justify-content:space-between;padding:6px 0"><span>Payment Terms</span></div>
          <p style="font-size:13px">${U.escapeHtml(tender.paymentTerms||"—")}</p>
          <div class="review-row" style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Retention</span><b>${tender.retentionPct||0}%</b></div>
          <div class="review-row" style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Bank Guarantee</span><b>${tender.bgRequiredPct||0}%</b></div>
          <div class="review-row" style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Security Deposit</span><b>${tender.securityDepositPct||0}%</b></div>
          <div class="review-row" style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span>Bid Deadline</span><b>${U.fmtDate(tender.bidSubmissionDeadline)}</b></div>
        </div>
      </div>`;
  }

  /* ============================= BOQ TAB ============================= */
  function renderBoq(){
    const items = boqItems();
    document.getElementById("panelBoq").innerHTML = `
      <div class="table-wrap">
        <table class="dtable"><thead><tr><th>Sr</th><th>Description</th><th>Unit</th><th>Qty</th></tr></thead>
        <tbody>${items.length ? items.map(i=>`<tr><td>${i.srNo}</td><td>${U.escapeHtml(i.description)}</td><td>${i.unit}</td><td>${i.qty}</td></tr>`).join("") : `<tr><td colspan="4"><div class="empty-state">This tender is Lump Sum only — no item-wise BOQ.</div></td></tr>`}</tbody></table>
      </div>`;
  }

  /* ============================= BIDS TAB ============================= */
  function renderBids(){
    if(isPM) renderBidsPM(); else renderBidsContractor();
  }

  function renderBidsPM(){
    const ranked = rankedBids();
    document.getElementById("bidsTabBtn").textContent = "Bids ("+ranked.length+")";
    if(!ranked.length){ document.getElementById("panelBids").innerHTML = `<div class="empty-state"><div class="es-icon">⚖️</div>No bids received yet.</div>`; return; }
    const exportRow = `<div class="flex justify-between items-center mb-3"><span class="text-muted" style="font-size:13px">Ranked by total bid value (lowest = L1)</span><button class="btn btn-outline btn-sm" id="exportBidsBtn">⬇ Export Comparison CSV</button></div>`;
    document.getElementById("panelBids").innerHTML = exportRow + ranked.map((r,idx)=>{
      const bid=r.bid, contractor=DB.users.get(bid.contractorId), company=DB.companies.list(c=>c.ownerId===contractor.id)[0]||{};
      const expanded = selectedBidId===bid.id;
      return `<div class="bid-card ${expanded?'expanded':''}" data-bid="${bid.id}">
        <div class="bc-head" data-toggle="${bid.id}">
          <div class="flex items-center gap-3">
            <span class="rank-badge ${rankClass(idx)}">${rankLabel(idx)}</span>
            <div><b>${U.escapeHtml(company.name||contractor.name)}</b><div class="text-muted" style="font-size:12px">★ ${(company.rating||4).toFixed(1)} · ${company.experienceYears||0} yrs exp · ${bid.mode}</div></div>
          </div>
          <div class="flex items-center gap-3">
            <b style="font-size:18px">${U.fmtINR(r.total)}</b>
            ${statusBadge(bid.status)}
          </div>
        </div>
        ${expanded ? renderBidDetailPM(bid) : ""}
      </div>`;
    }).join("");
  }

  function renderBidDetailPM(bid){
    const items = boqItems();
    const bidItemsList = DB.bidItems.list(bi=>bi.bidId===bid.id);
    const comments = DB.comments.list(c=>c.bidId===bid.id && !c.boqItemId).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    const canAct = bid.status==="submitted" || bid.status==="revision_requested";
    return `
      <div class="mt-4">
        <p style="font-size:13px" class="mb-2"><b>Technical remarks:</b> ${U.escapeHtml(bid.technicalRemarks||"—")}</p>
        ${bid.mode==="item-wise" ? `
        <div class="table-wrap mb-3"><table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Rate</th><th>Amount</th><th></th></tr></thead>
        <tbody>${items.map(it=>{
          const bi = bidItemsList.find(x=>x.boqItemId===it.id) || {rate:0,amount:0};
          const remark = DB.comments.list(c=>c.bidId===bid.id && c.boqItemId===it.id).slice(-1)[0];
          return `<tr><td>${U.escapeHtml(it.description)}${remark?`<div class="item-remark">💬 ${U.escapeHtml(remark.text)}</div>`:""}</td><td>${it.unit}</td><td>${it.qty}</td><td>${U.fmtINR(bi.rate)}</td><td>${U.fmtINR(bi.amount)}</td>
          <td><button class="btn btn-icon btn-ghost" data-item-remark="${it.id}" data-bid="${bid.id}" title="Add remark">💬</button></td></tr>`;
        }).join("")}</tbody></table></div>` : `<p><b>Bid Amount:</b> ${U.fmtINR(bidTotal(bid))} (${bid.mode})</p>`}

        <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
          ${canAct ? `<button class="btn btn-success btn-sm" data-accept="${bid.id}">Accept Bid</button>
          <button class="btn btn-danger btn-sm" data-reject="${bid.id}">Reject</button>
          <button class="btn btn-warning btn-sm" data-revise="${bid.id}">Request Revision</button>` : ""}
          ${bid.status==="pm_accepted" ? `<span class="text-muted" style="font-size:13px">Waiting for contractor to confirm acceptance…</span>` : ""}
        </div>

        <h4>Negotiation</h4>
        <div class="chat-window" style="height:300px">
          <div class="chat-messages" id="chatMsgs-${bid.id}">${comments.map(c=>chatBubble(c)).join("") || `<p class="text-muted text-center mt-4">No messages yet. Start the conversation.</p>`}</div>
          <div class="chat-input-row"><input class="input" placeholder="Write a message… (contact details are auto-hidden)" id="chatInput-${bid.id}"><button class="btn btn-primary" data-send="${bid.id}">Send</button></div>
        </div>
      </div>`;
  }

  function chatBubble(c){
    const mine = c.authorId===user.id;
    return `<div class="chat-bubble ${mine?'me':'them'}"><div>${SW.Mask.maskToHtml(c.text, U.escapeHtml)}</div><div style="font-size:10px;opacity:.7;margin-top:4px">${U.relativeTime(c.createdAt)}</div></div>`;
  }

  function renderBidsContractor(){
    const bid = myBid();
    document.getElementById("bidsTabBtn").textContent = "My Bid";
    if(!bid){ document.getElementById("panelBids").innerHTML = renderBidForm(); bindBidForm(); return; }
    const items = boqItems();
    const bidItemsList = DB.bidItems.list(bi=>bi.bidId===bid.id);
    const comments = DB.comments.list(c=>c.bidId===bid.id && !c.boqItemId).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
    const canRevise = bid.status==="revision_requested";
    const canWithdraw = ["submitted","revision_requested"].includes(bid.status);
    document.getElementById("panelBids").innerHTML = `
      <div class="card">
        <div class="flex justify-between items-center mb-3"><h3>Your Bid</h3>${statusBadge(bid.status)}</div>
        ${bid.mode==="item-wise" ? `<div class="table-wrap mb-3"><table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Rate ${canRevise?'(editable)':''}</th><th>Amount</th></tr></thead>
        <tbody>${items.map(it=>{
          const bi = bidItemsList.find(x=>x.boqItemId===it.id) || {rate:0,amount:0};
          const remark = DB.comments.list(c=>c.bidId===bid.id && c.boqItemId===it.id).slice(-1)[0];
          return `<tr><td>${U.escapeHtml(it.description)}${remark?`<div class="item-remark">💬 PM: ${U.escapeHtml(remark.text)}</div>`:""}</td><td>${it.unit}</td><td>${it.qty}</td>
          <td>${canRevise? `<input class="input" data-revise-rate="${it.id}" value="${bi.rate}" style="max-width:110px">` : U.fmtINR(bi.rate)}</td><td>${U.fmtINR(bi.amount)}</td></tr>`;
        }).join("")}</tbody></table></div>
        <b>Total: ${U.fmtINR(bidTotal(bid))}</b>` : `<p><b>Bid Amount:</b> ${U.fmtINR(bidTotal(bid))} (${bid.mode})</p>`}
        <div class="flex gap-2 mt-3">
          ${canRevise ? `<button class="btn btn-primary" id="resubmitBtn">Resubmit Revised Bid</button>` : ""}
          ${canWithdraw ? `<button class="btn btn-outline" id="withdrawBidBtn">Withdraw Bid</button>` : ""}
        </div>
        ${bid.status==="pm_accepted" ? `<div class="card mt-3" style="background:var(--surface-2)"><p><b>The Project Manager has accepted your bid.</b> Confirm to finalize acceptance, or request changes if terms need discussion.</p>
          <div class="flex gap-2"><button class="btn btn-success" id="confirmAcceptBtn">Confirm &amp; Accept</button><button class="btn btn-outline" id="requestChangeBtn">Request Changes</button></div></div>` : ""}
        ${bid.status==="withdrawn" ? `<p class="hint mt-3">You withdrew this bid. Contact the Project Manager if you'd like to submit a new one, or check for a new tender if this one has closed.</p>` : ""}
        <h4 class="mt-5">Negotiation</h4>
        <div class="chat-window" style="height:300px">
          <div class="chat-messages" id="chatMsgs-${bid.id}">${comments.map(c=>chatBubble(c)).join("") || `<p class="text-muted text-center mt-4">No messages yet.</p>`}</div>
          <div class="chat-input-row"><input class="input" placeholder="Write a message… (contact details are auto-hidden)" id="chatInput-${bid.id}"><button class="btn btn-primary" data-send="${bid.id}">Send</button></div>
        </div>
      </div>`;
    document.getElementById("resubmitBtn")?.addEventListener("click", ()=>{
      U.qsa("[data-revise-rate]").forEach(inp=>{
        const bi = bidItemsList.find(x=>x.boqItemId===inp.dataset.reviseRate);
        const item = items.find(it=>it.id===inp.dataset.reviseRate);
        const rate = +inp.value||0;
        DB.bidItems.update(bi.id, { rate, amount: rate*item.qty });
      });
      DB.bids.update(bid.id, { status:"submitted" });
      DB.notifications.create({ userId:tender.pmId, title:"Bid revised", body:`${user.name} resubmitted a revised bid on "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Revised bid submitted.", {type:"success"}); renderAll();
    });
    document.getElementById("confirmAcceptBtn")?.addEventListener("click", ()=>{
      DB.bids.update(bid.id, { status:"mutually_accepted" });
      DB.bids.list(b=>b.tenderId===tender.id && b.id!==bid.id).forEach(b=> DB.bids.update(b.id, {status:"not_selected"}));
      DB.tenders.update(tender.id, { status:"awarded", awardedTo:bid.contractorId });
      DB.notifications.create({ userId:tender.pmId, title:"Bid mutually accepted!", body:`Both sides accepted terms for "${tender.title}". Contact unlock is now available.`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.confetti(); U.toast("You've confirmed acceptance. Contact unlock is now available to both sides.", {title:"🎉 Accepted", type:"success"});
      renderAll();
    });
    document.getElementById("requestChangeBtn")?.addEventListener("click", ()=>{
      DB.bids.update(bid.id, { status:"revision_requested" });
      U.toast("Marked for revision. Use the chat below to explain what needs to change.", {type:"warning"});
      renderAll();
    });
    document.getElementById("withdrawBidBtn")?.addEventListener("click", ()=>{
      if(!confirm("Withdraw this bid? The Project Manager will no longer see it in comparison, and you won't be able to resubmit unless invited again.")) return;
      DB.bids.update(bid.id, { status:"withdrawn" });
      DB.notifications.create({ userId:tender.pmId, title:"Bid withdrawn", body:`${user.name} withdrew their bid on "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Your bid has been withdrawn.", {type:"warning"});
      renderAll();
    });
  }

  function renderBidForm(){
    return `<div class="card">
      <h3>Submit Your Bid</h3>
      <div class="field"><label>Bid Type</label>
        <div class="pill-tab" id="bidModeTabs">
          <button class="active" data-mode="item-wise">Item-wise Rate</button>
          <button data-mode="lumpsum">Lump Sum</button>
          <button data-mode="percentage">% Above/Below Estimate</button>
          <button data-mode="hybrid">Hybrid</button>
        </div>
      </div>
      <div id="bidModeArea"></div>
      <div class="field"><label>Technical Bid — Remarks &amp; Past Experience</label><textarea class="textarea" id="techRemarks" placeholder="Team strength, similar past projects, equipment available, timeline commitment…"></textarea></div>
      <div class="field"><label>Documents</label>
        <div class="doc-badges">
          <label class="checkbox-row"><input type="checkbox" id="docGST" checked> GST Certificate</label>
          <label class="checkbox-row"><input type="checkbox" id="docPAN" checked> PAN Card</label>
          <label class="checkbox-row"><input type="checkbox" id="docMSME"> MSME Certificate</label>
          <label class="checkbox-row"><input type="checkbox" id="docISO"> ISO Certificate</label>
        </div>
      </div>
      <button class="btn btn-primary btn-lg mt-3" id="submitBidBtn">Submit Bid</button>
    </div>`;
  }

  function bindBidForm(){
    let mode = "item-wise";
    function renderModeArea(){
      const area = document.getElementById("bidModeArea");
      if(mode==="item-wise"){
        const items = boqItems();
        area.innerHTML = `<p class="hint mb-2">💡 Tip: paste rates copied from Excel directly into the first Rate cell below.</p>
        <div class="table-wrap"><table class="dtable"><thead><tr><th>Item</th><th>Unit</th><th>Qty</th><th>Your Rate (₹)</th><th>Amount</th></tr></thead>
        <tbody id="bidBoqTbody">${items.map(it=>`<tr data-item="${it.id}" data-qty="${it.qty}"><td>${U.escapeHtml(it.description)}</td><td>${it.unit}</td><td>${it.qty}</td>
          <td contenteditable="true" data-field="rate" class="rate-cell">0</td><td class="amount-cell">₹0</td></tr>`).join("")}</tbody></table></div>
        <p class="mt-2"><b>Total: <span id="bidTotalPreview">₹0</span></b></p>`;
        const tbody = document.getElementById("bidBoqTbody");
        function recalc(){
          let total=0;
          U.qsa("tr", tbody).forEach(tr=>{
            const rate = +tr.querySelector(".rate-cell").textContent.replace(/[^\d.]/g,"")||0;
            const qty = +tr.dataset.qty;
            const amt = rate*qty; total+=amt;
            tr.querySelector(".amount-cell").textContent = U.fmtINR(amt);
          });
          document.getElementById("bidTotalPreview").textContent = U.fmtINR(total);
        }
        tbody.addEventListener("input", recalc);
        tbody.addEventListener("paste", e=>{
          const td = e.target.closest("td.rate-cell"); if(!td) return;
          const text = (e.clipboardData||window.clipboardData).getData("text");
          if(!text.includes("\n") && !text.includes("\t")) return;
          e.preventDefault();
          const rows = U.parsePastedTable(text).map(r=>r[0]);
          const trs = U.qsa("tr", tbody);
          const startIdx = trs.indexOf(td.closest("tr"));
          rows.forEach((val,i)=>{ if(trs[startIdx+i]) trs[startIdx+i].querySelector(".rate-cell").textContent = val.replace(/[^\d.]/g,""); });
          recalc();
        });
      } else if(mode==="lumpsum"){
        area.innerHTML = `<div class="field"><label>Total Lump Sum Amount (₹)</label><input class="input" id="lumpsumInput" type="number" placeholder="e.g. 4500000"></div>`;
      } else if(mode==="percentage"){
        area.innerHTML = `<div class="field"><label>Percentage above (+) or below (−) the estimated value of ${U.fmtINR(tender.estimatedValue)}</label><input class="input" id="pctInput" type="number" placeholder="e.g. -3.5"></div>`;
      } else {
        area.innerHTML = `<div class="field"><label>Fixed Component (₹)</label><input class="input" id="hybridFixed" type="number" placeholder="Mobilisation / fixed cost"></div>
        <div class="field"><label>Percentage Component on ${U.fmtINR(tender.estimatedValue)}</label><input class="input" id="hybridPct" type="number" placeholder="e.g. 92 for 92% of estimate"></div>`;
      }
    }
    U.qsa("#bidModeTabs button").forEach(btn=> btn.addEventListener("click", ()=>{
      U.qsa("#bidModeTabs button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
      mode = btn.dataset.mode; renderModeArea();
    }));
    renderModeArea();

    document.getElementById("submitBidBtn").addEventListener("click", ()=>{
      const technicalRemarks = document.getElementById("techRemarks").value.trim();
      const docs = { gst:document.getElementById("docGST").checked, pan:document.getElementById("docPAN").checked, msme:document.getElementById("docMSME").checked, iso:document.getElementById("docISO").checked };
      let bidData = { tenderId:tender.id, contractorId:user.id, mode, status:"submitted", technicalRemarks, docs, submittedAt:DB.nowISO() };
      if(mode==="lumpsum") bidData.lumpsumAmount = +document.getElementById("lumpsumInput").value||0;
      if(mode==="percentage") bidData.percentageValue = +document.getElementById("pctInput").value||0;
      if(mode==="hybrid") bidData.lumpsumAmount = (+document.getElementById("hybridFixed").value||0) + tender.estimatedValue*((+document.getElementById("hybridPct").value||0)/100);
      if(mode==="lumpsum" && !bidData.lumpsumAmount){ U.toast("Enter a lump sum amount.", {type:"danger"}); return; }
      const bid = DB.bids.create(bidData);
      if(mode==="item-wise"){
        U.qsa("#bidBoqTbody tr").forEach(tr=>{
          const rate = +tr.querySelector(".rate-cell").textContent.replace(/[^\d.]/g,"")||0;
          const qty = +tr.dataset.qty;
          DB.bidItems.create({ bidId:bid.id, boqItemId:tr.dataset.item, rate, amount:rate*qty });
        });
      }
      DB.notifications.create({ userId:tender.pmId, title:"New bid received", body:`${user.name} submitted a bid on "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Bid submitted successfully!", {title:"Submitted", type:"success"});
      renderAll();
    });
  }

  /* ============================= PM bid actions & chat (event delegation) ============================= */
  document.getElementById("panelBids").addEventListener("click", e=>{
    const toggle = e.target.closest("[data-toggle]");
    const accept = e.target.closest("[data-accept]");
    const reject = e.target.closest("[data-reject]");
    const revise = e.target.closest("[data-revise]");
    const send = e.target.closest("[data-send]");
    const itemRemark = e.target.closest("[data-item-remark]");
    if(e.target.closest("#exportBidsBtn")){
      const rows = rankedBids().map((r,idx)=>{
        const c = DB.users.get(r.bid.contractorId);
        return [rankLabel(idx), c.name, r.bid.mode, r.total, r.bid.status];
      });
      U.exportCSV("bid-comparison-"+tender.title.replace(/[^a-z0-9]/gi,"-").toLowerCase(), ["Rank","Contractor","Bid Mode","Total Value","Status"], rows);
      U.toast("Bid comparison exported to CSV.", {type:"success"});
      return;
    }
    if(toggle){ selectedBidId = selectedBidId===toggle.dataset.toggle ? null : toggle.dataset.toggle; renderBids(); return; }
    if(accept){
      DB.bids.update(accept.dataset.accept, {status:"pm_accepted"});
      const bid = DB.bids.get(accept.dataset.accept);
      DB.notifications.create({ userId:bid.contractorId, title:"Your bid was accepted!", body:`Confirm your acceptance on "${tender.title}" to move forward.`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Bid accepted — waiting for contractor to confirm.", {type:"success"}); renderAll();
    }
    if(reject){
      DB.bids.update(reject.dataset.reject, {status:"rejected"});
      const bid = DB.bids.get(reject.dataset.reject);
      DB.notifications.create({ userId:bid.contractorId, title:"Bid update", body:`Your bid on "${tender.title}" was not selected.`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Bid rejected.", {type:"warning"}); renderAll();
    }
    if(revise){
      const note = prompt("What should the contractor revise? (this note is visible to them)");
      if(note===null) return;
      DB.bids.update(revise.dataset.revise, {status:"revision_requested"});
      DB.comments.create({ tenderId:tender.id, bidId:revise.dataset.revise, authorId:user.id, authorRole:"pm", text:note||"Please revise your bid." });
      const bid = DB.bids.get(revise.dataset.revise);
      DB.notifications.create({ userId:bid.contractorId, title:"Revision requested", body:`PM requested a revision on your bid for "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
      U.toast("Revision requested.", {type:"warning"}); renderAll();
    }
    if(itemRemark){
      const note = prompt("Add a remark for this item (visible to the contractor):");
      if(!note) return;
      DB.comments.create({ tenderId:tender.id, bidId:itemRemark.dataset.bid, boqItemId:itemRemark.dataset.itemRemark, authorId:user.id, authorRole:"pm", text:note });
      U.toast("Remark added.", {type:"success"}); renderBids();
    }
    if(send) sendMessage(send.dataset.send);
  });
  document.getElementById("panelBids").addEventListener("keydown", e=>{
    if(e.key==="Enter" && e.target.id && e.target.id.startsWith("chatInput-")){
      sendMessage(e.target.id.replace("chatInput-",""));
    }
  });
  function sendMessage(bidId){
    const input = document.getElementById("chatInput-"+bidId);
    const text = input.value.trim();
    if(!text) return;
    DB.comments.create({ tenderId:tender.id, bidId, authorId:user.id, authorRole:user.role, text });
    input.value="";
    const bid = DB.bids.get(bidId);
    const otherId = isPM ? bid.contractorId : tender.pmId;
    DB.notifications.create({ userId:otherId, title:"New negotiation message", body:`New message on "${tender.title}".`, read:false, link:"/pages/tender-detail/index.html?id="+tender.id });
    renderBids();
  }

  /* ============================= CHAT TAB (mirrors bid chat for convenience) ============================= */
  function renderChat(){
    document.getElementById("panelChat").innerHTML = `<div class="card"><p class="text-muted">Negotiation chat is per-bid — open a bid under the <b>Bids</b> tab to message that contractor directly. All phone numbers, emails, UPI IDs and spelled-out digits are automatically hidden until both sides complete the ₹99 contact unlock.</p></div>`;
  }

  /* ============================= DOCS TAB ============================= */
  function renderDocs(){
    const files = tender.drawings||[];
    document.getElementById("panelDocs").innerHTML = `<div class="card">
      <h3>Drawings &amp; Attachments</h3>
      ${files.length ? files.map(f=>`<span class="file-chip" style="display:inline-flex;gap:8px;background:var(--surface-2);padding:8px 14px;border-radius:var(--r-pill);margin:4px 6px 0 0">📄 ${U.escapeHtml(f.name)} <small>${f.size}</small></span>`).join("") : `<p class="text-muted">No drawings uploaded for this tender.</p>`}
    </div>`;
  }

  function renderAll(){
    tender = DB.tenders.get(tender.id);
    renderHeader(); renderUnlockBanner(); renderOverview(); renderBoq(); renderBids(); renderChat(); renderDocs();
  }
  U.initTabs();
  renderAll();

  SW.UI.helpSection(document.querySelector(".app-content"), "Tender Detail & Bidding", [
    "Bids are ranked L1 (lowest), L2, L3 automatically based on total value across item-wise, lump sum, percentage or hybrid modes.",
    "As a Project Manager you can Accept, Reject or Request Revision on any bid, and leave item-wise remarks.",
    "Acceptance only becomes final once the contractor confirms — this prevents one-sided lock-in and allows unlimited revision cycles.",
    "Once both sides mutually accept, a one-time ₹99 fee (discounted from ₹999) unlocks direct phone, chat and email — before that, all contact info shared in chat is automatically masked, even if written in Hindi or spelled out in words.",
    "After contact unlock, the Project Manager can generate a professional Letter of Intent (LOI) with one click."
  ]);
})();
