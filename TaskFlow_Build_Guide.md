# 🚀 Guía Completa: Construir TaskFlow — Gestión de Tareas Serverless en AWS

## 📋 Índice
1. [¿Qué vas a construir?](#qué-vas-a-construir)
2. [Pre-requisitos](#pre-requisitos)
3. [Fase 1 — CRUD de Tareas (HTTP API + Lambda + DynamoDB)](#fase-1--crud-de-tareas)
4. [Fase 2 — Autenticación con Cognito](#fase-2--autenticación-con-cognito)
5. [Fase 3 — WebSocket en tiempo real](#fase-3--websocket-en-tiempo-real)
6. [Fase 4 — Frontend Vue + Amplify](#fase-4--frontend-vue--amplify)
7. [Fase 5 — Conectar todo (deploy unificado con SAM)](#fase-5--deploy-unificado-con-sam)
8. [Gestión de Costos](#gestión-de-costos)
9. [Troubleshooting](#troubleshooting)

---

## ¿Qué vas a construir?

Un sistema de gestión de tareas con estas capas:

```
┌─────────────────────────────────────────────────────────────┐
│              Frontend Vue.js (index.html)                   │
│              Hosting: AWS Amplify                           │
└────────────────┬──────────────────────┬────────────────────┘
                 │ REST (CRUD)           │ WebSocket (live)
                 ▼                      ▼
        HTTP API Gateway        WebSocket API Gateway
        + Cognito JWT           + Lambda Authorizer
                 │                      │
                 ▼                      ▼
          Lambda task-handler    Lambda connect/disconnect
                 │                      │
                 ▼                      ▼
          DynamoDB (tareas)      DynamoDB (conexiones)

          Amazon Cognito ←── Auth de todo el sistema
```

**Por qué cada servicio:**
- **HTTP API Gateway** — expone tu Lambda como endpoints REST. Más barato y rápido que REST API Gateway.
- **Lambda** — código que corre sin servidor. Pagas solo cuando se ejecuta.
- **DynamoDB** — base de datos NoSQL de AWS. Sin servidor, escala automática, gratis en Free Tier.
- **Cognito** — autenticación gestionada. Emite JWTs que API Gateway valida solo.
- **WebSocket API** — conexión persistente para notificaciones en tiempo real.
- **Amplify** — hosting del frontend con un solo comando.

---

## Pre-requisitos

### Herramientas necesarias:
- ✅ Cuenta AWS (Free Tier)
- ✅ AWS CLI instalado y configurado (`aws configure`)
- ✅ AWS SAM CLI instalado
- ✅ Node.js 20+
- ✅ Python 3.12+
- ✅ Editor de código (VS Code recomendado)

### Verificar que todo está listo:
```bash
aws --version          # aws-cli/2.x.x
sam --version          # SAM CLI, version 1.x.x
node --version         # v20.x.x
python3 --version      # Python 3.12.x
```

### Estructura de archivos que vas a crear:
```
taskflow/
├── backend/
│   ├── template.yaml                  ← Infraestructura como código (SAM)
│   └── lambdas/
│       ├── task-handler/
│       │   └── app.mjs               ← CRUD de tareas
│       ├── authorizer/
│       │   └── handler.py            ← Valida JWT de Cognito
│       ├── ws-connect/
│       │   └── app.mjs               ← Guarda conexión WebSocket
│       └── ws-disconnect/
│           └── app.mjs               ← Limpia conexión WebSocket
└── frontend/
    └── index.html                    ← SPA Vue completa
```

---

## FASE 1 — CRUD de Tareas

> **Qué aprenderás:** Cómo una Lambda recibe eventos HTTP de API Gateway, opera con DynamoDB, y devuelve respuestas REST.

### **Paso 1.1: Crear la estructura de carpetas**

```bash
mkdir -p taskflow/backend/lambdas/task-handler
mkdir -p taskflow/backend/lambdas/authorizer
mkdir -p taskflow/backend/lambdas/ws-connect
mkdir -p taskflow/backend/lambdas/ws-disconnect
mkdir -p taskflow/frontend
cd taskflow
```

---

### **Paso 1.2: Escribir la Lambda del CRUD**

Crea el archivo `backend/lambdas/task-handler/app.mjs`.

**¿Por qué `.mjs`?** La extensión `.mjs` indica que usamos ES Modules modernos (`import/export`) en lugar de CommonJS (`require`). Node.js 20 en Lambda soporta esto nativamente.

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
  GetCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";

const client = new DynamoDBClient({});
const dynamo = DynamoDBDocumentClient.from(client);

// Las variables de entorno vienen del template.yaml
const TASKS_TABLE       = process.env.TASKS_TABLE       || "taskflow-tasks";
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || "taskflow-connections";
const WS_ENDPOINT       = process.env.WEBSOCKET_ENDPOINT;
```

**¿Por qué `DynamoDBDocumentClient`?** El cliente base de DynamoDB trabaja con tipos nativos de DynamoDB (`{ S: "valor" }`). `DocumentClient` lo convierte automáticamente a JavaScript normal (`"valor"`). Mucho más cómodo.

```javascript
// ── Broadcast a todos los clientes WebSocket conectados ──────────────────
async function broadcastTaskEvent(eventType, task) {
  if (!WS_ENDPOINT) return;

  const apigw = new ApiGatewayManagementApiClient({ endpoint: WS_ENDPOINT });

  const { Items: connections = [] } = await dynamo.send(
    new ScanCommand({ TableName: CONNECTIONS_TABLE })
  );

  const message = JSON.stringify({ eventType, task });

  const sends = connections.map(async ({ connectionId }) => {
    try {
      await apigw.send(
        new PostToConnectionCommand({ ConnectionId: connectionId, Data: message })
      );
    } catch (err) {
      // GoneException = conexión ya cerrada, ignorar
      if (err.name !== "GoneException") console.error(err);
    }
  });

  await Promise.allSettled(sends);
}
```

**¿Por qué `Promise.allSettled` y no `Promise.all`?** Con `Promise.all`, si una conexión falla, cancela todas las demás. `allSettled` envía a todos independientemente de los fallos individuales.

```javascript
// ── Handler principal ─────────────────────────────────────────────────────
export const handler = async (event) => {
  let body;
  let statusCode = 200;
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",          // CORS para el frontend
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };

  try {
    switch (event.routeKey) {

      case "GET /tasks": {
        const projectId = event.queryStringParameters?.projectId;
        if (projectId) {
          const result = await dynamo.send(
            new QueryCommand({
              TableName: TASKS_TABLE,
              IndexName: "projectId-index",          // GSI que definiremos en DynamoDB
              KeyConditionExpression: "projectId = :pid",
              ExpressionAttributeValues: { ":pid": projectId },
            })
          );
          body = result.Items;
        } else {
          const result = await dynamo.send(new ScanCommand({ TableName: TASKS_TABLE }));
          body = result.Items;
        }
        break;
      }

      case "GET /tasks/{taskId}": {
        const result = await dynamo.send(
          new GetCommand({
            TableName: TASKS_TABLE,
            Key: { taskId: event.pathParameters.taskId },
          })
        );
        body = result.Item ?? null;
        break;
      }

      case "PUT /tasks": {
        const req = JSON.parse(event.body);
        if (!req.taskId || !req.title) {
          statusCode = 400;
          body = "taskId and title are required";
          break;
        }

        const now = new Date().toISOString();
        const item = {
          taskId:      req.taskId,
          title:       req.title,
          description: req.description ?? "",
          status:      req.status      ?? "PENDING",    // PENDING | IN_PROGRESS | DONE
          priority:    req.priority    ?? "MEDIUM",     // LOW | MEDIUM | HIGH
          projectId:   req.projectId   ?? "default",
          assignedTo:  req.assignedTo  ?? null,
          createdBy:   req.createdBy   ?? null,
          createdAt:   req.createdAt   ?? now,
          updatedAt:   now,
        };

        await dynamo.send(new PutCommand({ TableName: TASKS_TABLE, Item: item }));

        // Notificar a todos vía WebSocket
        await broadcastTaskEvent("TASK_UPSERTED", item);

        body = item;
        break;
      }

      case "DELETE /tasks/{taskId}": {
        const { taskId } = event.pathParameters;
        await dynamo.send(
          new DeleteCommand({ TableName: TASKS_TABLE, Key: { taskId } })
        );
        await broadcastTaskEvent("TASK_DELETED", { taskId });
        body = { deleted: taskId };
        break;
      }

      default:
        throw new Error(`Unsupported route: "${event.routeKey}"`);
    }
  } catch (err) {
    statusCode = 400;
    body = err.message;
    console.error("Handler error:", err);
  } finally {
    body = JSON.stringify(body);
  }

  return { statusCode, body, headers };
};
```

**Diferencia clave con el tutorial original:**

| Tutorial (`app.mjs`) | TaskFlow (`task-handler/app.mjs`) |
|---|---|
| Tabla: `http-crud-tutorial-items` | Tabla: `taskflow-tasks` (desde env var) |
| Campos: `id, name, price` | Campos: `taskId, title, status, priority, projectId, assignedTo` |
| Sin broadcast | Llama al WebSocket al final de PUT y DELETE |
| Sin GSI | Query por `projectId` usando GSI |
| Sin CORS headers | Headers CORS para el frontend |

---

### **Paso 1.3: Crear el template SAM base (solo HTTP API)**

Crea `backend/template.yaml`. Empieza con la versión mínima y lo irás ampliando.

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: TaskFlow — CRUD de tareas serverless

Parameters:
  Stage:
    Type: String
    Default: prod

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 10
    MemorySize: 256
    Environment:
      Variables:
        TASKS_TABLE:       !Ref TasksTable
        CONNECTIONS_TABLE: !Ref ConnectionsTable
        STAGE:             !Ref Stage

Resources:

  # ── Tabla de tareas ────────────────────────────────────────────────────
  TasksTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "taskflow-tasks-${Stage}"
      BillingMode: PAY_PER_REQUEST   # sin capacidad provisionada = gratis en Free Tier
      AttributeDefinitions:
        - AttributeName: taskId
          AttributeType: S
        - AttributeName: projectId
          AttributeType: S
      KeySchema:
        - AttributeName: taskId
          KeyType: HASH
      GlobalSecondaryIndexes:
        - IndexName: projectId-index
          KeySchema:
            - AttributeName: projectId
              KeyType: HASH
          Projection:
            ProjectionType: ALL

  # ── Tabla de conexiones WebSocket ──────────────────────────────────────
  ConnectionsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "taskflow-connections-${Stage}"
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: connectionId
          AttributeType: S
      KeySchema:
        - AttributeName: connectionId
          KeyType: HASH
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true           # limpia conexiones expiradas automáticamente

  # ── HTTP API con auth Cognito ──────────────────────────────────────────
  TaskApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: !Ref Stage
      CorsConfiguration:
        AllowOrigins: ["*"]
        AllowHeaders: ["Content-Type", "Authorization"]
        AllowMethods: ["GET", "PUT", "DELETE", "OPTIONS"]
      Auth:
        DefaultAuthorizer: CognitoAuthorizer
        Authorizers:
          CognitoAuthorizer:
            IdentitySource: "$request.header.Authorization"
            JwtConfiguration:
              issuer: !Sub "https://cognito-idp.${AWS::Region}.amazonaws.com/${TaskFlowUserPool}"
              audience: [!Ref TaskFlowUserPoolClient]

  # ── Lambda CRUD ────────────────────────────────────────────────────────
  TaskHandlerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "taskflow-task-handler-${Stage}"
      CodeUri: lambdas/task-handler/
      Handler: app.handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref TasksTable
        - DynamoDBReadPolicy:
            TableName: !Ref ConnectionsTable
        - Statement:
            - Effect: Allow
              Action: execute-api:ManageConnections
              Resource: !Sub "arn:aws:execute-api:${AWS::Region}:${AWS::AccountId}:${WebSocketApi}/${Stage}/POST/@connections/*"
      Environment:
        Variables:
          WEBSOCKET_ENDPOINT: !Sub "https://${WebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}"
      Events:
        GetTasks:
          Type: HttpApi
          Properties:
            ApiId: !Ref TaskApi
            Path: /tasks
            Method: GET
        GetTask:
          Type: HttpApi
          Properties:
            ApiId: !Ref TaskApi
            Path: /tasks/{taskId}
            Method: GET
        UpsertTask:
          Type: HttpApi
          Properties:
            ApiId: !Ref TaskApi
            Path: /tasks
            Method: PUT
        DeleteTask:
          Type: HttpApi
          Properties:
            ApiId: !Ref TaskApi
            Path: /tasks/{taskId}
            Method: DELETE

Outputs:
  HttpApiEndpoint:
    Description: "URL de la HTTP API"
    Value: !Sub "https://${TaskApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}"
```

**¿Qué es SAM?** SAM (Serverless Application Model) es una extensión de CloudFormation. Con `Transform: AWS::Serverless-2016-10-31` activas tipos de recursos simplificados como `AWS::Serverless::Function` que internamente crean Lambda + IAM Role + Log Group automáticamente.

---

### **Paso 1.4: Prueba local de la Lambda (opcional pero recomendado)**

SAM permite invocar la Lambda sin deployar:

```bash
cd backend

# Crear evento de prueba
cat > event-get-tasks.json <<EOF
{
  "routeKey": "GET /tasks",
  "queryStringParameters": { "projectId": "backend" },
  "pathParameters": {},
  "body": null
}
EOF

# Invocar localmente (requiere Docker corriendo)
sam local invoke TaskHandlerFunction --event event-get-tasks.json
```

**¿Qué significa el error `ResourceNotFoundException`?** Normal en local — la tabla DynamoDB no existe aún. Eso se crea en el deploy.

---

## FASE 2 — Autenticación con Cognito

> **Qué aprenderás:** Cognito emite JWTs con firma RS256. API Gateway los valida automáticamente usando las claves públicas del User Pool (JWKS). Tu Lambda Authorizer hace lo mismo pero para WebSocket.

### **Paso 2.1: Entender cómo funciona Cognito + JWT**

```
Usuario hace login
      │
      ▼
Cognito valida credenciales
      │
      ▼
Cognito emite 3 tokens:
  - AccessToken   → para llamar APIs de Cognito
  - IdToken       → contiene email, sub (userId), etc. — este usamos nosotros
  - RefreshToken  → para renovar los anteriores sin re-login
      │
      ▼
Frontend guarda IdToken en memoria
      │
      ▼
Cada request lleva: Authorization: Bearer <IdToken>
      │
      ▼
API Gateway verifica la firma del JWT contra las claves públicas de Cognito
(URL pública: https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json)
      │
      ▼
Si válido → pasa a Lambda
Si inválido → 401 Unauthorized (sin tocar tu Lambda)
```

### **Paso 2.2: Agregar Cognito al template.yaml**

Agrega estos recursos en la sección `Resources` de tu `template.yaml`, **antes** del recurso `TaskApi`:

```yaml
  # ── Cognito User Pool ──────────────────────────────────────────────────
  TaskFlowUserPool:
    Type: AWS::Cognito::UserPool
    Properties:
      UserPoolName: !Sub "taskflow-users-${Stage}"
      AutoVerifiedAttributes: [email]   # envía código de verificación por email
      UsernameAttributes: [email]       # login con email, no username
      Policies:
        PasswordPolicy:
          MinimumLength: 8
          RequireUppercase: true
          RequireLowercase: true
          RequireNumbers: true
          RequireSymbols: false

  TaskFlowUserPoolClient:
    Type: AWS::Cognito::UserPoolClient
    Properties:
      ClientName: taskflow-web-client
      UserPoolId: !Ref TaskFlowUserPool
      ExplicitAuthFlows:
        - ALLOW_USER_PASSWORD_AUTH    # login con email + password
        - ALLOW_REFRESH_TOKEN_AUTH    # renovar tokens
      GenerateSecret: false           # DEBE ser false para apps web/SPA
```

**¿Por qué `GenerateSecret: false`?** El App Secret es para backends que pueden guardarlo de forma segura. En un frontend (navegador), el código es visible, por lo que no se puede guardar un secreto. Las SPAs siempre usan `GenerateSecret: false`.

Agrega también en `Outputs`:
```yaml
  UserPoolId:
    Value: !Ref TaskFlowUserPool
  UserPoolClientId:
    Value: !Ref TaskFlowUserPoolClient
```

---

### **Paso 2.3: Escribir el Lambda Authorizer para WebSocket**

Crea `backend/lambdas/authorizer/handler.py`.

**¿Por qué Python y no Node.js aquí?** El tutorial `ws-sfn-starter.yaml` ya usa Python para el authorizer. Además, demuestra que manejas ambos runtimes — es un plus en entrevistas.

**¿Por qué necesitamos este Authorizer si HTTP API lo hace automático?** Porque API Gateway solo soporta JWT nativo en **HTTP APIs**, no en **WebSocket APIs**. Para WebSocket hay que validar el token manualmente en una Lambda.

```python
"""
Lambda Authorizer para WebSocket API Gateway.
Valida el JWT emitido por Amazon Cognito.

Variables de entorno requeridas:
  - COGNITO_USER_POOL_ID   → us-east-1_XXXXXXXXX
  - COGNITO_APP_CLIENT_ID  → 1example23456789
  - AWS_REGION             → inyectada automáticamente por Lambda
"""

import json
import logging
import os
import urllib.request
from jose import jwt, JWTError, ExpiredSignatureError

logger = logging.getLogger()
logger.setLevel("INFO")

REGION    = os.environ.get("AWS_REGION", "us-east-1")
POOL_ID   = os.environ["COGNITO_USER_POOL_ID"]
CLIENT_ID = os.environ["COGNITO_APP_CLIENT_ID"]

JWKS_URL = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}/.well-known/jwks.json"

# Cache en memoria entre invocaciones "warm" (Lambda reutiliza el contenedor)
_jwks_cache = None


def get_jwks():
    """Descarga las claves públicas de Cognito (solo la primera vez)."""
    global _jwks_cache
    if _jwks_cache is None:
        with urllib.request.urlopen(JWKS_URL, timeout=5) as resp:
            _jwks_cache = json.loads(resp.read())
    return _jwks_cache


def validate_token(token: str) -> dict:
    """Valida firma, expiración y audience del JWT."""
    jwks = get_jwks()
    header = jwt.get_unverified_header(token)
    key = next((k for k in jwks["keys"] if k["kid"] == header.get("kid")), None)
    if not key:
        raise ValueError("Public key not found")
    return jwt.decode(token, key, algorithms=["RS256"], audience=CLIENT_ID)


def generate_policy(principal_id, effect, resource, context=None):
    policy = {
        "principalId": principal_id,
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{"Action": "execute-api:Invoke", "Effect": effect, "Resource": resource}],
        },
    }
    if context:
        policy["context"] = context   # datos accesibles en el handler $connect
    return policy


def lambda_handler(event, context):
    method_arn = event.get("methodArn", "*")
    token = (event.get("headers") or {}).get("Authorization", "").removeprefix("Bearer ").strip()

    if not token:
        logger.warning("No token — denying")
        return generate_policy("anonymous", "Deny", method_arn)

    try:
        payload = validate_token(token)
        user_id  = payload.get("sub")
        email    = payload.get("email", "")
        username = payload.get("cognito:username", user_id)

        logger.info("Authorized: %s (%s)", username, email)

        return generate_policy(user_id, "Allow", method_arn, {
            "principalId": user_id,
            "userId":      user_id,
            "email":       email,
            "username":    username,
        })

    except ExpiredSignatureError:
        logger.warning("Token expired")
        return generate_policy("expired", "Deny", method_arn)
    except (JWTError, ValueError) as err:
        logger.error("Invalid token: %s", err)
        return generate_policy("invalid", "Deny", method_arn)
```

**Diferencia con el authorizer del tutorial (`ws-sfn-starter.yaml`):**

| Tutorial | TaskFlow |
|---|---|
| `if event['headers']['Authorization'] == "Allow"` | Valida JWT RS256 real de Cognito |
| Token hardcodeado (solo para demo) | Descarga JWKS del User Pool |
| No pasa contexto al $connect | Pasa `userId`, `email`, `username` al siguiente handler |

---

### **Paso 2.4: Instalar dependencia del Authorizer**

El runtime de Python en Lambda no incluye `python-jose`. Hay que empaquetarlo junto al código.

```bash
cd backend/lambdas/authorizer

# Instalar dependencias en la carpeta actual
pip install python-jose cryptography -t .

# Verificar
ls
# handler.py   jose/   cryptography/   ...
```

**¿Por qué `-t .`?** El flag `-t` (target) instala los paquetes en el directorio actual en lugar de en el Python global. Lambda espera que las dependencias estén junto al código.

---

## FASE 3 — WebSocket en tiempo real

> **Qué aprenderás:** Cómo API Gateway mantiene conexiones WebSocket persistentes y las delega a Lambdas por evento ($connect, $disconnect, mensajes).

### **Paso 3.1: Entender el flujo WebSocket**

```
Browser abre WebSocket
      │
      ▼
API Gateway recibe conexión → invoca Lambda Authorizer
      │
      ├── Token inválido → cierra conexión (403)
      │
      └── Token válido → invoca Lambda $connect
              │
              ▼
        ws-connect guarda { connectionId, userId } en DynamoDB
              │
              ▼
        Conexión establecida — el browser puede recibir mensajes

Mientras tanto, cuando alguien hace PUT /tasks via HTTP API:
      │
      ▼
task-handler guarda la tarea en DynamoDB
      │
      ▼
task-handler lee TODAS las connectionIds de DynamoDB
      │
      ▼
task-handler llama @connections/{connectionId} por cada una
      │
      ▼
Cada browser conectado recibe { eventType: "TASK_UPSERTED", task: {...} }
```

### **Paso 3.2: Escribir ws-connect**

Crea `backend/lambdas/ws-connect/app.mjs`:

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE  = process.env.CONNECTIONS_TABLE || "taskflow-connections";

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  // El Authorizer pasa userId y username en requestContext.authorizer
  const userId   = event.requestContext.authorizer?.userId   ?? "anonymous";
  const username = event.requestContext.authorizer?.username ?? "anonymous";

  try {
    await dynamo.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          connectionId,
          userId,
          username,
          connectedAt: new Date().toISOString(),
          ttl: Math.floor(Date.now() / 1000) + 7200,  // expira en 2 horas
        },
      })
    );
    console.log(`Connected: ${connectionId} (${username})`);
    return { statusCode: 200 };
  } catch (err) {
    console.error("Connect error:", err);
    return { statusCode: 500 };
  }
};
```

**¿Por qué TTL de 2 horas?** API Gateway cierra conexiones WebSocket inactivas después de 2 horas. Sin TTL, DynamoDB acumularía `connectionId` muertos y los broadcasts fallarían con `GoneException`.

---

### **Paso 3.3: Escribir ws-disconnect**

Crea `backend/lambdas/ws-disconnect/app.mjs`:

```javascript
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE  = process.env.CONNECTIONS_TABLE || "taskflow-connections";

export const handler = async (event) => {
  const connectionId = event.requestContext.connectionId;

  try {
    await dynamo.send(
      new DeleteCommand({ TableName: TABLE, Key: { connectionId } })
    );
    console.log(`Disconnected: ${connectionId}`);
    return { statusCode: 200 };
  } catch (err) {
    console.error("Disconnect error:", err);
    return { statusCode: 500 };
  }
};
```

---

### **Paso 3.4: Agregar WebSocket al template.yaml**

Agrega estos recursos en `Resources` (después de los recursos de Cognito):

```yaml
  # ── WebSocket API ──────────────────────────────────────────────────────
  WebSocketApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: !Sub "taskflow-ws-${Stage}"
      ProtocolType: WEBSOCKET
      RouteSelectionExpression: "$request.body.action"

  WebSocketStage:
    Type: AWS::ApiGatewayV2::Stage
    Properties:
      ApiId: !Ref WebSocketApi
      StageName: !Ref Stage
      AutoDeploy: true

  # ── Lambda Authorizer ──────────────────────────────────────────────────
  WsAuthorizerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "taskflow-ws-authorizer-${Stage}"
      CodeUri: lambdas/authorizer/
      Handler: handler.lambda_handler
      Runtime: python3.12
      Environment:
        Variables:
          COGNITO_USER_POOL_ID:  !Ref TaskFlowUserPool
          COGNITO_APP_CLIENT_ID: !Ref TaskFlowUserPoolClient

  WsAuthorizer:
    Type: AWS::ApiGatewayV2::Authorizer
    Properties:
      ApiId: !Ref WebSocketApi
      AuthorizerType: REQUEST
      AuthorizerUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${WsAuthorizerFunction.Arn}/invocations"
      IdentitySource: ["route.request.header.Authorization"]
      Name: CognitoJwtAuthorizer

  WsAuthorizerPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !GetAtt WsAuthorizerFunction.Arn
      Principal: apigateway.amazonaws.com

  # ── $connect ──────────────────────────────────────────────────────────
  WsConnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "taskflow-ws-connect-${Stage}"
      CodeUri: lambdas/ws-connect/
      Handler: app.handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  WsConnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref WebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${WsConnectFunction.Arn}/invocations"

  WsConnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref WebSocketApi
      RouteKey: $connect
      AuthorizationType: CUSTOM
      AuthorizerId: !Ref WsAuthorizer
      Target: !Sub "integrations/${WsConnectIntegration}"

  WsConnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !GetAtt WsConnectFunction.Arn
      Principal: apigateway.amazonaws.com

  # ── $disconnect ───────────────────────────────────────────────────────
  WsDisconnectFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "taskflow-ws-disconnect-${Stage}"
      CodeUri: lambdas/ws-disconnect/
      Handler: app.handler
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref ConnectionsTable

  WsDisconnectIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref WebSocketApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${WsDisconnectFunction.Arn}/invocations"

  WsDisconnectRoute:
    Type: AWS::ApiGatewayV2::Route
    Properties:
      ApiId: !Ref WebSocketApi
      RouteKey: $disconnect
      AuthorizationType: NONE
      Target: !Sub "integrations/${WsDisconnectIntegration}"

  WsDisconnectPermission:
    Type: AWS::Lambda::Permission
    Properties:
      Action: lambda:InvokeFunction
      FunctionName: !GetAtt WsDisconnectFunction.Arn
      Principal: apigateway.amazonaws.com
```

Agrega en `Outputs`:
```yaml
  WebSocketEndpoint:
    Value: !Sub "wss://${WebSocketApi}.execute-api.${AWS::Region}.amazonaws.com/${Stage}"
```

---

## FASE 4 — Frontend Vue + Amplify

> **Qué aprenderás:** Cómo autenticar con Cognito desde el browser sin el SDK (fetch puro), llamar tu API REST, y mantener una conexión WebSocket activa.

### **Paso 4.1: Entender cómo Cognito acepta login sin SDK**

Cognito expone un endpoint HTTP estándar. Puedes llamarlo con `fetch` normal:

```
POST https://cognito-idp.<region>.amazonaws.com/
Headers:
  Content-Type: application/x-amz-json-1.1
  X-Amz-Target: AWSCognitoIdentityProviderService.InitiateAuth
Body:
  {
    "AuthFlow": "USER_PASSWORD_AUTH",
    "ClientId": "<tu-client-id>",
    "AuthParameters": {
      "USERNAME": "usuario@email.com",
      "PASSWORD": "su-password"
    }
  }
```

Respuesta exitosa:
```json
{
  "AuthenticationResult": {
    "IdToken": "eyJhbGc...",
    "AccessToken": "eyJhbGc...",
    "RefreshToken": "eyJjdH..."
  }
}
```

### **Paso 4.2: Crear el frontend**

Crea `frontend/index.html`. El archivo completo ya fue generado — solo necesitas editar la sección `CONFIG` con los valores del deploy:

```javascript
const CONFIG = {
  HTTP_API:      'https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod',
  WS_API:        'wss://YYYYYYYYYY.execute-api.us-east-1.amazonaws.com/prod',
  USER_POOL_ID:  'us-east-1_XXXXXXXXX',
  CLIENT_ID:     '1example23456789',
  REGION:        'us-east-1',
};
```

Obtendrás estos valores en el **Paso 5.3** (después del deploy SAM).

---

### **Paso 4.3: Hostear con Amplify**

**¿Por qué Amplify y no S3 directamente?** Amplify proporciona HTTPS automático, CDN global, y deploy con un comando. Para la vacante, Amplify es la herramienta **indispensable** que piden explícitamente.

```bash
# Instalar Amplify CLI
npm install -g @aws-amplify/cli

# Configurar Amplify (solo la primera vez)
amplify configure
# → Abre browser para login en AWS Console
# → Sigue el wizard: región, usuario IAM, access keys

# En la carpeta del frontend
cd taskflow/frontend
amplify init
# → Project name: taskflow
# → Environment: prod
# → Default editor: tu editor
# → App type: javascript
# → Framework: none
# → Source dir: .
# → Build dir: .
# → Build command: (dejar vacío)
# → Start command: (dejar vacío)

amplify add hosting
# → Select: Hosting with Amplify Console
# → Select: Manual deployment

amplify publish
# → Sube index.html y te da la URL pública
```

**Guardar la URL de Amplify:**
```
https://main.XXXXXXXXXXXX.amplifyapp.com
```

---

## FASE 5 — Deploy unificado con SAM

> **Qué aprenderás:** Cómo SAM despliega toda la infraestructura con un solo comando y genera los Outputs que necesitas.

### **Paso 5.1: Build con SAM**

```bash
cd taskflow/backend
sam build
```

**¿Qué hace `sam build`?**
- Empaqueta cada Lambda en un zip
- Resuelve dependencias (node_modules, packages de Python)
- Crea una carpeta `.aws-sam/` con todo listo para deploy

Si ves un error sobre `python-jose` no encontrado, es porque las dependencias del authorizer deben estar junto al código (ver Paso 2.4).

---

### **Paso 5.2: Deploy (primera vez)**

```bash
sam deploy --guided
```

El wizard te preguntará:

| Pregunta | Respuesta |
|---|---|
| Stack Name | `taskflow` |
| AWS Region | `us-east-1` (o tu región) |
| Parameter Stage | `prod` |
| Confirm changes before deploy | `Y` |
| Allow SAM CLI IAM role creation | `Y` |
| Disable rollback | `N` |
| Save arguments to samconfig.toml | `Y` |

Tiempo estimado: 3-5 minutos. SAM crea todos los recursos en CloudFormation.

---

### **Paso 5.3: Guardar los Outputs**

Al terminar verás algo así:

```
Outputs
------------------------------------------------------------------------------------------
Key                 HttpApiEndpoint
Value               https://ab12cd34ef.execute-api.us-east-1.amazonaws.com/prod

Key                 WebSocketEndpoint
Value               wss://gh56ij78kl.execute-api.us-east-1.amazonaws.com/prod

Key                 UserPoolId
Value               us-east-1_Abc123Def

Key                 UserPoolClientId
Value               1abc2def3ghi4jkl5mno6pqr
```

**Guardar estos valores — los necesitas en el frontend:**
```
HTTP_API     = https://ab12cd34ef.execute-api.us-east-1.amazonaws.com/prod
WS_API       = wss://gh56ij78kl.execute-api.us-east-1.amazonaws.com/prod
USER_POOL_ID = us-east-1_Abc123Def
CLIENT_ID    = 1abc2def3ghi4jkl5mno6pqr
```

---

### **Paso 5.4: Actualizar el CONFIG del frontend**

Edita `frontend/index.html`, busca la sección `CONFIG` y reemplaza los placeholders con los valores reales del paso anterior.

Luego re-deploya:
```bash
cd taskflow/frontend
amplify publish
```

---

### **Paso 5.5: Probar todo el sistema**

**Probar el CRUD (obtener token primero):**
```bash
# Login y obtener IdToken
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <CLIENT_ID> \
  --auth-parameters USERNAME=tu@email.com,PASSWORD=TuPassword1 \
  --query 'AuthenticationResult.IdToken' \
  --output text)

# Crear una tarea
curl -X PUT <HTTP_API>/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-001",
    "title": "Mi primera tarea en AWS",
    "status": "PENDING",
    "priority": "HIGH",
    "projectId": "backend"
  }'

# Listar tareas del proyecto "backend"
curl "<HTTP_API>/tasks?projectId=backend" \
  -H "Authorization: Bearer $TOKEN"

# Eliminar tarea
curl -X DELETE "<HTTP_API>/tasks/task-001" \
  -H "Authorization: Bearer $TOKEN"
```

**Probar WebSocket:**
```bash
# Instalar wscat
npm install -g wscat

# Conectar (token en query param para wscat)
wscat -c "<WS_API>?token=$TOKEN"

# En otra terminal, crear una tarea via curl
# Deberías ver el mensaje aparecer en wscat:
# < {"eventType":"TASK_UPSERTED","task":{...}}
```

---

### **Paso 5.6: Deployments posteriores**

Después de modificar cualquier Lambda, solo:
```bash
cd taskflow/backend
sam build && sam deploy
```

SAM detecta solo los recursos que cambiaron y actualiza solo esos.

---

## Gestión de Costos

### ¿Cuánto cuesta este proyecto? (Free Tier)

| Servicio | Free Tier | Costo al exceder |
|---|---|---|
| Lambda | 1M invocaciones/mes | $0.0000002 por invocación |
| DynamoDB | 25 GB, 200M requests/mes | $0.25/GB |
| API Gateway HTTP | 1M requests/mes (primeros 12 meses) | $1/millón |
| API Gateway WS | 1M mensajes/mes (primeros 12 meses) | $1/millón |
| Cognito | 50,000 MAU | $0.0055/MAU |
| Amplify Hosting | 5 GB / 15 GB transfer/mes | $0.023/GB |

**Para un proyecto de portafolio con uso normal: $0/mes.**

### Eliminar todo cuando termines:
```bash
# Eliminar stack SAM (DynamoDB, Lambdas, APIs, Cognito)
cd taskflow/backend
sam delete

# Eliminar hosting de Amplify
cd taskflow/frontend
amplify delete
```

---

## Troubleshooting

### ❌ `sam build` falla con "No module named jose"

**Causa:** Las dependencias de Python no están en la carpeta del authorizer.

**Solución:**
```bash
cd backend/lambdas/authorizer
pip install python-jose cryptography -t .
```

---

### ❌ API Gateway devuelve 401 en todos los requests

**Causa:** El JWT no está en el formato correcto o expiró.

**Diagnóstico:**
```bash
# Decodificar el token para ver su contenido (sin verificar firma)
echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
# Ver si "exp" (expiration) ya pasó
```

**Solución:** El token de Cognito expira en 1 hora. Obtén uno nuevo:
```bash
TOKEN=$(aws cognito-idp initiate-auth ...)
```

---

### ❌ WebSocket conecta pero no llegan mensajes de broadcast

**Causa 1:** La variable `WEBSOCKET_ENDPOINT` de la Lambda `task-handler` no está configurada.

**Verificar:**
```bash
aws lambda get-function-configuration \
  --function-name taskflow-task-handler-prod \
  --query 'Environment.Variables'
```

**Causa 2:** La Lambda `task-handler` no tiene permiso `execute-api:ManageConnections`.

**Verificar:**
```bash
aws lambda get-function --function-name taskflow-task-handler-prod \
  --query 'Configuration.Role'
# Ir a IAM y verificar que el rol tiene la policy ManageConnections
```

---

### ❌ CORS error en el browser

**Causa:** Los headers CORS no están en la respuesta de Lambda.

**Solución:** Verificar que `task-handler/app.mjs` incluye estos headers en todas las respuestas:
```javascript
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};
```

---

### ❌ `sam delete` falla porque DynamoDB tiene datos

**Solución:**
```bash
# Vaciar la tabla primero (opcional)
aws dynamodb delete-table --table-name taskflow-tasks-prod
aws dynamodb delete-table --table-name taskflow-connections-prod

