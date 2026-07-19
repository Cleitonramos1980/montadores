/**
 * OpenAPI 3.0 specification for App Montadores API.
 * Mounted at GET /api/docs (dev only).
 * Covers auth, health, users, providers, orders, payments, evaluations, jobs.
 */

const bearer = {
  BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
} as const;

const schemas = {
  Error: {
    type: "object",
    properties: {
      error: { type: "string", example: "Mensagem de erro" },
      code:  { type: "string", example: "NOT_FOUND" },
    },
    required: ["error"],
  },
  LoginBody: {
    type: "object",
    required: ["email", "password"],
    properties: {
      email:    { type: "string", format: "email",    example: "admin@empresa.com" },
      password: { type: "string", format: "password", example: "Senha@123" },
    },
  },
  AuthResponse: {
    type: "object",
    properties: {
      token: { type: "string", description: "JWT de acesso (8h por padrão)" },
      user: {
        type: "object",
        properties: {
          id:    { type: "string" },
          name:  { type: "string" },
          email: { type: "string" },
          roles: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  User: {
    type: "object",
    properties: {
      id:        { type: "string" },
      name:      { type: "string" },
      email:     { type: "string", format: "email" },
      status:    { type: "string", enum: ["ATIVO", "INATIVO"] },
      roles:     { type: "array", items: { type: "string" } },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  Provider: {
    type: "object",
    properties: {
      id:          { type: "string" },
      name:        { type: "string" },
      document:    { type: "string", description: "CPF/CNPJ" },
      status:      { type: "string", enum: ["PENDENTE", "APROVADO", "REPROVADO", "SUSPENSO"] },
      uf:          { type: "string", example: "SP" },
      city:        { type: "string" },
      capacity:    { type: "number" },
      rating:      { type: "number", description: "Nota média 0-10" },
    },
  },
  Order: {
    type: "object",
    properties: {
      id:      { type: "string" },
      numped:  { type: "string", description: "Número do pedido WinThor" },
      codcli:  { type: "string", description: "Código do cliente WinThor" },
      status:  { type: "string" },
      phase:   { type: "string" },
      client:  { type: "object", properties: { name: { type: "string" }, phone: { type: "string" } } },
    },
  },
  Branding: {
    type: "object",
    properties: {
      companyName:  { type: "string" },
      logoUrl:      { type: "string", nullable: true },
      primaryColor: { type: "string", example: "#1F2855" },
      supportPhone: { type: "string", nullable: true },
    },
  },
  Commission: {
    type: "object",
    properties: {
      id:                 { type: "string" },
      codprod:            { type: "string", description: "Código do produto WinThor" },
      description:        { type: "string" },
      vlmaodeobra:        { type: "number", description: "Valor de mão de obra (referência WinThor)" },
      commission_percent: { type: "number", description: "Percentual de comissão aplicado sobre a base" },
      active:             { type: "integer", enum: [0, 1] },
      notes:              { type: "string", nullable: true },
    },
  },
};

const paths: Record<string, unknown> = {
  "/health": {
    get: {
      tags: ["Sistema"],
      summary: "Health check público",
      responses: {
        200: {
          description: "Servidor ativo",
          content: { "application/json": { schema: {
            type: "object",
            properties: {
              ok:      { type: "boolean" },
              service: { type: "string" },
              db:      { type: "string", enum: ["ok", "disabled", "error"] },
            },
          }}},
        },
      },
    },
  },

  "/public/branding": {
    get: {
      tags: ["Sistema"],
      summary: "Identidade visual pública (sem auth) — cache 10 min",
      responses: {
        200: { description: "Branding", content: { "application/json": { schema: { $ref: "#/components/schemas/Branding" } } } },
      },
    },
  },

  "/auth/login": {
    post: {
      tags: ["Autenticação"],
      summary: "Login — retorna JWT",
      requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } } } },
      responses: {
        200: { description: "Autenticado",        content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse" } } } },
        401: { description: "Credenciais inválidas", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        422: { description: "Dados inválidos",       content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/auth/me": {
    get: {
      tags: ["Autenticação"],
      summary: "Retorna o usuário autenticado e suas roles",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Usuário", content: { "application/json": { schema: { $ref: "#/components/schemas/AuthResponse/properties/user" } } } },
        401: { description: "Não autenticado" },
      },
    },
  },

  "/users": {
    get: {
      tags: ["Usuários"],
      summary: "Lista todos os usuários (ADMIN)",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Lista de usuários", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/User" } } } } },
        403: { description: "Permissão insuficiente" },
      },
    },
    post: {
      tags: ["Usuários"],
      summary: "Cria usuário (ADMIN)",
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: {
          type: "object", required: ["name", "email", "password", "roles"],
          properties: {
            name:     { type: "string" },
            email:    { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            roles:    { type: "array", items: { type: "string" }, example: ["GESTOR"] },
          },
        }}},
      },
      responses: {
        201: { description: "Usuário criado", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
        409: { description: "E-mail já cadastrado" },
        422: { description: "Dados inválidos" },
      },
    },
  },

  "/users/{id}": {
    get: {
      tags: ["Usuários"],
      summary: "Detalhe de usuário (ADMIN)",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Usuário", content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } } },
        404: { description: "Não encontrado" },
      },
    },
    patch: {
      tags: ["Usuários"],
      summary: "Atualiza usuário (ADMIN)",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        content: { "application/json": { schema: {
          type: "object",
          properties: {
            name:     { type: "string" },
            status:   { type: "string", enum: ["ATIVO", "INATIVO"] },
            password: { type: "string" },
            roles:    { type: "array", items: { type: "string" } },
          },
        }}},
      },
      responses: {
        200: { description: "Atualizado" },
        404: { description: "Não encontrado" },
      },
    },
    delete: {
      tags: ["Usuários"],
      summary: "Desativa usuário (ADMIN) — soft delete",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Desativado" },
        400: { description: "Auto-desativação não permitida" },
        404: { description: "Não encontrado" },
      },
    },
  },

  "/providers": {
    get: {
      tags: ["Montadores"],
      summary: "Lista montadores",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "status", in: "query", schema: { type: "string", enum: ["PENDENTE","APROVADO","REPROVADO","SUSPENSO"] } },
        { name: "uf",     in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
      ],
      responses: {
        200: { description: "Lista", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Provider" } } } } },
      },
    },
  },

  "/providers/{id}": {
    get: {
      tags: ["Montadores"],
      summary: "Detalhe do montador",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: { description: "Montador", content: { "application/json": { schema: { $ref: "#/components/schemas/Provider" } } } },
        404: { description: "Não encontrado" },
      },
    },
  },

  "/orders": {
    get: {
      tags: ["Pedidos"],
      summary: "Lista pedidos com filtros",
      security: [{ BearerAuth: [] }],
      parameters: [
        { name: "phase",  in: "query", schema: { type: "string" } },
        { name: "search", in: "query", schema: { type: "string" } },
        { name: "page",   in: "query", schema: { type: "integer", default: 1 } },
        { name: "limit",  in: "query", schema: { type: "integer", default: 50 } },
      ],
      responses: {
        200: { description: "Pedidos", content: { "application/json": { schema: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Order" } },
            total: { type: "integer" },
          },
        }}}},
      },
    },
  },

  "/flow-ruler": {
    get: {
      tags: ["Régua de Fluxo"],
      summary: "Lista regras do fluxo de mensagens — cache 5 min",
      security: [{ BearerAuth: [] }],
      responses: { 200: { description: "Regras" } },
    },
  },

  "/eval-configs": {
    get: {
      tags: ["Avaliações"],
      summary: "Lista configurações de avaliação — cache 5 min",
      security: [{ BearerAuth: [] }],
      responses: { 200: { description: "Configs" } },
    },
  },

  "/commissions": {
    get: {
      tags: ["Comissões"],
      summary: "Lista comissões de produto configuradas",
      security: [{ BearerAuth: [] }],
      responses: {
        200: { description: "Comissões", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Commission" } } } } },
      },
    },
  },

  "/commissions/{codprod}": {
    put: {
      tags: ["Comissões"],
      summary: "Cria ou atualiza a comissão de um produto (ADMIN/GESTOR)",
      security: [{ BearerAuth: [] }],
      parameters: [{ name: "codprod", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: {
          type: "object", required: ["description", "commissionPercent"],
          properties: {
            description:       { type: "string", minLength: 2 },
            vlmaodeobra:       { type: "number", minimum: 0, default: 0 },
            commissionPercent: { type: "number", minimum: 0.01, maximum: 100 },
            active:            { type: "boolean", default: true },
            notes:             { type: "string" },
          },
        }}},
      },
      responses: {
        200: { description: "Comissão salva", content: { "application/json": { schema: { $ref: "#/components/schemas/Commission" } } } },
        403: { description: "Permissão insuficiente" },
        422: { description: "Dados inválidos" },
      },
    },
  },
};

export function buildOpenApiSpec(baseUrl: string) {
  return {
    openapi: "3.0.0",
    info: {
      title:       "App Montadores API",
      version:     "1.0.0",
      description: "API para gestão de montadores, pedidos, comissões e mensagens automáticas.",
      contact:     { email: "ti@empresa.com" },
    },
    servers: [{ url: `${baseUrl}/api`, description: "Servidor atual" }],
    tags: [
      { name: "Sistema",        description: "Health check e configurações públicas" },
      { name: "Autenticação",   description: "Login, logout e sessão" },
      { name: "Usuários",       description: "Gestão de usuários do backoffice" },
      { name: "Montadores",     description: "Cadastro e gestão de prestadores" },
      { name: "Pedidos",        description: "Pedidos WinThor sincronizados" },
      { name: "Régua de Fluxo", description: "Configuração de eventos e mensagens" },
      { name: "Avaliações",     description: "Configurações de formulários de avaliação" },
      { name: "Comissões",      description: "Comissões de produto por CODPROD" },
    ],
    components: {
      securitySchemes: bearer,
      schemas,
    },
    paths,
  };
}
