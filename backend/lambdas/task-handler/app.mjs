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