# Luego eliminar el stack
sam delete
```

---

## 🎯 Comandos de referencia rápida

```bash
# Build y deploy
sam build && sam deploy

# Ver logs de una Lambda en tiempo real
sam logs -n TaskHandlerFunction --stack-name taskflow --tail

# Ver todos los recursos creados
aws cloudformation describe-stack-resources --stack-name taskflow

# Obtener los Outputs del stack
aws cloudformation describe-stacks --stack-name taskflow \
  --query 'Stacks[0].Outputs'

# Probar el WebSocket
wscat -c "wss://<WS_ENDPOINT>?token=$TOKEN"

# Limpiar todo
sam delete && amplify delete
```

---

## 📚 Qué puedes decir en la entrevista

**"¿Cómo funciona tu proyecto TaskFlow?"**

> *"Es un sistema fullstack serverless en AWS. El frontend en Vue usa Amplify para hosting. El backend tiene dos APIs: una HTTP API con autenticación JWT nativa de Cognito para el CRUD de tareas, y una WebSocket API con un Lambda Authorizer custom en Python que valida los mismos tokens de Cognito. Cuando alguien modifica una tarea, la Lambda hace broadcast a todas las conexiones WebSocket activas usando la API de Management de API Gateway. La infraestructura está definida como código en SAM/CloudFormation, por lo que todo el stack se puede crear o destruir con un solo comando."*

**"¿Cuándo usas DynamoDB vs RDS?"**

> *"DynamoDB cuando necesito escala automática, baja latencia, o acceso por clave primaria. RDS cuando necesito consultas relacionales complejas o tengo un modelo de datos muy estructurado. En TaskFlow usé DynamoDB porque el acceso principal es por taskId (clave) o projectId (GSI), sin joins complejos."*

**"¿Qué es el Lambda Authorizer?"**

> *"Es una Lambda que API Gateway invoca antes de pasar el request al handler real. Recibe el token JWT, descarga las claves públicas de Cognito (JWKS), valida la firma y devuelve una política IAM. Si dice Allow, el request continúa; si dice Deny, API Gateway rechaza con 403 sin que tu código principal se ejecute."*

---

**¡Listo! Construiste un sistema serverless fullstack real en AWS. 🚀**
