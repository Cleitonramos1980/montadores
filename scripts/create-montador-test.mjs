// Cria usuário de teste com role exclusiva MONTADOR
// Usa endpoint de registro de provider + criação de user no sistema
const BASE = "http://localhost:3333/api";
const adminToken = (await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@montadores.com", password: "Admin@2026!" })
})).json()).token;

if (!adminToken) { console.error("Admin login falhou"); process.exit(1); }

// Tenta criar user com role MONTADOR via endpoint de usuários
const email = "test.montador.regress@example.com";
const password = "Montador@Regress1!";

// Verifica se já existe
const me = await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password })
})).json();

if (me.token) {
  const meMe = await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${me.token}` } })).json();
  console.log("Usuário MONTADOR de teste já existe:", JSON.stringify({ roles: meMe?.roles }));
  process.exit(0);
}

// Cria via /auth/register (se existir) ou /users
const createR = await (await fetch(`${BASE}/users`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify({ name: "Test Montador Regress", email, password, roles: ["MONTADOR"] })
})).json();

console.log("Criar usuário result:", JSON.stringify(createR));

// Valida login
const loginR = await (await fetch(`${BASE}/auth/login`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password })
})).json();

if (loginR.token) {
  const meR = await (await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${loginR.token}` } })).json();
  console.log("Login OK, roles:", JSON.stringify(meR?.roles));
} else {
  console.log("Login falhou:", JSON.stringify(loginR));
}
