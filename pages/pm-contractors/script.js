(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"pm-contractors" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;
  let sortKey = "rating";

  SW.Geo.bindStateDistrict(document.getElementById("fState"), document.getElementById("fDistrict"), {});
  document.getElementById("fRadius").addEventListener("input", e=> document.getElementById("radiusVal").textContent = e.target.value+" km around entered district");

  // Note: phone/email are intentionally NOT included here — contact details
  // only become visible after both sides complete the ₹99 contact unlock
  // on a specific tender (see tender-detail.js).
  function getContractors(){
    const contractorUsers = DB.users.list(u=>u.role==="contractor" && u.status==="active");
    return contractorUsers.map(u=>{
      const company = DB.companies.list(c=>c.ownerId===u.id)[0] || {};
      return Object.assign({ userId:u.id, name:u.name }, company);
    });
  }

  function applyFilters(){
    const district = document.getElementById("fDistrict").value.trim().toLowerCase();
    const state = document.getElementById("fState").value.trim().toLowerCase();
    const trade = document.getElementById("fTrade").value;
    const rating = parseFloat(document.getElementById("fRating").value)||0;
    const exp = parseFloat(document.getElementById("fExp").value)||0;
    const labour = parseFloat(document.getElementById("fLabour").value)||0;
    const equip = document.getElementById("fEquip").value.trim().toLowerCase();

    let list = getContractors().filter(c=>{
      if(district && !(c.district||"").toLowerCase().includes(district)) return false;
      if(state && !(c.state||"").toLowerCase().includes(state)) return false;
      if(trade && !(c.trades||[]).includes(trade)) return false;
      if(rating && (c.rating||0) < rating) return false;
      if(exp && (c.experienceYears||0) < exp) return false;
      if(labour && (c.labourStrength||0) < labour) return false;
      if(equip && !(c.equipment||[]).some(e=>e.toLowerCase().includes(equip))) return false;
      return true;
    });

    list.sort((a,b)=>{
      if(sortKey==="rating") return (b.rating||0)-(a.rating||0);
      if(sortKey==="experience") return (b.experienceYears||0)-(a.experienceYears||0);
      if(sortKey==="labour") return (b.labourStrength||0)-(a.labourStrength||0);
      return 0;
    });
    render(list);
  }

  function render(list){
    document.getElementById("resultsCount").textContent = `Contractors (${list.length})`;
    document.getElementById("resultsGrid").innerHTML = list.length ? list.map(c=>`
      <div class="card card-hover contractor-card">
        <div class="cc-head">
          <div><b>${U.escapeHtml(c.name||"Unnamed Company")}</b><div class="text-muted" style="font-size:12px">${U.escapeHtml(c.district||"—")}, ${U.escapeHtml(c.state||"—")}</div></div>
          <span class="badge badge-warning">★ ${(c.rating||4.0).toFixed(1)}</span>
        </div>
        <div class="cc-tags">${(c.trades||[]).map(t=>`<span class="badge badge-info">${U.escapeHtml(t)}</span>`).join("")}</div>
        <p style="font-size:13px">${c.msme?"MSME Registered":"—"} ${c.iso?" · "+U.escapeHtml(c.iso):""}</p>
        <div class="cc-stats">
          <span>${c.experienceYears||0} yrs exp.</span>
          <span>${c.labourStrength||0} labour</span>
          <span>${(c.equipment||[]).length} equipment</span>
        </div>
        <div class="flex gap-2 mt-3">
          <button class="btn btn-outline btn-sm w-full" data-view="${c.userId}">View Profile</button>
          <button class="btn btn-primary btn-sm w-full" data-invite="${c.userId}" data-name="${U.escapeHtml(c.name)}">Invite to Tender</button>
        </div>
      </div>`).join("") : `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🔍</div>No contractors match your filters. Try broadening the search area or trade.</div>`;
  }

  document.getElementById("searchBtn").addEventListener("click", applyFilters);
  document.getElementById("clearBtn").addEventListener("click", ()=>{
    U.qsa("#filterGrid input").forEach(i=>i.value = i.id==="fRadius"?50:"");
    document.getElementById("fTrade").value=""; document.getElementById("fRating").value="0";
    document.getElementById("fState").value = "";
    SW.Geo.populateDistrictSelect(document.getElementById("fDistrict"), "", null);
    document.getElementById("radiusVal").textContent = "50 km around entered district";
    applyFilters();
  });
  U.qsa(".pill-tab button").forEach(btn=> btn.addEventListener("click", ()=>{
    U.qsa(".pill-tab button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    sortKey = btn.dataset.sort; applyFilters();
  }));

  function openInviteModal(contractorId, name){
    document.getElementById("inviteContractorName").textContent = name;
    const tenders = DB.tenders.list(t=>t.pmId===user.id && t.status==="published");
    document.getElementById("inviteTenderList").innerHTML = tenders.length ? tenders.map(t=>`
      <div class="attn-row" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${U.escapeHtml(t.title)}</span>
        <button class="btn btn-primary btn-sm" data-send-invite="${t.id}" data-contractor="${contractorId}">Send Invite</button>
      </div>`).join("") : `<div class="empty-state">You have no published tenders yet. <a href="../tender-wizard/index.html">Create one →</a></div>`;
    U.openModal("inviteModal");
  }

  function openProfileModal(contractorId){
    const c = getContractors().find(x=>x.userId===contractorId);
    if(!c) return;
    const projects = DB.projects.list(p=>p.contractorId===contractorId);
    const completed = projects.filter(p=>p.status==="completed").length;
    const running = projects.filter(p=>p.status==="running").length;
    document.getElementById("profileModalBody").innerHTML = `
      <div class="flex justify-between items-start mb-3" style="flex-wrap:wrap;gap:10px">
        <div><h3 style="margin:0">${U.escapeHtml(c.name||"Unnamed Company")}</h3><p class="text-muted" style="margin:4px 0">${U.escapeHtml(c.district||"—")}, ${U.escapeHtml(c.state||"—")}</p></div>
        <span class="badge badge-warning" style="font-size:14px">★ ${(c.rating||4.0).toFixed(1)} rating</span>
      </div>
      <div class="cc-tags mb-3">${(c.trades||[]).map(t=>`<span class="badge badge-info">${U.escapeHtml(t)}</span>`).join("") || '<span class="text-muted" style="font-size:13px">No trades listed.</span>'}</div>
      <div class="grid grid-4 mb-4">
        <div class="card" style="padding:12px;text-align:center"><b>${c.experienceYears||0}</b><div class="text-muted" style="font-size:11px">Years Experience</div></div>
        <div class="card" style="padding:12px;text-align:center"><b>${c.labourStrength||0}</b><div class="text-muted" style="font-size:11px">Labour Strength</div></div>
        <div class="card" style="padding:12px;text-align:center"><b>${running}</b><div class="text-muted" style="font-size:11px">Running Projects</div></div>
        <div class="card" style="padding:12px;text-align:center"><b>${completed}</b><div class="text-muted" style="font-size:11px">Completed Projects</div></div>
      </div>
      <div class="doc-badges mb-3">
        <span class="badge ${c.gst?'badge-success':'badge-neutral'}">${c.gst?'✓ GST Registered':'GST Not Provided'}</span>
        <span class="badge ${c.msme?'badge-success':'badge-neutral'}">${c.msme?'✓ MSME Registered':'MSME Not Registered'}</span>
        <span class="badge ${c.iso?'badge-success':'badge-neutral'}">${c.iso?'✓ '+U.escapeHtml(c.iso):'No ISO Certification'}</span>
      </div>
      <h4>Equipment</h4>
      <p style="font-size:13px">${(c.equipment||[]).map(U.escapeHtml).join(", ") || "Not listed."}</p>
      <p class="hint mt-3">Ratings and project history are tracked automatically from completed SubletWorks contracts.</p>`;
    document.getElementById("profileInviteBtn").onclick = ()=>{ U.closeModal("profileModal"); openInviteModal(c.userId, c.name); };
    U.openModal("profileModal");
  }

  document.getElementById("resultsGrid").addEventListener("click", e=>{
    const inviteBtn = e.target.closest("[data-invite]");
    const viewBtn = e.target.closest("[data-view]");
    if(inviteBtn) openInviteModal(inviteBtn.dataset.invite, inviteBtn.dataset.name);
    if(viewBtn) openProfileModal(viewBtn.dataset.view);
  });

  document.getElementById("inviteTenderList").addEventListener("click", e=>{
    const btn = e.target.closest("[data-send-invite]");
    if(!btn) return;
    DB.notifications.create({ userId:btn.dataset.contractor, title:"You've been invited to bid", body:"A Project Manager invited you to submit a bid on a tender matching your trade.", read:false, link:"/pages/tender-detail/index.html?id="+btn.dataset.sendInvite });
    U.toast("Invitation sent to contractor.", {title:"Invited", type:"success"});
    U.closeModal("inviteModal");
  });

  applyFilters();
  SW.UI.helpSection(document.querySelector(".app-content"), "Search Contractors", [
    "Filter by district/state, trade, minimum rating, experience, labour strength and equipment to shortlist the right contractor.",
    "The map placeholder will visualise matching contractors by radius once a maps API key is configured.",
    "Use \"Invite to Tender\" to directly notify a contractor about one of your published tenders — this speeds up bid collection in a niche trade."
  ]);
})();
