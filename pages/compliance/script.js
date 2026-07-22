(function(){
  "use strict";
  const user = SW.UI.mountShell({ roles:["pm","contractor"], active:"compliance" });
  if(!user) return;
  const DB = SW.DB;
  const company = DB.companies.list(c=>c.ownerId===user.id)[0] || {};

  // Synthetic "project" so the shared compliance module can render establishment-wide,
  // spanning every team member and all attendance the user owns (standalone:true).
  SW.Compliance.mount(document.getElementById("compRoot"), {
    user,
    standalone: true,
    project: { id:"__standalone__", name:"Establishment-wide (all team)", district: company.district||"", state: company.state||"" }
  });

  SW.UI.helpSection(document.querySelector(".app-content"), "Compliance Registers & Forms", [
    "This is the establishment-wide view — it spans every team member you've added (across all projects) and all their attendance, so you can maintain and print statutory records without opening a specific project.",
    "Registers (Ease of Compliance 2017 Forms A–E, ESIC, EPF, Overtime, Accident; CLRA Forms XII/XIII/XVI/XVII/XX–XXIII; Bonus; EPF Form 5/10) auto-fill from your team & attendance — every cell is editable, add blank rows or reset to actual data.",
    "Declaration & Nomination Forms (EPF 11/2/3A/19/10C, ESIC 1/1A/37, Gratuity F, CLRA XIX wage slip, BOCW establishment & worker registration) — pick a team member to auto-fill or keep blank.",
    "Print Blank gives a clean, properly-spaced template you can fill by hand (wide fields like bank account and address get full-width writing space); Print Filled prints your entered data. Everything saves automatically."
  ]);
})();
