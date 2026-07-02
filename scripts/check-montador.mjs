const BASE = "http://localhost:3333/api";
const adminToken = (await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@montadores.com", password: "Admin@2026!" })
})).json()).token;

// Tenta login com vários emails de providers
const provs = await (await fetch(`${BASE}/providers?limit=20`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
const emails = (Array.isArray(provs) ? provs : []).map(p => p.email).filter(Boolean);
console.log("Emails de providers:", emails);

for (const email of emails) {
  for (const pwd of ["Montador@2026!", "montador123", "123456", "Admin@2026!", "cleiton123"]) {
    try {
      const r = await (await fetch(`${BASE}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pwd })
      })).json();
      if (r.token) {
        const me = await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${r.token}` } })).json();
        console.log(`ENCONTRADO: email=${email} pwd=${pwd} roles=${JSON.stringify(me?.roles)}`);
      }
    } catch { /* ignore */ }
  }
}
