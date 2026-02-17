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