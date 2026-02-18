# 🔧 Fix WebSocket — Pasar token por Query Parameter

## Problema
Los navegadores **no permiten** enviar headers custom en WebSocket nativo (`new WebSocket(url)`). Cuando intentas conectar con:

```javascript
const ws = new WebSocket('wss://...', [], {
  headers: { Authorization: 'Bearer token' }
})
```

El header `Authorization` se ignora silenciosamente. Por eso tu Authorizer rechaza la conexión.

## Solución
Pasar el token como **query parameter** en la URL del WebSocket:

```javascript
const ws = new WebSocket('wss://...?token=tu_jwt_aqui')
```

---

## Paso 1 — Actualizar el Lambda Authorizer

Reemplaza **completamente** el contenido de `backend/lambdas/authorizer/handler.py` con:

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
    
    # ✅ CAMBIO CRÍTICO: Intentar obtener el token del header primero, luego del query param
    token = (event.get("headers") or {}).get("Authorization", "").removeprefix("Bearer ").strip()
    
    if not token:
        # Los browsers no permiten headers custom en WebSocket nativo.
        # El frontend debe pasar el token como query param: wss://...?token=xxx
        query_params = event.get("queryStringParameters") or {}
        token = query_params.get("token", "").strip()

    if not token:
        logger.warning("No token in header or query params — denying")
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

**Qué cambió:**
- Línea 58-62: Ahora intenta leer el token del `queryStringParameters.token` si no lo encuentra en el header `Authorization`.

---

## Paso 2 — Actualizar el template.yaml

En `backend/template.yaml`, busca el recurso `WsAuthorizer` (línea ~185-191) y **reemplázalo** por:

```yaml
  WsAuthorizer:
    Type: AWS::ApiGatewayV2::Authorizer
    Properties:
      ApiId: !Ref WebSocketApi
      AuthorizerType: REQUEST
      AuthorizerUri: !Sub "arn:aws:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${WsAuthorizerFunction.Arn}/invocations"
      # ✅ Aceptar token tanto del header como del query param
      IdentitySource: 
        - "route.request.header.Authorization"
        - "route.request.querystring.token"
      Name: CognitoJwtAuthorizer
```

**Qué cambió:**
- `IdentitySource` ahora es un array con dos elementos: acepta tanto el header como el query param. API Gateway pasa ambos al Lambda Authorizer.

---

## Paso 3 — Re-deployar el backend

```bash
cd backend
sam build
sam deploy
```

Esto actualiza:
1. La Lambda `taskflow-ws-authorizer-prod` con el nuevo código
2. El recurso `WsAuthorizer` en API Gateway con el nuevo `IdentitySource`

**Tiempo estimado:** 2-3 minutos.

---

## Paso 4 — Verificar que el frontend ya está correcto

Si seguiste la guía de Amplify Gen 2, el frontend **ya** está configurado correctamente. En `src/stores/taskflow.js`, la función `connectWs()` debería tener:

```javascript
function connectWs() {
  // ✅ Token en query param (correcto para browsers)
  const wsUrl = `${apiConfig.wsApi}?token=${token.value}`
  ws = new WebSocket(wsUrl)
  // ...
}
```

Si tu código tiene algo diferente (por ejemplo, intentando pasar headers), actualízalo con el código de arriba.

---

## Paso 5 — Probar el WebSocket

1. Abre la app en el browser
2. Inicia sesión
3. Verifica en DevTools → Network → WS que la conexión WebSocket se establece correctamente
4. En otra ventana/incognito, inicia sesión con otro usuario (o el mismo)
5. En la ventana 1, crea una tarea nueva
6. ✅ La tarea debe aparecer en la ventana 2 automáticamente sin recargar
7. El indicador **LIVE** (ws-dot) debe estar verde en ambas ventanas

---

## Troubleshooting

### ❌ Sigue sin conectar (403 Forbidden)

**Diagnóstico:** Ver logs del Authorizer

```bash
sam logs -n WsAuthorizerFunction --stack-name taskflow --tail
```

Busca líneas como:
- `"No token in header or query params"` → el token no está llegando
- `"Token expired"` → necesitas obtener un token fresco (cierra sesión y vuelve a iniciar)
- `"Public key not found"` → el `kid` del JWT no coincide con el JWKS de Cognito (probablemente el `CLIENT_ID` en el template está mal)

**Soluciones:**
1. Verificar que en el browser DevTools → Network → WS ves el query param `?token=eyJhbGciOi...` en la URL
2. Si no está el token en la URL, revisar que `connectWs()` en el frontend lo incluye
3. Si el token está pero igual falla, copiar el token de la URL y decodificarlo en https://jwt.io para verificar que el `aud` (audience) coincide con tu `UserPoolClientId`

---

### ❌ Conecta pero no llegan mensajes

**Diagnóstico:** El problema no es el Authorizer (ya autorizó), es el broadcast.

```bash
# Ver logs de la Lambda task-handler
sam logs -n TaskHandlerFunction --stack-name taskflow --tail
```

Busca líneas como `GoneException` — significa que está intentando enviar a conexiones que ya expiraron.

**Solución:** El `broadcastTaskEvent()` en `task-handler/app.mjs` ya maneja esto con:

```javascript
catch (err) {
  if (err.name !== "GoneException") console.error(err);
}
```

Si ves otros errores, verifica:
1. Que `WEBSOCKET_ENDPOINT` en las variables de entorno de la Lambda es correcto
2. Que la Lambda tiene permisos `execute-api:ManageConnections` (ya está en el template)

---

### ❌ Los logs muestran "Token expired"

**Causa:** El token JWT de Cognito expira en **1 hora** por defecto.

**Solución:** Implementar renovación automática en el frontend. En `src/stores/taskflow.js`, modifica `loadSession()`:

```javascript
async function loadSession() {
  const cognitoUser = await getCurrentUser()
  const session     = await fetchAuthSession({ forceRefresh: true })  // ← forzar refresh
  token.value = session.tokens?.idToken?.toString()
  user.value  = {
    userId:   cognitoUser.userId,
    email:    cognitoUser.signInDetails?.loginId ?? '',
    username: cognitoUser.username,
  }
}
```

Y en el `onMounted()` de `App.vue`, verificar la sesión cada 30 minutos:

```javascript
onMounted(async () => {
  await taskflow.loadSession()
  router.push('/app')
  
  // Renovar token cada 30 minutos
  setInterval(() => taskflow.loadSession(), 1800000)
})
```

---

## Resumen de cambios

| Archivo | Cambio |
|---------|--------|
| `backend/lambdas/authorizer/handler.py` | Lee token del query param si no está en header |
| `backend/template.yaml` | `IdentitySource` ahora incluye `route.request.querystring.token` |
| `frontend/src/stores/taskflow.js` | Ya estaba correcto: `?token=${token.value}` |

**Después de aplicar estos cambios, el WebSocket funcionará en todos los browsers modernos.**
