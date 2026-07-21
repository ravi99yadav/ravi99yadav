/* ==========================================================================
   SUBLETWORKS.COM — India States & Districts (predefined dropdown data)
   ========================================================================== */
(function(global){
  "use strict";

  const DISTRICTS_BY_STATE = {
    "Andhra Pradesh": ["Anantapur","Chittoor","East Godavari","Guntur","Krishna","Kurnool","Nellore","Prakasam","Srikakulam","Visakhapatnam","Vizianagaram","West Godavari","YSR Kadapa"],
    "Arunachal Pradesh": ["Itanagar","Tawang","West Kameng","East Kameng","Papum Pare","Lower Subansiri","Upper Subansiri","West Siang","East Siang","Lohit","Changlang","Tirap"],
    "Assam": ["Guwahati (Kamrup Metro)","Kamrup","Dibrugarh","Jorhat","Silchar (Cachar)","Nagaon","Tinsukia","Barpeta","Sonitpur","Nalbari","Golaghat","Karimganj"],
    "Bihar": ["Patna","Gaya","Bhagalpur","Muzaffarpur","Darbhanga","Purnia","Begusarai","Nalanda","Saran","Vaishali","Samastipur","Munger","Rohtas","Katihar"],
    "Chhattisgarh": ["Raipur","Bilaspur","Durg","Korba","Rajnandgaon","Raigarh","Jagdalpur (Bastar)","Ambikapur (Surguja)","Dhamtari","Kanker"],
    "Goa": ["North Goa","South Goa"],
    "Gujarat": ["Ahmedabad","Surat","Vadodara","Rajkot","Bhavnagar","Jamnagar","Junagadh","Gandhinagar","Anand","Mehsana","Kutch","Navsari","Bharuch","Valsad"],
    "Haryana": ["Gurugram","Faridabad","Panipat","Ambala","Karnal","Hisar","Rohtak","Sonipat","Yamunanagar","Panchkula","Kurukshetra","Sirsa","Bhiwani","Rewari"],
    "Himachal Pradesh": ["Shimla","Kangra","Mandi","Solan","Una","Hamirpur","Bilaspur","Chamba","Kullu","Sirmaur"],
    "Jharkhand": ["Ranchi","Jamshedpur (East Singhbhum)","Dhanbad","Bokaro","Hazaribagh","Deoghar","Giridih","Ramgarh","Dumka","Palamu"],
    "Karnataka": ["Bengaluru Urban","Mysuru","Mangaluru (Dakshina Kannada)","Hubballi-Dharwad","Belagavi","Kalaburagi","Ballari","Shivamogga","Tumakuru","Davanagere","Udupi","Bengaluru Rural","Bidar","Vijayapura"],
    "Kerala": ["Thiruvananthapuram","Ernakulam","Kozhikode","Thrissur","Kollam","Kannur","Alappuzha","Palakkad","Malappuram","Kottayam","Idukki","Wayanad","Pathanamthitta","Kasaragod"],
    "Madhya Pradesh": ["Indore","Bhopal","Jabalpur","Gwalior","Ujjain","Sagar","Rewa","Satna","Ratlam","Dewas","Chhindwara","Vidisha"],
    "Maharashtra": ["Mumbai City","Mumbai Suburban","Pune","Nagpur","Nashik","Thane","Aurangabad (Chhatrapati Sambhajinagar)","Solapur","Kolhapur","Amravati","Nanded","Sangli","Satara","Ahmednagar","Raigad","Palghar"],
    "Manipur": ["Imphal East","Imphal West","Bishnupur","Thoubal","Churachandpur","Senapati"],
    "Meghalaya": ["East Khasi Hills","West Khasi Hills","Ri Bhoi","East Garo Hills","West Garo Hills","Jaintia Hills"],
    "Mizoram": ["Aizawl","Lunglei","Champhai","Kolasib","Serchhip","Mamit"],
    "Nagaland": ["Kohima","Dimapur","Mokokchung","Tuensang","Wokha","Zunheboto"],
    "Odisha": ["Bhubaneswar (Khordha)","Cuttack","Rourkela (Sundargarh)","Puri","Sambalpur","Berhampur (Ganjam)","Balasore","Mayurbhanj","Kalahandi","Angul"],
    "Punjab": ["Ludhiana","Amritsar","Jalandhar","Patiala","Bathinda","Mohali (SAS Nagar)","Hoshiarpur","Firozpur","Moga","Sangrur","Kapurthala","Gurdaspur"],
    "Rajasthan": ["Jaipur","Jodhpur","Udaipur","Kota","Ajmer","Bikaner","Alwar","Bharatpur","Sikar","Bhilwara","Sri Ganganagar","Pali","Nagaur"],
    "Sikkim": ["East Sikkim","West Sikkim","North Sikkim","South Sikkim"],
    "Tamil Nadu": ["Chennai","Coimbatore","Madurai","Tiruchirappalli","Salem","Tirunelveli","Erode","Vellore","Thoothukudi","Thanjavur","Dindigul","Kanchipuram","Cuddalore","Karur"],
    "Telangana": ["Hyderabad","Rangareddy","Warangal Urban","Nizamabad","Karimnagar","Khammam","Nalgonda","Mahbubnagar","Medchal-Malkajgiri","Sangareddy"],
    "Tripura": ["West Tripura","Sepahijala","Gomati","South Tripura","Dhalai","Unakoti","North Tripura"],
    "Uttar Pradesh": ["Lucknow","Kanpur Nagar","Ghaziabad","Agra","Varanasi","Meerut","Prayagraj","Noida","Bareilly","Aligarh","Moradabad","Saharanpur","Gorakhpur","Jhansi","Muzaffarnagar"],
    "Uttarakhand": ["Dehradun","Haridwar","Nainital","Udham Singh Nagar","Pauri Garhwal","Almora","Tehri Garhwal","Chamoli"],
    "West Bengal": ["Kolkata","Howrah","North 24 Parganas","South 24 Parganas","Hooghly","Nadia","Paschim Bardhaman","Purba Bardhaman","Darjeeling","Malda","Murshidabad","Purba Medinipur","Paschim Medinipur"],
    "Andaman and Nicobar Islands": ["South Andaman","North and Middle Andaman","Nicobar"],
    "Chandigarh": ["Chandigarh"],
    "Dadra and Nagar Haveli and Daman and Diu": ["Dadra and Nagar Haveli","Daman","Diu"],
    "Delhi": ["Delhi","Central Delhi","East Delhi","New Delhi","North Delhi","North East Delhi","North West Delhi","Shahdara","South Delhi","South East Delhi","South West Delhi","West Delhi"],
    "Jammu and Kashmir": ["Srinagar","Jammu","Anantnag","Baramulla","Udhampur","Kathua","Pulwama","Budgam"],
    "Ladakh": ["Leh","Kargil"],
    "Lakshadweep": ["Lakshadweep"],
    "Puducherry": ["Puducherry","Karaikal","Mahe","Yanam"]
  };

  const STATES = Object.keys(DISTRICTS_BY_STATE).sort();

  function populateStateSelect(sel, selected){
    if(!sel) return;
    sel.innerHTML = `<option value="">— Select State —</option>` + STATES.map(s=>`<option value="${s}" ${s===selected?"selected":""}>${s}</option>`).join("");
  }

  function populateDistrictSelect(sel, state, selected){
    if(!sel) return;
    const districts = DISTRICTS_BY_STATE[state] || [];
    sel.innerHTML = `<option value="">${state ? "— Select District —" : "— Select State first —"}</option>` + districts.map(d=>`<option value="${d}" ${d===selected?"selected":""}>${d}</option>`).join("");
    sel.disabled = !state;
  }

  // Wires a State <select> to a District <select> so changing state repopulates
  // the district list. Pass currently-saved values to preselect on first render.
  function bindStateDistrict(stateSel, districtSel, opts){
    opts = opts || {};
    populateStateSelect(stateSel, opts.state);
    populateDistrictSelect(districtSel, opts.state, opts.district);
    stateSel.addEventListener("change", ()=>{
      populateDistrictSelect(districtSel, stateSel.value, null);
    });
  }

  global.SW = global.SW || {};
  global.SW.Geo = { STATES, DISTRICTS_BY_STATE, populateStateSelect, populateDistrictSelect, bindStateDistrict };
})(window);
