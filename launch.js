// Only fixed dashboard destinations are accepted. This is navigation, not auth.
(function(){
 const access=document.currentScript.dataset.access;
 const values=new URL(location.href).searchParams.getAll('csc_portal');
 const portal=values.length===1?values[0]:null;
 const destinations={students:'https://centralstudentcouncil2026-rgb.github.io/CSC-Websites/',cole:'https://centralstudentcouncil2026-rgb.github.io/CSC-SYNC-Org/cole.html',officers:'https://centralstudentcouncil2026-rgb.github.io/CSC-SYNC-Admin/csc-officers.html'};
 const source=access==='staff'?'officers':portal==='cole'?'cole':'students';
 document.querySelectorAll('[data-dashboard-back]').forEach(link=>{link.href=destinations[source];});
})();
