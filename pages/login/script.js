(function(){
  "use strict";
  const U = SW.Utils, DB = SW.DB, Auth = SW.Auth;

  // If already logged in, go straight to the dashboard.
  const existing = Auth.currentUser();
  if(existing){ location.href = Auth.homeFor(existing.role); return; }

  const params = new URLSearchParams(location.search);
  let currentRole = params.get("role") || "pm";
  if(!["pm","contractor","admin"].includes(currentRole)) currentRole = "pm";

  const ROLE_LABEL = { pm:"Project Manager", contractor:"Contractor", admin:"Admin" };
  const roleTabs = document.getElementById("roleTabs");

  function setRole(role){
    currentRole = role;
    U.qsa("button", roleTabs).forEach(b=>b.classList.toggle("active", b.dataset.role===role));
    document.getElementById("roleLabelText").textContent = ROLE_LABEL[role];
    document.getElementById("roleLabelText2").textContent = ROLE_LABEL[role];
    U.qsa(".contractor-only").forEach(el=> el.classList.toggle("hidden", role!=="contractor"));
    const note = document.getElementById("registerNote");
    note.textContent = role==="contractor"
      ? "Contractor accounts are reviewed by admin before you can bid (usually within a few hours)."
      : (role==="pm" ? "Project Manager accounts are activated instantly." : "Admin accounts must be created by an existing administrator.");
    document.querySelector("#registerForm button[type=submit]").disabled = role==="admin";
  }
  roleTabs.addEventListener("click", e=>{ const btn=e.target.closest("button"); if(btn) setRole(btn.dataset.role); });
  setRole(currentRole);

  document.getElementById("showRegister").addEventListener("click", e=>{ e.preventDefault(); document.getElementById("loginPanel").classList.add("hidden"); document.getElementById("registerPanel").classList.remove("hidden"); });
  document.getElementById("showLogin").addEventListener("click", e=>{ e.preventDefault(); document.getElementById("registerPanel").classList.add("hidden"); document.getElementById("loginPanel").classList.remove("hidden"); });

  // ---- Demo login ----
  function demoLogin(role){
    const res = Auth.loginAsDemo(role);
    if(res.ok){ U.toast("Welcome, "+res.user.name+"!", {title:"Demo login successful", type:"success"}); setTimeout(()=> location.href = Auth.homeFor(role), 400); }
    else U.toast(res.error, {type:"danger"});
  }
  document.getElementById("demoLoginBtn").addEventListener("click", ()=> demoLogin(currentRole));
  const demoParam = params.get("demo");
  if(demoParam==="1") demoLogin(currentRole);
  else if(["pm","contractor","admin"].includes(demoParam)) demoLogin(demoParam);

  // ---- Login form ----
  document.getElementById("loginForm").addEventListener("submit", e=>{
    e.preventDefault();
    if(!U.validateForm(e.target)) return;
    const fd = new FormData(e.target);
    const res = Auth.login(fd.get("identifier").trim(), fd.get("password"), !!fd.get("remember"));
    if(res.ok){
      if(res.user.role !== currentRole){
        U.toast(`This account is registered as ${ROLE_LABEL[res.user.role]}. Redirecting you there.`, {type:"warning"});
      } else {
        U.toast("Logged in successfully.", {title:"Welcome back", type:"success"});
      }
      setTimeout(()=> location.href = Auth.homeFor(res.user.role), 500);
    } else {
      U.toast(res.error, {title:"Login failed", type:"danger"});
    }
  });

  // ---- Register form ----
  document.getElementById("registerForm").addEventListener("submit", e=>{
    e.preventDefault();
    if(currentRole==="admin"){ U.toast("Admin accounts can only be created by an existing administrator.", {type:"danger"}); return; }
    if(!U.validateForm(e.target)) return;
    const fd = new FormData(e.target);
    const res = Auth.register({
      name: fd.get("name").trim(), companyName: fd.get("companyName").trim(),
      email: fd.get("email").trim(), phone: fd.get("phone").trim(),
      district: fd.get("district").trim(), state: fd.get("state").trim(),
      gst: fd.get("gst")||"", password: fd.get("password"), role: currentRole
    });
    if(res.ok){
      if(res.user.status==="pending"){
        U.toast("Account created! It is pending admin approval — you'll be notified once active.", {title:"Almost there", type:"warning", duration:6000});
        e.target.reset();
        document.getElementById("showLogin").click();
      } else {
        U.toast("Account created successfully. Logging you in…", {title:"Welcome", type:"success"});
        Auth.login(res.user.email, fd.get("password"), true);
        setTimeout(()=> location.href = Auth.homeFor(res.user.role), 500);
      }
    } else {
      U.toast(res.error, {title:"Could not register", type:"danger"});
    }
  });

  // ---- Forgot password (simulated OTP flow) ----
  document.getElementById("forgotLink").addEventListener("click", e=>{ e.preventDefault(); U.openModal("forgotModal"); document.getElementById("forgotStep1").classList.remove("hidden"); document.getElementById("forgotStep2").classList.add("hidden"); });
  let otpTargetUser = null;
  document.getElementById("sendOtpBtn").addEventListener("click", ()=>{
    const id = document.getElementById("forgotIdentifier").value.trim();
    const user = DB.users.list().find(u=>u.email===id || u.phone===id);
    if(!user){ U.toast("No account found with that email/mobile.", {type:"danger"}); return; }
    otpTargetUser = user;
    U.toast("OTP sent (simulated).", {type:"success"});
    document.getElementById("forgotStep1").classList.add("hidden");
    document.getElementById("forgotStep2").classList.remove("hidden");
  });
  document.getElementById("resetPasswordBtn").addEventListener("click", ()=>{
    const otp = document.getElementById("otpInput").value.trim();
    const pwd = document.getElementById("newPasswordInput").value;
    if(otp!=="123456"){ U.toast("Incorrect OTP.", {type:"danger"}); return; }
    if(pwd.length<6){ U.toast("Password must be at least 6 characters.", {type:"danger"}); return; }
    DB.users.update(otpTargetUser.id, {password:pwd});
    U.toast("Password reset. Please log in with your new password.", {title:"Success", type:"success"});
    U.closeModal("forgotModal");
  });

  document.getElementById("loginHelpBtn").addEventListener("click", ()=> U.openModal("loginHelpModal"));

  const clockEl = document.createElement("div");
  clockEl.className = "floating-clock no-print";
  document.body.appendChild(clockEl);
  U.startClock(clockEl);

  U.bindModalDismiss();
  U.bindRipple();
  U.initTheme();
})();
