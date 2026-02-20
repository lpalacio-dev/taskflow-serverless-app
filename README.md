# TaskFlow — Gestión de tareas serverless en tiempo real

Sistema fullstack serverless en AWS que combina HTTP API REST, WebSocket de tiempo real y autenticación con Cognito.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vue.js)                        │
│            Hosting: AWS Amplify / S3 + CloudFront           │
└────────────────┬─────────────────────┬──────────────────────┘
                 │ HTTP (REST)          │ WebSocket
                 ▼                     ▼
┌───────────────────────┐   ┌──────────────────────────────┐
│   HTTP API Gateway    │   │   WebSocket API Gateway      │
│   (CRUD de tareas)    │   │   (notificaciones en vivo)   │
│   + Cognito JWT Auth  │   │   + Lambda Authorizer        │
└──────────┬────────────┘   └──────────┬───────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────┐         ┌────────────────────────────┐
│  Lambda          │         │  Lambda   │  Lambda         │
│  task-handler    │──────── │  connect  │  disconnect     │
│  (Node.js 20)    │broadcast└────────────────────────────┘
└──────────┬───────┘              │
           │                      ▼
           ▼              ┌───────────────────┐
┌──────────────────┐      │  DynamoDB         │
│  DynamoDB        │      │  taskflow-        │
│  taskflow-tasks  │      │  connections      │
│  (GSI projectId) │      │  (TTL 2h)         │
└──────────────────┘      └───────────────────┘

┌──────────────────┐
│  Amazon Cognito  │  ← Autenticación JWT centralizada
│  User Pool       │
└──────────────────┘
```

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML + Vue.js (vanilla, sin build step) |
| Hosting | AWS Amplify |
| Auth | Amazon Cognito User Pools + JWT |
| HTTP API | AWS API Gateway HTTP API |
| WebSocket | AWS API Gateway WebSocket API |
| Compute | AWS Lambda (Node.js 20 + Python 3.12) |
| Base de datos | Amazon DynamoDB (PAY_PER_REQUEST) |
| IaC | AWS SAM (CloudFormation) |

## Flujo de datos

**CRUD de tarea:**
1. Frontend hace `PUT /tasks` con `Authorization: Bearer <CognitoJWT>`
2. API Gateway valida el JWT contra Cognito (nativo, sin Lambda)
3. Lambda `task-handler` guarda en DynamoDB `taskflow-tasks`
4. Al final de la escritura, `task-handler` llama a todos los `connectionId` activos via `@connections` de la WebSocket API
5. Cada cliente conectado recibe `{ eventType: "TASK_UPSERTED", task: {...} }` y actualiza su UI sin recargar

**Conexión WebSocket:**
1. Cliente conecta a `wss://...?token=<JWT>` (o header Authorization)
2. API Gateway invoca la Lambda `authorizer` (Python)
3. Authorizer descarga el JWKS de Cognito, valida firma y expiración del JWT
4. Si válido, retorna policy IAM `Allow` con `userId` en context
5. Lambda `ws-connect` guarda `{ connectionId, userId, ttl }` en DynamoDB
6. Al desconectar, `ws-disconnect` elimina el registro

## Estructura del proyecto

```
taskflow/
├── backend/
│   ├── template.yaml                 # SAM template unificado
│   └── lambdas/
│       ├── task-handler/
│       │   └── app.mjs               # CRUD de tareas + broadcast WS
│       ├── authorizer/
│       │   └── handler.py            # Validación JWT de Cognito
│       ├── ws-connect/
│       │   └── app.mjs               # Guarda connectionId
│       └── ws-disconnect/
│           └── app.mjs               # Limpia connectionId
└── frontend/
    └── index.html                    # SPA sin framework build
```

## Deploy paso a paso

### Pre-requisitos
```bash
# AWS CLI configurado
aws configure

# SAM CLI instalado
pip install aws-sam-cli

# Python 3.12+ para el authorizer
pip install python-jose cryptography
```

### 1. Empaquetar el authorizer (Python con dependencias)
```bash
cd backend/lambdas/authorizer
pip install python-jose cryptography -t ./package/
cp handler.py ./package/
cd package && zip -r ../authorizer.zip . && cd ..
```

### 2. Build + Deploy con SAM
```bash
cd backend
sam build --user-profile <userprofile>
sam deploy --guided
# Seguir el wizard: ingresar Stage=prod, confirmar cambios
```

### 3. Anotar los Outputs del deploy
```
HttpApiEndpoint     → https://XXXXXXXXXX.execute-api.us-east-1.amazonaws.com/prod
WebSocketEndpoint   → wss://YYYYYYYYYY.execute-api.us-east-1.amazonaws.com/prod
UserPoolId          → us-east-1_XXXXXXXXX
UserPoolClientId    → 1example23456789
```

### 4. Configurar el frontend con variables de entorno
Editar en `frontend`, crear un archivo `.env` revisar el archivo `.env.example`, también agregar variables de entorno en `Amplify`:
```bash
VITE_HTTP_API=
VITE_WS_API=
VITE_USER_POOL_ID=
VITE_USER_POOL_CLIENT_ID=
VITE_REGION=us-east-1
```

### 5. Hostear el frontend con Amplify si utilizas Gen 1
```bash
npm install -g @aws-amplify/cli
amplify init
amplify add hosting   # elegir: Hosting with Amplify Console → Manual
amplify publish
```

### 6. Limpiar (evitar costos)
```bash
sam delete
```

## Decisiones de diseño

**¿Por qué HTTP API y no REST API de API Gateway?**
HTTP API es ~70% más barato y tiene latencia menor. La vacante pide API Gateway sin especificar el tipo. HTTP API soporta JWT de Cognito nativamente sin Lambda adicional.

**¿Por qué DynamoDB PAY_PER_REQUEST?**
Sin tráfico = $0. Escala automáticamente. Para un proyecto de portafolio es ideal. En producción con carga predecible, Provisioned es más económico.

**¿Por qué el Authorizer del WebSocket es Lambda (Python) y no nativo?**
API Gateway solo soporta JWT nativo en HTTP APIs, no en WebSocket APIs. Para WebSocket se necesita un Lambda Authorizer custom. Python se eligió para mostrar dominio de ambos runtimes (Node.js en CRUD, Python en auth).

**¿Por qué TTL en la tabla de conexiones?**
Las conexiones WebSocket expiran en API Gateway después de 2 horas. Sin TTL, la tabla acumula `connectionId` muertos y los broadcasts fallan. El TTL limpia automáticamente.

## Pruebas rápidas con curl / wscat

```bash
# Obtener token de Cognito
TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <CLIENT_ID> \
  --auth-parameters USERNAME=tu@email.com,PASSWORD=TuPassword1 \
  --query 'AuthenticationResult.IdToken' --output text)

# Crear tarea
curl -X PUT https://<HTTP_API>/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"taskId":"t-001","title":"Primera tarea","status":"PENDING","priority":"HIGH","projectId":"backend"}'

# Listar tareas
curl https://<HTTP_API>/tasks?projectId=backend \
  -H "Authorization: Bearer $TOKEN"

# Conectar al WebSocket (requiere wscat: npm i -g wscat)
wscat -c "wss://<WS_API>?token=$TOKEN"
```
