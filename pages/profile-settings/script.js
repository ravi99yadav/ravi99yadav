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
    "Change your password here anytime — you'll need your current password to confirm the change."
  ]);
})();
