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