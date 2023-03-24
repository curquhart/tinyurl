import { ALBEvent, ALBResult } from 'aws-lambda';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { TinyURL } from "./TinyURL";

const region = process.env.AWS_REGION;
const baseUrl = process.env.BASE_URL;
const tableName = process.env.TINYURL_TABLE;

const init = () => {
  if (!region) {
    throw new Error('missing AWS_REGION env var');
  }
  if (!baseUrl) {
    throw new Error('missing BASE_URL env var');
  }
  if (!tableName) {
    throw new Error('missing TINYURL_TABLE env var');
  }

  return new TinyURL(new DynamoDB({
    region,
    maxAttempts: 8,
  }), baseUrl, tableName);
}

const makeErrorResponse = (err: unknown): ALBResult => {
  console.error(`Error: ${err}`)

  return {
    body: JSON.stringify({ err: `${err}` }),
    headers: {
      'content-type': 'application/json',
    },
    statusCode: 500,
  }
}

export const encode = async (event: ALBEvent): Promise<ALBResult> => {
  const tiny = init();

  // just in case somebody sends a large payload and alb automatically encodes it ;)
  if (event.isBase64Encoded && event.body) {
    event.body = Buffer.from(event.body, 'base64').toString()
  }

  try {
    return {
      body: JSON.stringify(await tiny.encode(event.body ?? '', 1)),
      headers: {
        'content-type': 'application/json',
      },
      statusCode: 200,
    };
  } catch (err) {
    return makeErrorResponse(err);
  }
}

export const decode = async (event: ALBEvent): Promise<ALBResult> => {
  const tiny = init();

  try {
    if (event.path.length < 2) {
      return makeErrorResponse('bad request');
    }
    return {
      headers: {
        location: await tiny.decode(event.path.substring(1)),
      },
      statusCode: 302,
    };
  } catch (err) {
    return makeErrorResponse(err);
  }
}
