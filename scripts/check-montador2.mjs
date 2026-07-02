const BASE = "http://localhost:3333/api";
const adminToken = (await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@montadores.com", password: "Admin@2026!" })
})).json()).token;

const raw = await (await fetch(`${BASE}/providers?limit=20`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
console.log("Tipo:", Array.isArray(raw) ? "array" : typeof raw);
console.log("Keys:", Object.keys(raw ?? {}));
const list = Array.isArray(raw) ? raw : (raw?.items ?? raw?.data ?? []);
console.log("Providers count:", list.length);
for (const p of list.slice(0, 5)) {
  console.log("Provider:", JSON.stringify({ id: p.id?.slice(0,8), email: p.email, name: p.name }));
}

// Agora tenta descobrir qual montador foi usado no último run
// No regression test: `montador=true` e job=488885b6
// Vamos checar quem é o provider do job 488885b6
const job = await (await fetch(`${BASE}/assembly/jobs/488885b6`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
console.log("\nJob 488885b6:", JSON.stringify({ provider_id: job?.provider_id?.slice(0,8), status: job?.status }));
if (job?.provider_id) {
  const prov = await (await fetch(`${BASE}/providers/${job.provider_id}`, { headers: { Authorization: `Bearer ${adminToken}` } })).json();
  console.log("Provider do job:", JSON.stringify({ email: prov?.email, name: prov?.name }));
}
