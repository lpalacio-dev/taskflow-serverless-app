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