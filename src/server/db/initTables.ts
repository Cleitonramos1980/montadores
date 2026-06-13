import { createHash } from "node:crypto";
import { v4 as uuid } from "uuid";
import { config } from "../config";
import { executeOracle, isOracleEnabled } from "./oracle";
import { execDml, queryOne } from "./db";

type IndexDef = { name: string; table: string; columns: string; unique?: boolean };
type ColumnDef = { table: string; column: string; ddl: string };

let initialized = false;

const TABLES: Array<{ name: string; ddl: string }> = [
  {
    name: "MONT_USERS",
    ddl: `CREATE TABLE MONT_USERS (
      ID VARCHAR2(36) PRIMARY KEY,
      NAME VARCHAR2(255) NOT NULL,
      EMAIL VARCHAR2(255) NOT NULL,
      PASSWORD_HASH VARCHAR2(255),
      STATUS VARCHAR2(40) DEFAULT 'ATIVO' NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_USERS_EMAIL UNIQUE (EMAIL)
    )`,
  },
  {
    name: "MONT_ROLES",
    ddl: `CREATE TABLE MONT_ROLES (
      ID VARCHAR2(36) PRIMARY KEY,
      NAME VARCHAR2(80) NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_ROLES_NAME UNIQUE (NAME)
    )`,
  },
  {
    name: "MONT_PERMISSIONS",
    ddl: `CREATE TABLE MONT_PERMISSIONS (
      ID VARCHAR2(36) PRIMARY KEY,
      KEY VARCHAR2(120) NOT NULL,
      DESCRIPTION VARCHAR2(500) NOT NULL,
      CONSTRAINT UQ_MONT_PERMISSIONS_KEY UNIQUE (KEY)
    )`,
  },
  {
    name: "MONT_USER_ROLES",
    ddl: `CREATE TABLE MONT_USER_ROLES (
      USER_ID VARCHAR2(36) NOT NULL,
      ROLE_ID VARCHAR2(36) NOT NULL,
      CONSTRAINT PK_MONT_USER_ROLES PRIMARY KEY (USER_ID, ROLE_ID)
    )`,
  },
  {
    name: "MONT_ROLE_PERMISSIONS",
    ddl: `CREATE TABLE MONT_ROLE_PERMISSIONS (
      ROLE_ID VARCHAR2(36) NOT NULL,
      PERMISSION_ID VARCHAR2(36) NOT NULL,
      CONSTRAINT PK_MONT_ROLE_PERMS PRIMARY KEY (ROLE_ID, PERMISSION_ID)
    )`,
  },
  {
    name: "MONT_CUSTOMERS",
    ddl: `CREATE TABLE MONT_CUSTOMERS (
      ID VARCHAR2(36) PRIMARY KEY,
      CODCLI VARCHAR2(50) NOT NULL,
      NAME VARCHAR2(255) NOT NULL,
      PHONE VARCHAR2(50),
      DOCUMENT VARCHAR2(50),
      EMAIL VARCHAR2(255),
      ADDRESS_JSON CLOB DEFAULT '{}' NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_CUSTOMERS_CODCLI UNIQUE (CODCLI)
    )`,
  },
  {
    name: "MONT_ORDERS",
    ddl: `CREATE TABLE MONT_ORDERS (
      ID VARCHAR2(36) PRIMARY KEY,
      NUMPED VARCHAR2(50) NOT NULL,
      CODCLI VARCHAR2(50) NOT NULL,
      CUSTOMER_ID VARCHAR2(36) NOT NULL,
      BRANCH VARCHAR2(50),
      SELLER VARCHAR2(255),
      CITY VARCHAR2(100),
      UF VARCHAR2(10),
      TOTAL_AMOUNT NUMBER(14,2) DEFAULT 0 NOT NULL,
      CURRENT_STATUS VARCHAR2(80) DEFAULT 'PEDIDO_CRIADO' NOT NULL,
      HAS_ASSEMBLY NUMBER(1) DEFAULT 0 NOT NULL,
      ORACLE_PAYLOAD_JSON CLOB DEFAULT '{}' NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_ORDERS_NUMPED UNIQUE (NUMPED)
    )`,
  },
  {
    name: "MONT_ORDER_ITEMS",
    ddl: `CREATE TABLE MONT_ORDER_ITEMS (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      PRODUCT_ID VARCHAR2(100) NOT NULL,
      DESCRIPTION VARCHAR2(500) NOT NULL,
      QUANTITY NUMBER(10,2) NOT NULL,
      REQUIRES_ASSEMBLY NUMBER(1) DEFAULT 0 NOT NULL,
      ASSEMBLY_COST NUMBER(14,2) DEFAULT 0 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_ORDER_EVENTS",
    ddl: `CREATE TABLE MONT_ORDER_EVENTS (
      ID VARCHAR2(36) PRIMARY KEY,
      TYPE VARCHAR2(80) NOT NULL,
      NUMPED VARCHAR2(50) NOT NULL,
      CODCLI VARCHAR2(50),
      ASSEMBLY_ID VARCHAR2(36),
      PROVIDER_ID VARCHAR2(36),
      PAYMENT_ID VARCHAR2(36),
      PREVIOUS_STATUS VARCHAR2(80),
      NEW_STATUS VARCHAR2(80),
      ORIGIN VARCHAR2(40) NOT NULL,
      METADATA_JSON CLOB DEFAULT '{}' NOT NULL,
      USER_ID VARCHAR2(36),
      IP VARCHAR2(50),
      USER_AGENT VARCHAR2(500),
      IDEMPOTENCY_KEY VARCHAR2(255) NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_EVENTS_IDEMP UNIQUE (IDEMPOTENCY_KEY)
    )`,
  },
  {
    name: "MONT_ORDER_TIMELINE",
    ddl: `CREATE TABLE MONT_ORDER_TIMELINE (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      EVENT_ID VARCHAR2(36) NOT NULL,
      TITLE VARCHAR2(255) NOT NULL,
      DESCRIPTION VARCHAR2(4000) NOT NULL,
      VISIBLE_TO_CUSTOMER NUMBER(1) DEFAULT 1 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PUBLIC_TOKENS",
    ddl: `CREATE TABLE MONT_PUBLIC_TOKENS (
      ID VARCHAR2(36) PRIMARY KEY,
      TOKEN VARCHAR2(255) NOT NULL,
      ORDER_ID VARCHAR2(36),
      PROVIDER_ID VARCHAR2(36),
      PURPOSE VARCHAR2(80) NOT NULL,
      EXPIRES_AT TIMESTAMP NOT NULL,
      USED_AT TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_TOKENS_TOKEN UNIQUE (TOKEN)
    )`,
  },
  {
    name: "MONT_PROVIDERS",
    ddl: `CREATE TABLE MONT_PROVIDERS (
      ID VARCHAR2(36) PRIMARY KEY,
      NAME VARCHAR2(255) NOT NULL,
      DOCUMENT VARCHAR2(50) NOT NULL,
      PHONE VARCHAR2(50) NOT NULL,
      WHATSAPP VARCHAR2(50),
      EMAIL VARCHAR2(255),
      CITY VARCHAR2(100),
      UF VARCHAR2(10),
      REGIONS_JSON CLOB DEFAULT '[]' NOT NULL,
      SERVICE_TYPES_JSON CLOB DEFAULT '[]' NOT NULL,
      PRODUCT_TYPES_JSON CLOB DEFAULT '[]' NOT NULL,
      AVAILABILITY_JSON CLOB DEFAULT '{}' NOT NULL,
      CAPACITY_PER_DAY NUMBER(5) DEFAULT 1 NOT NULL,
      STATUS VARCHAR2(80) DEFAULT 'PRE_CADASTRO' NOT NULL,
      DOCUMENTS_VALIDATED NUMBER(1) DEFAULT 0 NOT NULL,
      ACTIVE NUMBER(1) DEFAULT 0 NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PROVIDER_DOCS",
    ddl: `CREATE TABLE MONT_PROVIDER_DOCS (
      ID VARCHAR2(36) PRIMARY KEY,
      PROVIDER_ID VARCHAR2(36) NOT NULL,
      DOCUMENT_TYPE VARCHAR2(80) NOT NULL,
      FILE_URL VARCHAR2(2000) NOT NULL,
      STATUS VARCHAR2(40) DEFAULT 'PENDENTE' NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PROVIDER_APPROVAL_LOGS",
    ddl: `CREATE TABLE MONT_PROVIDER_APPROVAL_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      PROVIDER_ID VARCHAR2(36) NOT NULL,
      ACTION VARCHAR2(40) NOT NULL,
      JUSTIFICATION VARCHAR2(2000) NOT NULL,
      USER_ID VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_ASSEMBLY_SCHEDULES",
    ddl: `CREATE TABLE MONT_ASSEMBLY_SCHEDULES (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      PROVIDER_ID VARCHAR2(36) NOT NULL,
      SCHEDULED_DATE VARCHAR2(20) NOT NULL,
      SCHEDULED_PERIOD VARCHAR2(20) NOT NULL,
      STATUS VARCHAR2(40) DEFAULT 'AGENDADA' NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_ASSEMBLY_SCHED UNIQUE (PROVIDER_ID, SCHEDULED_DATE, SCHEDULED_PERIOD)
    )`,
  },
  {
    name: "MONT_ASSEMBLY_JOBS",
    ddl: `CREATE TABLE MONT_ASSEMBLY_JOBS (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      SCHEDULE_ID VARCHAR2(36),
      PROVIDER_ID VARCHAR2(36),
      STATUS VARCHAR2(80) DEFAULT 'AGUARDANDO_AGENDAMENTO' NOT NULL,
      STARTED_AT TIMESTAMP,
      FINISHED_AT TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_ASSEMBLY_JOB_ITEMS",
    ddl: `CREATE TABLE MONT_ASSEMBLY_JOB_ITEMS (
      ID VARCHAR2(36) PRIMARY KEY,
      ASSEMBLY_JOB_ID VARCHAR2(36) NOT NULL,
      CODPROD NUMBER NOT NULL,
      DESCRICAO VARCHAR2(500),
      QUANTITY NUMBER(14,4) NOT NULL,
      RULE_SOURCE VARCHAR2(20) NOT NULL,
      COMMISSION_PERCENT NUMBER(8,4),
      FIXED_AMOUNT NUMBER(14,4),
      CALCULATED_AMOUNT NUMBER(14,4),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_ASSEMBLY_PHOTOS",
    ddl: `CREATE TABLE MONT_ASSEMBLY_PHOTOS (
      ID VARCHAR2(36) PRIMARY KEY,
      ASSEMBLY_JOB_ID VARCHAR2(36) NOT NULL,
      FILE_URL VARCHAR2(2000) NOT NULL,
      PHOTO_TYPE VARCHAR2(80) NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_CUSTOMER_REVIEWS",
    ddl: `CREATE TABLE MONT_CUSTOMER_REVIEWS (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      ASSEMBLY_JOB_ID VARCHAR2(36),
      SERVICE_TYPE VARCHAR2(80) NOT NULL,
      SCORE NUMBER(2) NOT NULL CHECK (SCORE BETWEEN 0 AND 10),
      CLASSIFICATION VARCHAR2(40) NOT NULL,
      REVIEW_COMMENT VARCHAR2(4000),
      COMPLAINT_REASON VARCHAR2(500),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_REVIEWS UNIQUE (ORDER_ID, SERVICE_TYPE)
    )`,
  },
  {
    name: "MONT_SAC_CASES",
    ddl: `CREATE TABLE MONT_SAC_CASES (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36) NOT NULL,
      ASSEMBLY_JOB_ID VARCHAR2(36),
      STATUS VARCHAR2(40) DEFAULT 'ABERTO' NOT NULL,
      REASON VARCHAR2(500) NOT NULL,
      DESCRIPTION VARCHAR2(4000) NOT NULL,
      RESPONSIBLE_USER_ID VARCHAR2(36),
      NEXT_ACTION_DATE TIMESTAMP,
      SLA_DEADLINE TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PROVIDER_PAYMENTS",
    ddl: `CREATE TABLE MONT_PROVIDER_PAYMENTS (
      ID VARCHAR2(36) PRIMARY KEY,
      PROVIDER_ID VARCHAR2(36) NOT NULL,
      ASSEMBLY_JOB_ID VARCHAR2(36) NOT NULL,
      AMOUNT NUMBER(14,2) DEFAULT 0 NOT NULL,
      STATUS VARCHAR2(80) DEFAULT 'AGUARDANDO_FINALIZACAO' NOT NULL,
      BLOCKED_REASON VARCHAR2(500),
      PROGRAMMED_FOR VARCHAR2(20),
      PAID_AT TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_MSG_TEMPLATES",
    ddl: `CREATE TABLE MONT_MSG_TEMPLATES (
      ID VARCHAR2(36) PRIMARY KEY,
      EVENT_TYPE VARCHAR2(100) NOT NULL,
      CHANNEL VARCHAR2(40) NOT NULL,
      SUBJECT VARCHAR2(500),
      BODY CLOB NOT NULL,
      ACTIVE NUMBER(1) DEFAULT 1 NOT NULL,
      CONSTRAINT UQ_MONT_MSG_TMPL_EVENT UNIQUE (EVENT_TYPE)
    )`,
  },
  {
    name: "MONT_MSG_LOGS",
    ddl: `CREATE TABLE MONT_MSG_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      ORDER_ID VARCHAR2(36),
      EVENT_ID VARCHAR2(36),
      CHANNEL VARCHAR2(40) NOT NULL,
      RECIPIENT VARCHAR2(255) NOT NULL,
      STATUS VARCHAR2(40) NOT NULL,
      IDEMPOTENCY_KEY VARCHAR2(255) NOT NULL,
      ERROR_MESSAGE VARCHAR2(2000),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_MSG_LOGS_IDEMP UNIQUE (IDEMPOTENCY_KEY)
    )`,
  },
  {
    name: "MONT_WINTHOR_SYNC_LOGS",
    ddl: `CREATE TABLE MONT_WINTHOR_SYNC_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      SYNC_TYPE VARCHAR2(80) NOT NULL,
      NUMPED VARCHAR2(50),
      CODCLI VARCHAR2(50),
      QUERY_NAME VARCHAR2(100) NOT NULL,
      STATUS VARCHAR2(40) NOT NULL,
      ERROR_MESSAGE VARCHAR2(2000),
      ELAPSED_MS NUMBER(10) NOT NULL,
      ORIGIN VARCHAR2(40) NOT NULL,
      USER_ID VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_INTEGRATION_FAILURES",
    ddl: `CREATE TABLE MONT_INTEGRATION_FAILURES (
      ID VARCHAR2(36) PRIMARY KEY,
      SOURCE VARCHAR2(80) NOT NULL,
      OPERATION VARCHAR2(100) NOT NULL,
      REFERENCE VARCHAR2(100),
      ERROR_MESSAGE VARCHAR2(2000) NOT NULL,
      RETRY_COUNT NUMBER(5) DEFAULT 0 NOT NULL,
      RESOLVED_AT TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_SAC_CASE_LOGS",
    ddl: `CREATE TABLE MONT_SAC_CASE_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      SAC_CASE_ID VARCHAR2(36) NOT NULL,
      ACTION VARCHAR2(80) NOT NULL,
      NOTE VARCHAR2(4000),
      USER_ID VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PAYMENT_APPROVAL_LOGS",
    ddl: `CREATE TABLE MONT_PAYMENT_APPROVAL_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      PAYMENT_ID VARCHAR2(36) NOT NULL,
      ACTION VARCHAR2(80) NOT NULL,
      JUSTIFICATION VARCHAR2(2000),
      USER_ID VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PRODUCT_COMMISSIONS",
    ddl: `CREATE TABLE MONT_PRODUCT_COMMISSIONS (
      ID VARCHAR2(36) PRIMARY KEY,
      CODPROD VARCHAR2(100) NOT NULL,
      DESCRIPTION VARCHAR2(500) NOT NULL,
      VLMAODEOBRA NUMBER(14,2) DEFAULT 0 NOT NULL,
      COMMISSION_PERCENT NUMBER(6,2) NOT NULL,
      ACTIVE NUMBER(1) DEFAULT 1 NOT NULL,
      NOTES VARCHAR2(1000),
      CREATED_BY VARCHAR2(36),
      UPDATED_BY VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_PROD_COMM UNIQUE (CODPROD)
    )`,
  },
  {
    name: "MONT_DEPT_COMMISSIONS",
    ddl: `CREATE TABLE MONT_DEPT_COMMISSIONS (
      ID VARCHAR2(36) PRIMARY KEY,
      CODEPTO VARCHAR2(20) NOT NULL,
      DESCRIPTION VARCHAR2(500) NOT NULL,
      CALCULATION_TYPE VARCHAR2(20) DEFAULT 'PERCENTAGE' NOT NULL,
      COMMISSION_PERCENT NUMBER(6,2) DEFAULT 0 NOT NULL,
      FIXED_AMOUNT NUMBER(14,4),
      ACTIVE NUMBER(1) DEFAULT 1 NOT NULL,
      NOTES VARCHAR2(1000),
      CREATED_BY VARCHAR2(36),
      UPDATED_BY VARCHAR2(36),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_DEPT_COMM UNIQUE (CODEPTO)
    )`,
  },
  {
    name: "MONT_AUDIT_LOGS",
    ddl: `CREATE TABLE MONT_AUDIT_LOGS (
      ID VARCHAR2(36) PRIMARY KEY,
      ACTOR_USER_ID VARCHAR2(36),
      ACTION VARCHAR2(100) NOT NULL,
      ENTITY_TYPE VARCHAR2(80) NOT NULL,
      ENTITY_ID VARCHAR2(36) NOT NULL,
      PREVIOUS_JSON CLOB,
      NEXT_JSON CLOB,
      JUSTIFICATION VARCHAR2(2000),
      IP VARCHAR2(50),
      USER_AGENT VARCHAR2(500),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  // ── Fluxo WinThor ─────────────────────────────────────────────────────────
  {
    name: "MONT_ORDER_SNAPSHOTS",
    ddl: `CREATE TABLE MONT_ORDER_SNAPSHOTS (
      NUMPED                   VARCHAR2(50) PRIMARY KEY,
      CODCLI                   VARCHAR2(50),
      NOME_CLIENTE             VARCHAR2(255),
      CODFILIAL                VARCHAR2(50),
      CONDVENDA                NUMBER(5),
      POSICAO                  VARCHAR2(10),
      STATUS_PEDIDO            VARCHAR2(50),
      FLUXO_STATUS_ATUAL       VARCHAR2(100),
      FLUXO_STATUS_ANTERIOR    VARCHAR2(100),
      FLUXO_EVENT_KEY_ATUAL    VARCHAR2(80),
      FLUXO_EVENT_KEY_ANTERIOR VARCHAR2(80),
      DATA_DIGITACAO           TIMESTAMP,
      DATA_EMISSAO_MAPA        TIMESTAMP,
      DATA_INICIO_CONFERENCIA  TIMESTAMP,
      DATA_FIM_CONFERENCIA     TIMESTAMP,
      NUMNOTA                  VARCHAR2(50),
      DATA_FATURAMENTO         TIMESTAMP,
      DATA_SAIDA_NOTA          TIMESTAMP,
      FUNC_EMISSAO_MAPA        VARCHAR2(50),
      COD_SEPARADOR            VARCHAR2(50),
      COD_CONFERENTE           VARCHAR2(50),
      FATURADO_POR             VARCHAR2(50),
      ULTIMA_SINCRONIZACAO     TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      ATUALIZADO_EM            TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_FLUXO_EVENTS",
    ddl: `CREATE TABLE MONT_FLUXO_EVENTS (
      ID                       VARCHAR2(36) PRIMARY KEY,
      NUMPED                   VARCHAR2(50) NOT NULL,
      CODCLI                   VARCHAR2(50),
      EVENT_KEY                VARCHAR2(80) NOT NULL,
      FLUXO_STATUS_ANTERIOR    VARCHAR2(100),
      FLUXO_STATUS_NOVO        VARCHAR2(100),
      FLUXO_EVENT_KEY_ANTERIOR VARCHAR2(80),
      FLUXO_EVENT_KEY_NOVO     VARCHAR2(80),
      PAYLOAD_ORIGEM           CLOB,
      ORIGEM                   VARCHAR2(50) DEFAULT 'SYNC' NOT NULL,
      CRIADO_EM                TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_MESSAGE_LOGS",
    ddl: `CREATE TABLE MONT_MESSAGE_LOGS (
      ID              VARCHAR2(36) PRIMARY KEY,
      NUMPED          VARCHAR2(50),
      CODCLI          VARCHAR2(50),
      EVENT_KEY       VARCHAR2(80),
      TEMPLATE_ID     VARCHAR2(36),
      DESTINO         VARCHAR2(100),
      CANAL           VARCHAR2(20) DEFAULT 'WHATSAPP' NOT NULL,
      STATUS          VARCHAR2(50) NOT NULL,
      PAYLOAD         CLOB,
      ERRO            CLOB,
      IDEMPOTENCY_KEY VARCHAR2(200),
      MODO_ENVIO      VARCHAR2(20) DEFAULT 'DRY_RUN' NOT NULL,
      ENVIADO_EM      TIMESTAMP,
      CRIADO_EM       TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_FLUXO_EVENT_CONFIG",
    ddl: `CREATE TABLE MONT_FLUXO_EVENT_CONFIG (
      EVENT_KEY       VARCHAR2(80) PRIMARY KEY,
      LABEL           VARCHAR2(200),
      ATIVO_DASHBOARD NUMBER(1) DEFAULT 1 NOT NULL,
      ATIVO_MENSAGEM  NUMBER(1) DEFAULT 0 NOT NULL,
      MODO_ENVIO      VARCHAR2(20) DEFAULT 'DRY_RUN' NOT NULL,
      TELEFONES_TESTE VARCHAR2(1000),
      OBSERVACAO      VARCHAR2(1000),
      ATUALIZADO_EM   TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_SYNC_RUNS",
    ddl: `CREATE TABLE MONT_SYNC_RUNS (
      ID                  VARCHAR2(36) PRIMARY KEY,
      MODO                VARCHAR2(20) NOT NULL,
      PARAMS_JSON         CLOB,
      PEDIDOS_ENCONTRADOS NUMBER DEFAULT 0 NOT NULL,
      EVENTOS_GERADOS     NUMBER DEFAULT 0 NOT NULL,
      MSGS_SIMULADAS      NUMBER DEFAULT 0 NOT NULL,
      MSGS_ENVIADAS       NUMBER DEFAULT 0 NOT NULL,
      MSGS_IGNORADAS      NUMBER DEFAULT 0 NOT NULL,
      MSGS_ERRO           NUMBER DEFAULT 0 NOT NULL,
      ERROS_JSON          CLOB,
      RUN_STATUS          VARCHAR2(20) DEFAULT 'RUNNING' NOT NULL,
      INICIADO_EM         TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      FINALIZADO_EM       TIMESTAMP
    )`,
  },
  {
    name: "MONT_SYNC_CONFIG",
    ddl: `CREATE TABLE MONT_SYNC_CONFIG (
      CONFIG_KEY    VARCHAR2(100) PRIMARY KEY,
      CONFIG_VALUE  CLOB,
      ATUALIZADO_EM TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_COMMISSION_CALC_ITEMS",
    ddl: `CREATE TABLE MONT_COMMISSION_CALC_ITEMS (
      ID VARCHAR2(36) PRIMARY KEY,
      PAYMENT_ID VARCHAR2(36) NOT NULL,
      NUMPED VARCHAR2(50) NOT NULL,
      CODPROD VARCHAR2(100) NOT NULL,
      DESCRICAO VARCHAR2(500),
      UNIDADE VARCHAR2(20),
      QT_VENDIDA NUMBER(12,4),
      PVENDA NUMBER(14,4),
      VALOR_BASE NUMBER(14,2),
      CALCULATION_TYPE VARCHAR2(20),
      FIXED_AMOUNT NUMBER(14,4),
      PERCENTAGE_RATE NUMBER(6,4),
      COMMISSION_AMOUNT NUMBER(14,2) DEFAULT 0 NOT NULL,
      RULE_ID VARCHAR2(36),
      NOTE VARCHAR2(500),
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PASSWORD_RESET_TOKENS",
    ddl: `CREATE TABLE MONT_PASSWORD_RESET_TOKENS (
      ID VARCHAR2(36) PRIMARY KEY,
      USER_ID VARCHAR2(36) NOT NULL,
      TOKEN_HASH VARCHAR2(255) NOT NULL,
      EXPIRES_AT TIMESTAMP NOT NULL,
      USED_AT TIMESTAMP,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT UQ_MONT_PRT_TOKEN UNIQUE (TOKEN_HASH)
    )`,
  },
  {
    name: "MONT_AGENDA_CANDIDATOS",
    ddl: `CREATE TABLE MONT_AGENDA_CANDIDATOS (
      NUMPED                  VARCHAR2(50) PRIMARY KEY,
      CODCLI                  VARCHAR2(50),
      NOME_CLIENTE            VARCHAR2(255),
      TELEFONE                VARCHAR2(50),
      CODFILIAL               VARCHAR2(10),
      NUMNOTA                 VARCHAR2(50),
      NUMCAR                  VARCHAR2(50),
      DATA_FATURAMENTO        TIMESTAMP,
      DATA_SAIDA_NOTA         TIMESTAMP,
      DATA_ENTREGA_CONFIRMADA TIMESTAMP,
      ORIGEM_ENTREGA          VARCHAR2(50) DEFAULT 'PCCARREG_DTFECHA' NOT NULL,
      STATUS_AGENDA           VARCHAR2(50) DEFAULT 'ENTREGUE_APTO_AGENDAMENTO' NOT NULL,
      CONVITE_ENVIADO         NUMBER(1) DEFAULT 0 NOT NULL,
      DATA_ENVIO_CONVITE      TIMESTAMP,
      IDEMPOTENCY_KEY         VARCHAR2(200),
      MONTAGEM_AGENDADA       NUMBER(1) DEFAULT 0 NOT NULL,
      DATA_MONTAGEM_AGENDADA  TIMESTAMP,
      CREATED_AT              TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT              TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  // ── Filiais por usuário ───────────────────────────────────────────────────────
  {
    name: "MONT_USER_FILIAIS",
    ddl: `CREATE TABLE MONT_USER_FILIAIS (
      USER_ID    VARCHAR2(36) NOT NULL,
      CODFILIAL  VARCHAR2(20) NOT NULL,
      CREATED_AT TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      CONSTRAINT PK_MONT_USER_FILIAIS PRIMARY KEY (USER_ID, CODFILIAL)
    )`,
  },
  // ── Novos recursos: disponibilidade, certificações, retrabalho ───────────────
  {
    name: "MONT_PROVIDER_UNAVAILABILITY",
    ddl: `CREATE TABLE MONT_PROVIDER_UNAVAILABILITY (
      ID           VARCHAR2(36) PRIMARY KEY,
      PROVIDER_ID  VARCHAR2(36) NOT NULL,
      UNAVAIL_DATE DATE NOT NULL,
      REASON       VARCHAR2(200),
      CREATED_BY   VARCHAR2(36),
      CREATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_PROVIDER_CERTIFICATIONS",
    ddl: `CREATE TABLE MONT_PROVIDER_CERTIFICATIONS (
      ID           VARCHAR2(36) PRIMARY KEY,
      PROVIDER_ID  VARCHAR2(36) NOT NULL,
      CERT_TYPE    VARCHAR2(80) NOT NULL,
      FILE_URL     VARCHAR2(2000),
      ISSUED_AT    DATE,
      VALID_UNTIL  DATE,
      STATUS       VARCHAR2(20) DEFAULT 'PENDENTE' NOT NULL,
      NOTES        VARCHAR2(500),
      CREATED_BY   VARCHAR2(36),
      CREATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
      UPDATED_AT   TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
  {
    name: "MONT_ASSEMBLY_REWORKS",
    ddl: `CREATE TABLE MONT_ASSEMBLY_REWORKS (
      ID              VARCHAR2(36) PRIMARY KEY,
      ASSEMBLY_JOB_ID VARCHAR2(36) NOT NULL,
      PROVIDER_ID     VARCHAR2(36) NOT NULL,
      SAC_ID          VARCHAR2(36),
      REASON          VARCHAR2(200) NOT NULL,
      DESCRIPTION     VARCHAR2(4000),
      STATUS          VARCHAR2(20) DEFAULT 'PENDENTE' NOT NULL,
      RESOLVED_AT     TIMESTAMP,
      RESOLVED_BY     VARCHAR2(36),
      CREATED_AT      TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL
    )`,
  },
];

const NEW_COLUMNS: ColumnDef[] = [
  { table: "MONT_USERS", column: "TOKEN_VERSION",  ddl: "NUMBER DEFAULT 0 NOT NULL" },
  { table: "MONT_USERS", column: "REVOKED_BEFORE", ddl: "TIMESTAMP" },
  { table: "MONT_ORDER_ITEMS", column: "ASSEMBLY_COST", ddl: "NUMBER(14,2) DEFAULT 0 NOT NULL" },
  { table: "MONT_SAC_CASES", column: "NEXT_ACTION_DATE", ddl: "TIMESTAMP" },
  { table: "MONT_SAC_CASES", column: "SLA_DEADLINE", ddl: "TIMESTAMP" },
  { table: "MONT_PROVIDER_PAYMENTS", column: "INVOICE_URL", ddl: "VARCHAR2(2000)" },
  { table: "MONT_PROVIDER_PAYMENTS", column: "INVOICE_SUBMITTED_AT", ddl: "TIMESTAMP" },
  { table: "MONT_PROVIDERS", column: "CODFORNEC",    ddl: "VARCHAR2(20)" },
  { table: "MONT_PROVIDERS", column: "PIX_KEY",      ddl: "VARCHAR2(255)" },
  { table: "MONT_PROVIDERS", column: "PIX_KEY_TYPE", ddl: "VARCHAR2(40)" },
  { table: "MONT_MSG_TEMPLATES", column: "RECIPIENT",        ddl: "VARCHAR2(40)  DEFAULT 'CLIENTE'" },
  { table: "MONT_MSG_TEMPLATES", column: "CTA_LABEL",       ddl: "VARCHAR2(200)" },
  { table: "MONT_MSG_TEMPLATES", column: "CTA_URL_VAR",     ddl: "VARCHAR2(100)" },
  { table: "MONT_MSG_TEMPLATES", column: "ANTIFRAUDE_TYPE", ddl: "VARCHAR2(40)" },
  { table: "MONT_MSG_TEMPLATES", column: "RESEND_ALLOWED",  ddl: "NUMBER(1) DEFAULT 0" },
  { table: "MONT_MSG_TEMPLATES", column: "RESEND_AFTER_H",  ddl: "NUMBER(3)" },
  { table: "MONT_MSG_TEMPLATES", column: "MAX_RESENDS",     ddl: "NUMBER(2) DEFAULT 0" },
  { table: "MONT_MSG_TEMPLATES", column: "SEND_HOUR_START", ddl: "NUMBER(2) DEFAULT 8" },
  { table: "MONT_MSG_TEMPLATES", column: "SEND_HOUR_END",   ddl: "NUMBER(2) DEFAULT 21" },
  // Montador histórico
  { table: "MONT_ASSEMBLY_JOBS", column: "NOTES", ddl: "VARCHAR2(2000)" },
  // Commission calc type support
  { table: "MONT_PRODUCT_COMMISSIONS", column: "CALCULATION_TYPE", ddl: "VARCHAR2(20) DEFAULT 'PERCENTAGE' NOT NULL" },
  { table: "MONT_PRODUCT_COMMISSIONS", column: "FIXED_AMOUNT", ddl: "NUMBER(14,4)" },
  // CEP para matching geográfico
  { table: "MONT_PROVIDERS", column: "CEP", ddl: "VARCHAR2(10)" },
  { table: "MONT_PROVIDERS", column: "TRADE_NAME", ddl: "VARCHAR2(255)" },
];
const INDEXES: IndexDef[] = [
  { name: "IDX_MONT_ORDERS_STATUS", table: "MONT_ORDERS", columns: "CURRENT_STATUS" },
  { name: "IDX_MONT_ORDERS_TODAY", table: "MONT_ORDERS", columns: "CREATED_AT" },
  { name: "IDX_MONT_EVENTS_NUMPED", table: "MONT_ORDER_EVENTS", columns: "NUMPED" },
  { name: "IDX_MONT_TIMELINE_ORDER", table: "MONT_ORDER_TIMELINE", columns: "ORDER_ID" },
  { name: "IDX_MONT_PROVIDERS_STATUS", table: "MONT_PROVIDERS", columns: "STATUS, ACTIVE" },
  { name: "IDX_MONT_PAYMENTS_STATUS", table: "MONT_PROVIDER_PAYMENTS", columns: "STATUS" },
  { name: "IDX_MONT_SYNC_STATUS", table: "MONT_WINTHOR_SYNC_LOGS", columns: "STATUS" },
  { name: "IDX_MONT_AUDIT_ENTITY", table: "MONT_AUDIT_LOGS", columns: "ENTITY_ID" },
  // Fluxo WinThor indexes
  { name: "IDX_MONT_SNAP_CODCLI",    table: "MONT_ORDER_SNAPSHOTS", columns: "CODCLI" },
  { name: "IDX_MONT_SNAP_FLUXOKEY",  table: "MONT_ORDER_SNAPSHOTS", columns: "FLUXO_EVENT_KEY_ATUAL" },
  { name: "IDX_MONT_FEVT_NUMPED",    table: "MONT_FLUXO_EVENTS",    columns: "NUMPED" },
  { name: "IDX_MONT_FEVT_EVENTKEY",  table: "MONT_FLUXO_EVENTS",    columns: "EVENT_KEY" },
  { name: "IDX_MONT_MSGL_NUMPED",    table: "MONT_MESSAGE_LOGS",    columns: "NUMPED" },
  { name: "IDX_MONT_MSGL_STATUS",    table: "MONT_MESSAGE_LOGS",    columns: "STATUS" },
  { name: "IDX_MONT_MSGL_IDEMP",     table: "MONT_MESSAGE_LOGS",    columns: "IDEMPOTENCY_KEY", unique: true },
  { name: "IDX_MONT_SYNCRN_STATUS",  table: "MONT_SYNC_RUNS",       columns: "RUN_STATUS" },
  { name: "IDX_MONT_SAC_LOGS_CASE", table: "MONT_SAC_CASE_LOGS", columns: "SAC_CASE_ID" },
  { name: "IDX_MONT_PAY_LOGS_PMT",      table: "MONT_PAYMENT_APPROVAL_LOGS", columns: "PAYMENT_ID" },
  // Agenda candidatos indexes
  { name: "IDX_MONT_CALCI_PAYMENT",     table: "MONT_COMMISSION_CALC_ITEMS", columns: "PAYMENT_ID" },
  { name: "IDX_MONT_CALCI_NUMPED",      table: "MONT_COMMISSION_CALC_ITEMS", columns: "NUMPED" },
  { name: "IDX_MONT_AGCAND_STATUS",     table: "MONT_AGENDA_CANDIDATOS", columns: "STATUS_AGENDA" },
  { name: "IDX_MONT_AGCAND_CODCLI",     table: "MONT_AGENDA_CANDIDATOS", columns: "CODCLI" },
  { name: "IDX_MONT_AGCAND_ENTREGA",    table: "MONT_AGENDA_CANDIDATOS", columns: "DATA_ENTREGA_CONFIRMADA" },
  // Novos recursos
  { name: "IDX_MONT_UNAVAIL_PROV",      table: "MONT_PROVIDER_UNAVAILABILITY", columns: "PROVIDER_ID, UNAVAIL_DATE", unique: true },
  { name: "IDX_MONT_CERT_PROV",         table: "MONT_PROVIDER_CERTIFICATIONS", columns: "PROVIDER_ID" },
  { name: "IDX_MONT_CERT_VALID",        table: "MONT_PROVIDER_CERTIFICATIONS", columns: "VALID_UNTIL" },
  { name: "IDX_MONT_REWORK_JOB",        table: "MONT_ASSEMBLY_REWORKS", columns: "ASSEMBLY_JOB_ID" },
  { name: "IDX_MONT_REWORK_PROV",       table: "MONT_ASSEMBLY_REWORKS", columns: "PROVIDER_ID" },
  { name: "IDX_MONT_UFILIAIS_USER",     table: "MONT_USER_FILIAIS", columns: "USER_ID" },
];

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await executeOracle(`SELECT * FROM ${tableName.toUpperCase()} WHERE 1 = 0`);
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ORA-00942")) return false;
    throw error;
  }
}

async function indexExists(indexName: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_INDEXES WHERE INDEX_NAME = :indexName`,
    { indexName: indexName.toUpperCase() },
  );
  return Number(row?.cnt ?? 0) > 0;
}

async function createTableIfMissing(name: string, ddl: string): Promise<void> {
  if (await tableExists(name)) return;
  try {
    await execDml(ddl);
    console.log(`[initTables] Tabela ${name} criada.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ORA-00955") || msg.includes("ORA-01031")) return;
    throw error;
  }
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(*) AS CNT FROM USER_TAB_COLUMNS WHERE TABLE_NAME = :tbl AND COLUMN_NAME = :col`,
    { tbl: table.toUpperCase(), col: column.toUpperCase() },
  );
  return Number(row?.cnt ?? 0) > 0;
}

async function ensureColumn(def: ColumnDef): Promise<void> {
  if (!(await tableExists(def.table))) return;
  if (await columnExists(def.table, def.column)) return;
  try {
    await execDml(`ALTER TABLE ${def.table} ADD ${def.column} ${def.ddl}`);
    console.log(`[initTables] Coluna ${def.table}.${def.column} adicionada.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ORA-01430") || msg.includes("ORA-01031")) return;
    throw error;
  }
}

async function constraintExists(name: string): Promise<boolean> {
  const row = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS CNT FROM USER_CONSTRAINTS WHERE CONSTRAINT_NAME = :name",
    { name: name.toUpperCase() },
  );
  return Number(row?.cnt ?? 0) > 0;
}

async function addFkIfMissing(constraintName: string, table: string, column: string, refTable: string, refColumn: string): Promise<void> {
  if (await constraintExists(constraintName)) return;
  try {
    await execDml(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${column}) REFERENCES ${refTable} (${refColumn})`,
    );
    console.log(`[initTables] FK ${constraintName} adicionada.`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ORA-02264") || msg.includes("ORA-01031") || msg.includes("ORA-02275")) return;
    console.warn(`[initTables] FK ${constraintName} ignorada: ${msg.slice(0, 120)}`);
  }
}

async function createIndexIfMissing(def: IndexDef): Promise<void> {
  if (!(await tableExists(def.table))) return;
  if (await indexExists(def.name)) return;
  const prefix = def.unique ? "CREATE UNIQUE INDEX" : "CREATE INDEX";
  try {
    await execDml(`${prefix} ${def.name} ON ${def.table} (${def.columns})`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("ORA-00955") || msg.includes("ORA-01408") || msg.includes("ORA-01031")) return;
    throw error;
  }
}

const DEFAULT_ROLES = [
  "ADMIN", "GESTOR", "OPERACAO", "LOGISTICA", "SAC", "FINANCEIRO", "MONTADOR", "CONSULTA",
];

async function seedDefaultData(): Promise<void> {
  // Seed roles
  for (const roleName of DEFAULT_ROLES) {
    const row = await queryOne<{ cnt: number }>(
      "SELECT COUNT(*) AS CNT FROM MONT_ROLES WHERE NAME = :name",
      { name: roleName },
    );
    if (Number(row?.cnt ?? 0) === 0) {
      await execDml("INSERT INTO MONT_ROLES (ID, NAME) VALUES (:id, :name)", {
        id: uuid(),
        name: roleName,
      });
      console.log(`[initTables] Role ${roleName} criada.`);
    }
  }

  // Seed admin user
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@montadores.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin@2026!";

  const existing = await queryOne<{ cnt: number }>(
    "SELECT COUNT(*) AS CNT FROM MONT_USERS WHERE LOWER(EMAIL) = LOWER(:email)",
    { email: adminEmail },
  );

  if (Number(existing?.cnt ?? 0) === 0) {
    const userId = uuid();
    const hash = createHash("sha256")
      .update(`${adminPassword}:montadores:${config.jwtSecret}`)
      .digest("hex");

    await execDml(
      "INSERT INTO MONT_USERS (ID, NAME, EMAIL, PASSWORD_HASH, STATUS) VALUES (:id, :name, :email, :hash, 'ATIVO')",
      { id: userId, name: "Administrador", email: adminEmail, hash },
    );

    const adminRole = await queryOne<{ id: string }>(
      "SELECT ID FROM MONT_ROLES WHERE NAME = :name",
      { name: "ADMIN" },
    );
    if (adminRole) {
      await execDml(
        "INSERT INTO MONT_USER_ROLES (USER_ID, ROLE_ID) VALUES (:userId, :roleId)",
        { userId, roleId: adminRole.id },
      );
    }

    console.log(`[initTables] Admin seed criado: ${adminEmail}`);
  }

}

const FK_CONSTRAINTS: Array<{ name: string; table: string; column: string; refTable: string; refColumn: string }> = [
  { name: "FK_MONT_UR_USER",   table: "MONT_USER_ROLES",            column: "USER_ID",         refTable: "MONT_USERS",              refColumn: "ID" },
  { name: "FK_MONT_UR_ROLE",   table: "MONT_USER_ROLES",            column: "ROLE_ID",         refTable: "MONT_ROLES",              refColumn: "ID" },
  { name: "FK_MONT_ORD_CUST",  table: "MONT_ORDERS",                column: "CUSTOMER_ID",     refTable: "MONT_CUSTOMERS",          refColumn: "ID" },
  { name: "FK_MONT_AJI_JOB",   table: "MONT_ASSEMBLY_JOB_ITEMS",   column: "ASSEMBLY_JOB_ID", refTable: "MONT_ASSEMBLY_JOBS",      refColumn: "ID" },
  { name: "FK_MONT_PAYM_JOB",  table: "MONT_PROVIDER_PAYMENTS",     column: "ASSEMBLY_JOB_ID", refTable: "MONT_ASSEMBLY_JOBS",      refColumn: "ID" },
  { name: "FK_MONT_CALCI_PMT", table: "MONT_COMMISSION_CALC_ITEMS", column: "PAYMENT_ID",      refTable: "MONT_PROVIDER_PAYMENTS",  refColumn: "ID" },
  { name: "FK_MONT_PRT_USER",  table: "MONT_PASSWORD_RESET_TOKENS", column: "USER_ID",         refTable: "MONT_USERS",              refColumn: "ID" },
];

export async function ensureMontadoresTables(): Promise<void> {
  if (!isOracleEnabled() || initialized) return;
  for (const table of TABLES) {
    await createTableIfMissing(table.name, table.ddl);
  }
  for (const col of NEW_COLUMNS) {
    await ensureColumn(col);
  }
  for (const index of INDEXES) {
    await createIndexIfMissing(index);
  }
  for (const fk of FK_CONSTRAINTS) {
    await addFkIfMissing(fk.name, fk.table, fk.column, fk.refTable, fk.refColumn);
  }
  await seedDefaultData();
  initialized = true;
  console.log("[initTables] Schema MONT_* verificado/criado.");
}
