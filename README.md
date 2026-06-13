# App Montadores

Plataforma inteligente de jornada pós-venda para gestão de pedidos, montagem, avaliação, SAC e financeiro, com integração Oracle/WinThor.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 19 + TypeScript + Vite (porta 5173) |
| Backend | Express 5 + TypeScript + tsx (porta 3333) |
| Banco de dados | Oracle (pool oracledb) — schema `U_CC4UJM_WI` |
| Integração | WinThor via tabelas PCPEDC, PCPEDI, PCCLIENT, PCPRODUT, PCDEPTO, PCCARREG, PCCARGA |

> Não há SQLite em produção. Todas as tabelas (`MONT_*` e WinThor) residem no mesmo Oracle.

## Como rodar em desenvolvimento

```bash
npm install
cp .env.example .env   # preencha as credenciais Oracle
npm run dev            # inicia Vite (5173) + Express (3333) em paralelo
```

Para reiniciar os servidores após alterações:

```powershell
.\scripts\restart-dev.ps1
```

URLs:
- Frontend: http://localhost:5173/montadores/dashboard
- API: http://localhost:3333/api/health

## Variáveis de ambiente

| Variável | Descrição |
|---------|-----------|
| `PORT` | Porta do servidor Express (padrão: 3333) |
| `APP_BASE_URL` | URL base pública (ex: https://montadores.exemplo.com) |
| `ORACLE_USER` | Usuário Oracle (schema `U_CC4UJM_WI`) |
| `ORACLE_PASSWORD` | Senha Oracle |
| `ORACLE_CONNECT_STRING` | Connect string TNS ou EZConnect |
| `ORACLE_POOL_MIN` | Conexões mínimas no pool (padrão: 2) |
| `ORACLE_POOL_MAX` | Conexões máximas no pool (padrão: 10) |
| `ORACLE_POOL_INCREMENT` | Incremento do pool (padrão: 1) |
| `JWT_SECRET` | Segredo para assinar tokens JWT HS256 |
| `PUBLIC_TOKEN_TTL_HOURS` | TTL dos tokens públicos de jornada (padrão: 72) |
| `CORS_ORIGINS` | Origens permitidas em produção (vírgula separadas) |

## Regras de elegibilidade para montagem

Um pedido aparece na **Agenda** e pode ser agendado apenas se tiver ao menos um produto elegível:

1. **Por produto individual**: `CODPROD` cadastrado em `MONT_PRODUCT_COMMISSIONS` com `ACTIVE = 1`
2. **Por departamento**: `PCPRODUT.CODEPTO` cadastrado em `MONT_DEPT_COMMISSIONS` com `ACTIVE = 1`

Configure as regras em `/montadores/comissoes`. Pedidos sem nenhum produto elegível são filtrados automaticamente na Agenda e bloqueados no agendamento.

## Cálculo de comissão do montador

O valor pago ao montador vem de `PCPEDI` × regras de comissão (não de valores fixos):

- **PERCENTAGE**: `quantidade × preço_venda × (percentual / 100)`
- **FIXED_AMOUNT**: `quantidade × valor_fixo`

O valor é calculado no momento do agendamento e gravado em `MONT_PROVIDER_PAYMENTS.AMOUNT`.

## RBAC — Controle de acesso por papel

| Papel | Acesso |
|-------|--------|
| ADMIN | Tudo |
| GESTOR | Tudo exceto ações de MONTADOR |
| OPERACAO | Agenda, Pedidos, SAC |
| LOGISTICA | Agenda, Pedidos |
| FINANCEIRO | Financeiro, Comissões (leitura) |
| SAC | SAC |
| MONTADOR | App Montador, Minhas Montagens |
| CONSULTA | Dashboard, Pedidos (somente leitura) |

## Integração WinThor

### Tabelas consultadas

| Tabela WinThor | Uso |
|---------------|-----|
| `PCPEDC` | Cabeçalho do pedido (NUMPED, CODCLI, POSICAO, CONDVENDA, CODFILIAL) |
| `PCPEDI` | Itens do pedido (CODPROD, QT, PVENDA, POSICAO) |
| `PCCLIENT` | Dados do cliente (NOME, ENDEREÇO, FONE) |
| `PCPRODUT` | Produto (DESCRICAO, CODEPTO) — liga produto ao departamento |
| `PCDEPTO` | Departamento (CODEPTO, DESCRICAO) |
| `PCCARREG` | Carregamento — usado para detectar entrega (DTFECHA) |
| `PCCARGA` | Carga logística |

### POSICAO codes

| POSICAO | Significado |
|---------|------------|
| `A` / null | Em aberto (pré-faturamento) |
| `F` | Faturado |
| `C` | Cancelado |

### Fluxo de sincronização

`WinthorSyncService` snapshot pedidos do WinThor → `MONT_ORDERS` + `MONT_ORDER_ITEMS`. A agenda consulta `PCPEDC`/`PCCARREG` diretamente via `WinthorAgendaRepository`.

## Smoke tests

```bash
npm test                     # roda vitest (tests/smoke.test.ts)
SMOKE_TOKEN=<jwt> npm test   # habilita testes autenticados
```

## Docker

```bash
docker-compose up --build
```

A imagem usa Node 22 Alpine. O servidor fica em `http://localhost:3333`.

## Rotas principais

### Públicas (sem auth)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/health` | Saúde do serviço e Oracle |
| POST | `/api/auth/login` | Login (retorna JWT) |
| GET | `/api/public/journey/:token` | Jornada pública do cliente |
| POST | `/api/providers/register` | Cadastro de prestador |

### Protegidas (JWT obrigatório)

| Método | Rota | Roles mínimas |
|--------|------|--------------|
| GET | `/api/orders` | Qualquer autenticado |
| GET | `/api/agenda/candidatos` | OPERACAO, LOGISTICA, GESTOR, ADMIN |
| GET/PUT/DELETE | `/api/commissions/*` | Leitura: OPERACAO+; Escrita: GESTOR, ADMIN |
| GET | `/api/payments` | FINANCEIRO, GESTOR, ADMIN |
| POST | `/api/payments/:id/release` | FINANCEIRO, GESTOR, ADMIN |
| GET | `/api/audit-logs` | GESTOR, ADMIN |
| GET | `/api/orders/:id/eligible-products` | Qualquer autenticado |

## Arquitetura de eventos

Toda ação relevante emite um evento via `EventService`:
- Gravado em `MONT_ORDER_EVENTS` (timeline do pedido)
- Gravado em `MONT_AUDIT_LOGS` (trilha de auditoria)
- Idempotência via chave única por evento

## Limitações conhecidas

- Mensageria (WhatsApp/SMS) permanece em **DRY_RUN** — nenhuma mensagem real é enviada ao cliente.
- Upload de arquivos usa URL local (`/uploads/`); sem S3 integrado.
- Jobs batch não possuem cron automático — sincronização manual via `/api/integration/winthor`.
- Matching geográfico de montadores por CEP é planejado para versão futura.
