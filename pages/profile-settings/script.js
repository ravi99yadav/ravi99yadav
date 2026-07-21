(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm","contractor","admin"], active:"profile-settings" });
  if(!user) return;
  const DB = SW.DB, U = SW.Utils;
  const isAdmin = user.role==="admin";
  const TRADES = ["Civil","Structural","Electrical","MEP","Plumbing","Fire Fighting","Interior"];

  document.getElementById("pName").value = user.name||"";
  document.getElementById("pEmail").value = user.email||"";
  document.getElementById("pPhone").value = user.phone||"";
  document.getElementById("pRole").value = SW.UI.roleLabel(user.role);
  SW.Geo.bindStateDistrict(document.getElementById("pState"), document.getElementById("pDistrict"), { state:user.state||"", district:user.district||"" });

  document.getElementById("savePersonalBtn").addEventListener("click", ()=>{
    const panel = document.getElementById("pName").closest(".card");
    if(!U.validateForm(panel)) return;
    DB.users.update(user.id, {
      name: document.getElementById("pName").value.trim(),
      phone: document.getElementById("pPhone").value.trim(),
      district: document.getElementById("pDistrict").value.trim(),
      state: document.getElementById("pState").value.trim()
    });
    U.toast("Personal details updated.", {type:"success"});
  });

  const companyCard = document.getElementById("companyCard");
  if(isAdmin){
    companyCard.classList.add("hidden");
  } else {
    let company = DB.companies.list(c=>c.ownerId===user.id)[0];
    document.getElementById("cName").value = company?.name||"";
    document.getElementById("cGst").value = company?.gst||"";
    document.getElementById("cPan").value = company?.pan||"";
    document.getElementById("cMsme").value = company?.msme||"";
    document.getElementById("cIso").value = company?.iso||"";
    document.getElementById("cExp").value = company?.experienceYears||"";
    document.getElementById("cLabour").value = company?.labourStrength||"";
    document.getElementById("cEquip").value = (company?.equipment||[]).join(", ");

    if(user.role!=="contractor") U.qsa(".contractor-only").forEach(el=>el.classList.add("hidden"));
    document.getElementById("tradeChecks").innerHTML = TRADES.map(t=>`
      <label class="checkbox-row"><input type="checkbox" data-trade="${t}" ${(company?.trades||[]).includes(t)?'checked':''}> ${t}</label>`).join("");

    document.getElementById("saveCompanyBtn").addEventListener("click", ()=>{
      const panel = document.getElementById("companyCard");
      if(!U.validateForm(panel)) return;
      const data = {
        name: document.getElementById("cName").value.trim(),
        gst: document.getElementById("cGst").value.trim(),
        pan: document.getElementById("cPan").value.trim(),
        msme: document.getElementById("cMsme").value.trim(),
        iso: document.getElementById("cIso").value.trim(),
        experienceYears: +document.getElementById("cExp").value||0,
        labourStrength: +document.getElementById("cLabour").value||0,
        equipment: document.getElementById("cEquip").value.split(",").map(s=>s.trim()).filter(Boolean),
        trades: U.qsa("[data-trade]:checked").map(c=>c.dataset.trade)
      };
      if(company) DB.companies.update(company.id, data);
      else company = DB.companies.create(Object.assign({ownerId:user.id}, data));
      U.toast("Company details updated.", {type:"success"});
    });
  }

  /* ---------- Digital Signature ---------- */
  (function initSignaturePad(){
    const canvas = document.getElementById("sigPad");
    const ctx = canvas.getContext("2d");
    let drawing = false, hasDrawn = false;
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#111";

    function pos(e){
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
      const point = e.touches ? e.touches[0] : e;
      return { x: (point.clientX-rect.left)*scaleX, y: (point.clientY-rect.top)*scaleY };
    }
    function start(e){ drawing = true; hasDrawn = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); e.preventDefault(); }
    function move(e){ if(!drawing) return; const p = pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); }
    function end(){ drawing = false; }
    canvas.addEventListener("mousedown", start); canvas.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start); canvas.addEventListener("touchmove", move); canvas.addEventListener("touchend", end);

    if(user.signature){
      const img = new Image();
      img.onload = ()=> ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = user.signature;
      hasDrawn = true;
      document.getElementById("sigStatus").textContent = "Signature saved.";
    }
    document.getElementById("sigClearBtn").addEventListener("click", ()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height); hasDrawn = false;
      document.getElementById("sigStatus").textContent = "";
    });
    document.getElementById("sigSaveBtn").addEventListener("click", ()=>{
      if(!hasDrawn){ U.toast("Draw your signature first.", {type:"danger"}); return; }
      const dataUrl = canvas.toDataURL("image/png");
      DB.users.update(user.id, { signature: dataUrl });
      document.getElementById("sigStatus").textContent = "Signature saved — it will now appear on documents you sign.";
      U.toast("Signature saved.", {type:"success"});
    });
  })();

  /* ---------- Team Members ---------- */
  function renderTeam(){
    const list = DB.teamMembers.list(t=>t.ownerId===user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    document.getElementById("teamList").innerHTML = list.length ? `<div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Designation</th><th>Skill / Trade</th><th>Exp.</th><th>Phone</th><th></th></tr></thead>
      <tbody>${list.map(t=>`<tr>
        <td>${U.escapeHtml(t.name)}</td><td>${U.escapeHtml(t.designation||"—")}</td><td>${U.escapeHtml(t.skill||"—")}</td>
        <td>${t.experienceYears?t.experienceYears+" yrs":"—"}</td><td>${U.escapeHtml(t.phone||"—")}</td>
        <td class="flex gap-2"><button class="btn-icon" data-edit-team="${t.id}" title="Edit">✎</button><button class="btn-icon" data-rm-team="${t.id}" title="Remove">✕</button></td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><div class="es-icon">👥</div>No team members added yet.</div>`;
    document.getElementById("teamList").querySelectorAll("[data-edit-team]").forEach(b=> b.addEventListener("click", ()=> openTeamModal(b.dataset.editTeam)));
    document.getElementById("teamList").querySelectorAll("[data-rm-team]").forEach(b=> b.addEventListener("click", ()=>{
      if(!confirm("Remove this team member?")) return;
      DB.teamMembers.remove(b.dataset.rmTeam); renderTeam();
    }));
  }
  function openTeamModal(id){
    const tm = id ? DB.teamMembers.get(id) : null;
    document.getElementById("teamModalTitle").textContent = tm ? "Edit Team Member" : "Add Team Member";
    document.getElementById("tmId").value = tm ? tm.id : "";
    document.getElementById("tmName").value = tm ? tm.name : "";
    document.getElementById("tmDesignation").value = tm ? tm.designation||"" : "";
    document.getElementById("tmSkill").value = tm ? tm.skill||"" : "";
    document.getElementById("tmExp").value = tm ? tm.experienceYears||"" : "";
    document.getElementById("tmPhone").value = tm ? tm.phone||"" : "";
    document.getElementById("tmEmail").value = tm ? tm.email||"" : "";
    document.getElementById("tmNotes").value = tm ? tm.notes||"" : "";
    U.openModal("teamModal");
  }
  document.getElementById("addTeamBtn").addEventListener("click", ()=> openTeamModal(null));
  document.getElementById("tmSaveBtn").addEventListener("click", ()=>{
    const name = document.getElementById("tmName").value.trim();
    if(!name){ U.toast("Enter the team member's name.", {type:"danger"}); return; }
    const data = {
      name, designation: document.getElementById("tmDesignation").value.trim(),
      skill: document.getElementById("tmSkill").value.trim(),
      experienceYears: +document.getElementById("tmExp").value||0,
      phone: document.getElementById("tmPhone").value.trim(),
      email: document.getElementById("tmEmail").value.trim(),
      notes: document.getElementById("tmNotes").value.trim()
    };
    const id = document.getElementById("tmId").value;
    if(id) DB.teamMembers.update(id, data);
    else DB.teamMembers.create(Object.assign({ ownerId:user.id }, data));
    U.closeModal("teamModal"); renderTeam();
    U.toast(id?"Team member updated.":"Team member added.", {type:"success"});
  });
  renderTeam();
  if(isAdmin){ document.getElementById("teamCard").classList.add("hidden"); document.getElementById("signatureCard").classList.add("hidden"); }

  document.getElementById("changePasswordBtn").addEventListener("click", ()=>{
    const cur = document.getElementById("pwCurrent").value;
    const next = document.getElementById("pwNew").value;
    const confirm = document.getElementById("pwConfirm").value;
    if(cur !== user.password){ U.toast("Current password is incorrect.", {type:"danger"}); return; }
    if(next.length<6){ U.toast("New password must be at least 6 characters.", {type:"danger"}); return; }
    if(next !== confirm){ U.toast("New password and confirmation do not match.", {type:"danger"}); return; }
    DB.users.update(user.id, {password: next});
    document.getElementById("pwCurrent").value = document.getElementById("pwNew").value = document.getElementById("pwConfirm").value = "";
    U.toast("Password changed successfully.", {type:"success"});
  });

  SW.UI.helpSection(document.querySelector(".app-content"), "Profile & Settings", [
    "Personal details and company information (GST, PAN, MSME, ISO, trades, equipment) shown to other users when you bid or list contractor profiles.",
    "Contractors: keeping trades, experience and equipment up to date improves how well tender matches and search results find you.",
    "Change your password here anytime — you'll need your current password to confirm the change.",
    "Digital Signature: draw your signature once and it's used automatically on every document you sign or generate — LOI, Work Order, RA Bill, Purchase Order, EOT Letter and more.",
    "Team Members: add the people on your team with their designation, skill/trade and experience — useful for project assignment and site records."
  ]);
})();
