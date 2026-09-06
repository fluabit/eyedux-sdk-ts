# Referência da API

Esta página descreve a API pública do pacote `@eyedux/sdk` e o contrato HTTP usado pelo Eyedux.

## Base URL e autenticação

O SDK usa a base fixa `https://api.eyedux.com` e injeta o header abaixo em toda requisição:

```http
Authorization: Bearer <api_key>
```

O backend infere a organização pela API key. Não envie `organization_id` no payload.

## Construtores

### `createEyeduxClient`

```ts
function createEyeduxClient(
  apiKey: string,
  options?: EyeduxClientOptions,
): EyeduxClient;
```

Cria um cliente. A API key é removida de espaços nas extremidades e uma key vazia lança `EyeduxValidationError` com código `EMPTY_API_KEY`.

| Opção | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `projectId` | `string` | nenhum | Projeto padrão para novos eventos |
| `timeoutMs` | `number` | `30000` | Timeout por request, em milissegundos |
| `defaultMetadata` | `Record<string, unknown>` | nenhum | Metadata padrão, sobrescrita pelo evento |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Implementação de transporte customizada |

### `createEyeduxClientWithConfig`

```ts
function createEyeduxClientWithConfig(
  config: EyeduxClientConfig,
): EyeduxClient;
```

Versão explícita que exige `apiKey` e `projectId`; ambos são validados antes da criação do cliente.

### `createEyeduxClientFromEnv`

```ts
function createEyeduxClientFromEnv(
  options?: EyeduxClientOptions,
): EyeduxClient;
```

Lê somente `EYEDUX_API_KEY` em runtimes Node.js. Defina o projeto em `options.projectId` ou em cada chamada a `createEvent`.

## Métodos do cliente

### `createEvent`

```ts
client.createEvent(
  input: CreateEventInput,
  options?: RequestOptions,
): Promise<EyeduxEvent>;
```

Envia `POST /public/logs`. `input.projectId` tem precedência sobre o projeto padrão; se não houver um projeto, lança `EyeduxValidationError` com código `EMPTY_PROJECT_ID`.

| Campo | Tipo | Obrigatório |
| --- | --- | --- |
| `projectId` | `string` | Sim, no input ou na configuração |
| `type` | `string` | Sim |
| `properties` | `Record<string, unknown>` | Sim |
| `typeGroup` | `string` | Não |
| `eyeduxType` | `EventEyeduxType` | Não |
| `externalObject` | `EventObject` | Não |
| `correlationObject` | `EventObject` | Não |
| `metadata` | `Record<string, unknown>` | Não |

O SDK serializa os campos para `snake_case` na API: `project_id`, `type_group`, `eyedux_type`, `external_object` e `correlation_object`.

### `listEvents`

```ts
client.listEvents(
  input?: ListEventsInput,
  options?: RequestOptions,
): Promise<EyeduxEvent[]>;
```

Executa `GET /public/logs`. Os filtros opcionais e cumulativos são `type` e `correlationId`, serializado como `correlation_id`. Uma lista vazia, ou uma resposta com `data: null`, resulta em `[]`.

### `findEventByExternalId`

```ts
client.findEventByExternalId(
  externalId: string,
  options?: RequestOptions,
): Promise<EyeduxEvent>;
```

Executa `GET /public/logs/external/:external_id`, codificando o ID para uso no path. Uma string vazia lança `EyeduxValidationError` com código `EMPTY_EXTERNAL_ID`.

### Métodos de emissão

```ts
client.emit(input, options);
client.emitError(input, options);
client.emitWarning(input, options);
client.emitLog(input, options);
client.emitDebug(input, options);
client.emitInfo(input, options);
client.emitMetric(input, options);
```

`emit` usa `input.eyeduxType`. Os atalhos aplicam suas categorias correspondentes. `emitError` adiciona contexto de diagnóstico às propriedades, copiando o objeto de entrada.

## Tipos

### `EventEyeduxType`

```ts
const EventEyeduxType = {
  SystemError: "system-error",
  SystemWarning: "system-warning",
  SystemLog: "system-log",
  SystemDebug: "system-debug",
  SystemInfo: "system-info",
  SystemMetric: "system-metric",
} as const;
```

### `EventObject`

```ts
interface EventObject {
  id: string;
  property: string;
  source?: string;
}
```

### `EyeduxEvent`

```ts
interface EyeduxEvent {
  id: string;
  environment: string;
  eyeduxType: EventEyeduxType | null;
  type: string;
  typeGroup: string;
  properties: Record<string, unknown>;
  status: "active" | "deleted";
  timestamp: string;
  createdAt: string;
  externalObject: EventObject | null;
  correlationObject: EventObject | null;
  metadata: Record<string, unknown> | null;
}
```

`timestamp` e `createdAt` são strings RFC 3339 fornecidas pela API.

### `RequestOptions`

```ts
interface RequestOptions {
  signal?: AbortSignal;
}
```

Use `signal` para cancelar uma chamada individual sem alterar o timeout configurado no cliente.

## Diagnóstico

```ts
function currentErrorSource(sourceSkip?: number): ErrorSource | undefined;
function errorProperties(
  properties: JsonObject,
  error?: unknown,
  operation?: string,
): JsonObject;
function errorPropertiesWithSourceSkip(
  properties: JsonObject,
  error?: unknown,
  operation?: string,
  sourceSkip?: number,
): JsonObject;
```

Esses helpers não alteram `properties`. A origem é extraída do stack trace e pode variar conforme o runtime e as ferramentas de build.

## Erros

### `EyeduxValidationError`

Erros locais de validação, com a propriedade `code`:

| Código | Situação |
| --- | --- |
| `EMPTY_API_KEY` | API key vazia |
| `EMPTY_PROJECT_ID` | Nenhum projeto disponível para criar o evento |
| `EMPTY_EXTERNAL_ID` | ID externo vazio |

### `EyeduxAPIError`

Respostas HTTP não bem-sucedidas lançam:

```ts
class EyeduxAPIError extends Error {
  statusCode: number;
  code: string;
  apiMessage: string;
  retryAfter?: number;
}
```

`retryAfter` é preenchido com o header `Retry-After` em segundos quando a API responde `429` com um valor inteiro.

| Helper | Uso |
| --- | --- |
| `isAuthError(error)` | API key inválida ou revogada |
| `isNotFound(error)` | Evento externo não encontrado (`404`) |
| `isConflict(error)` | Conflito (`409`) |
| `isExternalObjectConflict(error)` | `external_object` duplicado |
| `isRateLimited(error)` | Rate limit excedido (`429`) |

`EyeduxRequestError` representa problemas de transporte, timeout, cancelamento ou JSON de sucesso inválido. A causa original permanece em `error.cause`.

## Contrato HTTP

### Envelope de resposta

Sucessos usam o envelope abaixo:

```json
{ "data": {} }
```

Erros seguem:

```json
{
  "error": {
    "code": "event_external_object_conflict",
    "message": "external object already exists"
  }
}
```

### Códigos conhecidos

| Código | Status | Descrição |
| --- | --- | --- |
| `invalid_api_key` | `422` | API key inválida ou revogada |
| `event_type_required` | `422` | `type` enviado vazio |
| `event_properties_empty` | `422` | `properties` enviado vazio |
| `event_external_object_conflict` | `409` | Objeto externo duplicado |
| `event_external_id_not_found` | `404` | ID externo não encontrado |
| `event_external_id_required` | `422` | ID externo vazio |
| `RATE_LIMIT_EXCEEDED` | `429` | Limite de requisições excedido |
| `INTERNAL_SERVER_ERROR` | `500` | Erro interno não mapeado |