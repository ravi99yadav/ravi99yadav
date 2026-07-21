(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"pm-tenders" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;
  let statusFilter = "all", search = "", currentList = [];

  function render(){
    let list = DB.tenders.list(t=>t.pmId===user.id);
    if(statusFilter==="archived") list = list.filter(t=>t.archived);
    else { list = list.filter(t=>!t.archived); if(statusFilter!=="all") list = list.filter(t=>t.status===statusFilter); }
    if(search) list = list.filter(t=>t.title.toLowerCase().includes(search.toLowerCase()));
    list.sort((a,b)=> new Date(b.updatedAt)-new Date(a.updatedAt));
    currentList = list;

    document.getElementById("tenderTbody").innerHTML = list.length ? list.map(t=>{
      const bids = DB.bids.list(b=>b.tenderId===t.id);
      const daysFloated = t.publishedAt ? U.daysBetween(t.publishedAt, new Date()) : null;
      const staleAlert = (t.status==="published" && daysFloated!==null && daysFloated>=7);
      const mp = t.masterProjectId ? DB.masterProjects.get(t.masterProjectId) : null;
      return `<tr>
        <td><b>${U.escapeHtml(t.title)}</b>${staleAlert?` <span class="badge badge-warning" title="Floated ${daysFloated} days ago with no award yet">⏰ Floated ${daysFloated}d ago</span>`:""}<div class="text-muted" style="font-size:12px">${t.workType}${mp?` · 🏗️ ${U.escapeHtml(mp.name)}`:""}</div></td>
        <td>${U.escapeHtml(t.district)}, ${U.escapeHtml(t.state)}</td>
        <td><span class="badge ${statusBadge(t.status)}">${t.archived?"archived":t.status}</span></td>
        <td>${bids.length}</td>
        <td>${U.fmtDate(t.bidSubmissionDeadline)}</td>
        <td>${t.publishedAt ? U.relativeTime(t.publishedAt) : "—"}</td>
        <td>
          <div class="row-actions">
            <a class="btn btn-sm btn-outline" href="${t.status==='draft' ? '../tender-wizard/index.html?id='+t.id : '../tender-detail/index.html?id='+t.id}">${t.status==='draft'?'Edit':'Open'}</a>
            <button class="btn btn-sm btn-ghost" data-history="${t.id}">History</button>
            <button class="btn btn-sm btn-ghost" data-clone="${t.id}">Duplicate</button>
            ${t.archived ? `<button class="btn btn-sm btn-ghost" data-restore="${t.id}">Restore</button>` : `<button class="btn btn-sm btn-ghost" data-archive="${t.id}">Archive</button>`}
            <button class="btn btn-sm btn-ghost" data-print="${t.id}">Print</button>
          </div>
        </td>
      </tr>`;
    }).join("") : `<tr><td colspan="7"><div class="empty-state"><div class="es-icon">📄</div>No tenders found. <a href="../tender-wizard/index.html">Create your first tender →</a></div></td></tr>`;
  }
  function statusBadge(s){ return {draft:"badge-neutral",published:"badge-info",awarded:"badge-success",closed:"badge-danger"}[s]||"badge-neutral"; }

  U.qsa("#statusTabs button").forEach(btn=> btn.addEventListener("click", ()=>{
    U.qsa("#statusTabs button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
    statusFilter = btn.dataset.status; render();
  }));
  document.getElementById("searchInput").addEventListener("input", U.debounce(e=>{ search=e.target.value; render(); },200));

  document.getElementById("tenderTbody").addEventListener("click", e=>{
    const clone = e.target.closest("[data-clone]");
    const archive = e.target.closest("[data-archive]");
    const restore = e.target.closest("[data-restore]");
    const history = e.target.closest("[data-history]");
    const print = e.target.closest("[data-print]");
    if(clone){
      const dup = DB.tenders.duplicate(clone.dataset.clone, { title: DB.tenders.get(clone.dataset.clone).title+" (Copy)", status:"draft", published:false, publishedAt:null });
      DB.boqItems.list(i=>i.tenderId===clone.dataset.clone).forEach(i=> DB.boqItems.create(Object.assign({}, i, { id:undefined, tenderId:dup.id })));
      U.toast("Tender duplicated as a new draft.", {type:"success"}); render();
    }
    if(archive){ DB.tenders.archive(archive.dataset.archive); U.toast("Tender archived.", {type:"warning"}); render(); }
    if(restore){ DB.tenders.restore(restore.dataset.restore); U.toast("Tender restored.", {type:"success"}); render(); }
    if(print){ location.href = "../tender-wizard/index.html?id="+print.dataset.print; }
    if(history){
      const logs = DB.auditFor("tenders", history.dataset.history);
      document.getElementById("historyList").innerHTML = logs.length ? logs.map(l=>`<div class="timeline-item"><div class="ti-time">${U.fmtDateTime(l.at)}</div><b>${l.action}</b></div>`).join("") : `<div class="empty-state">No history yet.</div>`;
      U.openModal("historyModal");
    }
  });

  document.getElementById("exportBtn").addEventListener("click", ()=>{
    if(!currentList.length){ U.toast("Nothing to export for the current filter.", {type:"warning"}); return; }
    const rows = currentList.map(t=>[t.title, t.workType, t.district, t.state, t.archived?"archived":t.status, DB.bids.list(b=>b.tenderId===t.id).length, U.fmtDate(t.bidSubmissionDeadline), U.fmtINR(t.estimatedValue)]);
    U.exportCSV("subletworks-tenders", ["Title","Work Type","District","State","Status","Bids","Bid Deadline","Estimated Value"], rows);
    U.toast("Tenders exported to CSV.", {type:"success"});
  });

  render();
  SW.UI.helpSection(document.querySelector(".app-content"), "My Tenders", [
    "Drafts stay private until you publish them — continue editing anytime.",
    "Tenders floated 7+ days ago without an award are flagged so you don't lose track of them.",
    "Duplicate a tender to quickly reuse a BOQ structure for a similar scope elsewhere.",
    "Archive tenders you no longer need active — they can be restored anytime and remain in your version history."
  ]);
})();
