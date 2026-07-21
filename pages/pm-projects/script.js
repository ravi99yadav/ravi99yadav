(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm"], active:"pm-projects" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;

  function render(){
    const masterProjects = DB.masterProjects.list(mp=>mp.pmId===user.id && !mp.archived).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    document.getElementById("projectsList").innerHTML = masterProjects.length ? masterProjects.map(mp=>{
      const tenders = DB.tenders.list(t=>t.masterProjectId===mp.id && !t.archived);
      const workPackages = DB.projects.list(p=>p.masterProjectId===mp.id);
      let totalContract = 0, totalBilled = 0, totalBalance = 0, avgProgress = 0;
      workPackages.forEach(p=>{
        const h = U.projectHealth(p);
        totalContract += h.contractValue; totalBilled += h.billedAmount; totalBalance += h.balanceAmount; avgProgress += h.workPct;
      });
      if(workPackages.length) avgProgress = Math.round(avgProgress/workPackages.length);
      return `<div class="card mp-card">
        <div class="flex justify-between items-start mb-3" style="flex-wrap:wrap;gap:10px">
          <div><h3 style="margin:0">${U.escapeHtml(mp.name)}</h3><p class="text-muted" style="margin:4px 0 0;font-size:13px">${U.escapeHtml(mp.district)}, ${U.escapeHtml(mp.state)}${mp.description?' · '+U.escapeHtml(mp.description):''}</p></div>
          <a class="btn btn-primary btn-sm" href="../tender-wizard/index.html?masterProjectId=${mp.id}">+ Float Tender for this Project</a>
        </div>
        <div class="grid grid-4 mb-4">
          <div><div class="text-muted" style="font-size:12px">Tenders Floated</div><b>${tenders.length}</b></div>
          <div><div class="text-muted" style="font-size:12px">Awarded Work Packages</div><b>${workPackages.length}</b></div>
          <div><div class="text-muted" style="font-size:12px">Avg. Progress</div><b>${avgProgress}%</b></div>
          <div><div class="text-muted" style="font-size:12px">Combined Balance</div><b>${U.fmtINR(totalBalance)}</b></div>
        </div>
        <div class="divider"></div>
        <h4 class="mb-2">Tenders under this Project</h4>
        ${tenders.length ? tenders.map(t=>{
          const bids = DB.bids.list(b=>b.tenderId===t.id);
          return `<div class="mp-subrow">
            <div><b>${U.escapeHtml(t.title)}</b><div class="text-muted" style="font-size:12px">${t.workType} · ${bids.length} bid(s)</div></div>
            <div class="flex gap-2 items-center">
              <span class="badge ${t.status==='draft'?'badge-neutral':t.status==='awarded'?'badge-success':'badge-info'}">${t.status}</span>
              <a class="btn btn-sm btn-outline" href="${t.status==='draft'?'../tender-wizard/index.html?id='+t.id:'../tender-detail/index.html?id='+t.id}">${t.status==='draft'?'Continue':'Open'}</a>
            </div>
          </div>`;
        }).join("") : `<p class="text-muted" style="font-size:13px">No tenders floated yet for this project.</p>`}
        ${workPackages.length ? `<h4 class="mt-4 mb-2">Awarded Work Packages</h4>${workPackages.map(p=>{
          const h = U.projectHealth(p);
          const contractor = p.external ? (p.externalContractorName||"External") : (DB.users.get(p.contractorId)||{}).name;
          return `<div class="mp-subrow">
            <div><b>${U.escapeHtml(p.name)}</b><div class="text-muted" style="font-size:12px">${U.escapeHtml(contractor||"—")} · ${h.workPct}% complete · Balance ${U.fmtINR(h.balanceAmount)}</div></div>
            <a class="btn btn-sm btn-ghost" href="../project-workspace/index.html?id=${p.id}">Open Workspace →</a>
          </div>`;
        }).join("")}` : ""}
      </div>`;
    }).join("") : `<div class="empty-state"><div class="es-icon">🏗️</div>No projects yet. Create one, then float as many tenders under it as you need — each can cover a different scope of BOQ items. <button class="btn btn-primary mt-3" id="emptyNewProjectBtn">+ New Project</button></div>`;
    document.getElementById("emptyNewProjectBtn")?.addEventListener("click", ()=> U.openModal("projectModal"));
  }

  document.getElementById("newProjectBtn").addEventListener("click", ()=> U.openModal("projectModal"));
  document.getElementById("mpSaveBtn").addEventListener("click", ()=>{
    const name = document.getElementById("mpName").value.trim();
    const district = document.getElementById("mpDistrict").value.trim();
    const state = document.getElementById("mpState").value.trim();
    if(!name || !district || !state){ U.toast("Fill in project name, district and state.", {type:"danger"}); return; }
    DB.masterProjects.create({ pmId:user.id, name, district, state, description: document.getElementById("mpDescription").value.trim() });
    U.closeModal("projectModal");
    document.getElementById("mpName").value = document.getElementById("mpDistrict").value = document.getElementById("mpState").value = document.getElementById("mpDescription").value = "";
    U.toast("Project created — you can now float tenders under it.", {type:"success"});
    render();
  });

  render();
  SW.UI.helpSection(document.querySelector(".app-content"), "My Projects", [
    "A Project is the umbrella for one site — create it once, then float as many tenders as you need under it, each covering a different scope of BOQ items (e.g. a Civil tender and a separate MEP tender for the same site).",
    "Every tender you create can optionally be linked to a Project from the tender wizard's first step.",
    "Once a tender under a Project is awarded, its Work Order automatically creates a Project Workspace linked back here, so you can track combined progress and balance across every contractor working on this site."
  ]);
})();
