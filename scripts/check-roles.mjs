const BASE = "http://localhost:3333/api";
const adminToken = (await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@montadores.com", password: "Admin@2026!" })
})).json()).token;

const provs = await (await fetch(`${BASE}/providers?limit=10`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
console.log("Providers:", (Array.isArray(provs) ? provs : []).map(p => p.email));

let montadorToken = null;
let montadorEmail = null;
for (const p of (Array.isArray(provs) ? provs : [])) {
  for (const pwd of ["Montador@2026!", "montador123", "123456"]) {
    const r = await (await fetch(`${BASE}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: p.email, password: pwd })
    })).json();
    if (r.token) { montadorToken = r.token; montadorEmail = p.email; break; }
  }
  if (montadorToken) break;
}

if (montadorToken) {
  const me = await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${montadorToken}` } })).json();
  console.log("Montador:", montadorEmail);
  console.log("Roles:", JSON.stringify(me?.roles));
  console.log("Full me:", JSON.stringify(me));
} else {
  console.log("Nenhum montador com senha conhecida encontrado nos providers.");
  // Lista usuários do sistema
  const users = await (await fetch(`${BASE}/users`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
  console.log("Usuários sistema:", JSON.stringify(users).slice(0, 500));
}
