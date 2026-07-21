(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["contractor"], active:"contractor-tenders" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;
  let view = "all";

  SW.Geo.bindStateDistrict(document.getElementById("fState"), document.getElementById("fDistrict"), {});

  function saved(tenderId){ return DB.savedTenders.list(s=>s.userId===user.id && s.tenderId===tenderId)[0]; }

  function getTenders(){
    let list = DB.tenders.list(t=> t.status==="published" && !t.archived);
    const district = document.getElementById("fDistrict").value.trim().toLowerCase();
    const state = document.getElementById("fState").value.trim().toLowerCase();
    const trade = document.getElementById("fTrade").value;
    const minValue = +document.getElementById("fMinValue").value||0;
    if(district) list = list.filter(t=>t.district.toLowerCase().includes(district));
    if(state) list = list.filter(t=>t.state.toLowerCase().includes(state));
    if(trade) list = list.filter(t=>t.workType===trade);
    if(minValue) list = list.filter(t=>t.estimatedValue>=minValue);
    if(view==="saved") list = list.filter(t=> saved(t.id) && saved(t.id).type==="saved");
    if(view==="favourite") list = list.filter(t=> saved(t.id) && saved(t.id).type==="favourite");
    return list;
  }

  function render(){
    const list = getTenders();
    document.getElementById("resultsGrid").innerHTML = list.length ? list.map(t=>{
      const s = saved(t.id);
      const myBid = DB.bids.list(b=>b.tenderId===t.id && b.contractorId===user.id)[0];
      const daysLeft = t.bidSubmissionDeadline ? U.daysBetween(new Date(), t.bidSubmissionDeadline) : null;
      return `<div class="card card-hover tender-card">
        <div class="tc-head">
          <div><b>${U.escapeHtml(t.title)}</b><div class="text-muted" style="font-size:12px">${t.district}, ${t.state}</div></div>
          <button class="tc-fav" data-fav="${t.id}" title="Favourite">${s&&s.type==='favourite' ? '⭐':'☆'}</button>
        </div>
        <div class="flex gap-2 mt-2" style="flex-wrap:wrap"><span class="badge badge-info">${t.workType}</span>${daysLeft!==null?`<span class="badge ${daysLeft<=2?'badge-danger':'badge-neutral'}">${daysLeft>=0?daysLeft+'d left':'closed'}</span>`:""}</div>
        <p class="mt-2" style="font-size:13px">${U.escapeHtml((t.description||"").slice(0,110))}${(t.description||"").length>110?"…":""}</p>
        <div class="flex justify-between items-center mt-3">
          <b>${U.fmtINR(t.estimatedValue)}</b>
          <div class="flex gap-2">
            <button class="btn btn-ghost btn-sm" data-save="${t.id}">${s&&s.type==='saved'?'Saved ✓':'Save'}</button>
            <a class="btn btn-primary btn-sm" href="../tender-detail/index.html?id=${t.id}">${myBid?'View My Bid':'View & Bid'}</a>
          </div>
        </div>
      </div>`;
    }).join("") : `<div class="empty-state" style="grid-column:1/-1"><div class="es-icon">🔍</div>No tenders match. Try clearing filters or check back later.</div>`;
  }

  document.getElementById("searchBtn").addEventListener("click", render);
  document.getElementById("clearBtn").addEventListener("click", ()=>{
    U.qsa(".card input,.card select").forEach(i=>i.value="");
    SW.Geo.populateDistrictSelect(document.getElementById("fDistrict"), "", null);
    render();
  });
  U.qsa("#viewTabs button").forEach(btn=> btn.addEventListener("click", ()=>{
    U.qsa("#viewTabs button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    view = btn.dataset.view; render();
  }));
  document.getElementById("resultsGrid").addEventListener("click", e=>{
    const fav = e.target.closest("[data-fav]");
    const save = e.target.closest("[data-save]");
    if(fav){
      const existing = saved(fav.dataset.fav);
      if(existing && existing.type==="favourite") DB.savedTenders.remove(existing.id);
      else if(existing) DB.savedTenders.update(existing.id, {type:"favourite"});
      else DB.savedTenders.create({ userId:user.id, tenderId:fav.dataset.fav, type:"favourite" });
      render();
    }
    if(save){
      const existing = saved(save.dataset.save);
      if(existing && existing.type==="saved") DB.savedTenders.remove(existing.id);
      else if(existing) DB.savedTenders.update(existing.id, {type:"saved"});
      else DB.savedTenders.create({ userId:user.id, tenderId:save.dataset.save, type:"saved" });
      render();
    }
  });
  render();
  SW.UI.helpSection(document.querySelector(".app-content"), "Search Tenders", [
    "Filter by district, state, trade and minimum estimated value to find relevant sublet work quickly.",
    "Save a tender to review later, or mark it a Favourite to track it closely — both lists are private to your account.",
    "Click \"View & Bid\" to see full BOQ, terms and submit an item-wise, lump sum, percentage or hybrid bid."
  ]);
})();
