import { DynamoDB, TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { PathReporter } from 'io-ts/PathReporter';
import { isLeft } from 'fp-ts/Either';
import { str as crc32 } from 'crc-32';

import * as t from 'io-ts';

const TinyURLRecord = t.type({
  tinyURL: t.string,
  fullURL: t.string,
  created: t.string,
})
type TinyURLRecordT = t.TypeOf<typeof TinyURLRecord>

const EncodeRequest = t.type({
  url: t.string,
})
type EncodeRequestT = t.TypeOf<typeof EncodeRequest>

// don't really need a validator for this, we validate the record.
interface EncodeResponseT {
  shortlink: string
}

const DecodeRequest = t.type({
  fullURL: t.string,
})
type DecodeRequestT = t.TypeOf<typeof DecodeRequest>

const decodeEncodeRequest = (input: unknown): EncodeRequestT => {
  const decoded = EncodeRequest.decode(input);
  if (isLeft(decoded)) {
    throw new Error(`could not validate record: ${PathReporter.report(decoded).join("\n")}`)
  }

  return decoded.right;
}
const decodeRecord = (input: unknown): TinyURLRecordT => {
  const decoded = TinyURLRecord.decode(input);
  if (isLeft(decoded)) {
    throw new Error(`could not validate record: ${PathReporter.report(decoded).join("\n")}`)
  }

  return decoded.right;
}

export class TinyURL {
  constructor(private readonly dynamo: DynamoDB, private readonly baseUrl: string, private readonly tableName: string) {
  }

  async encode(req: string, seed: number): Promise<EncodeResponseT> {
    const record = decodeEncodeRequest(JSON.parse(req));
    const crc = crc32(record.url, seed);
    const dynRecord: TinyURLRecordT = {
      fullURL: record.url,
      tinyURL: (crc < 0 ? '1' : '2') + Math.abs(crc).toString(36),
      created: new Date().toISOString(),
    };

    // we need 2 primary keys - full url and tiny url. to facilitate this, we will overload the pk for both. in order
    // to ensure the impossibility of conflict, we will write both in a transaction.
    try {
      await this.dynamo.transactWriteItems({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: marshall({
                ...dynRecord,
                pk: `fullURL#${dynRecord.fullURL}`,
              }),
              ConditionExpression: 'attribute_not_exists(pk)',
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            }
          },
          {
            Put: {
              TableName: this.tableName,
              Item: marshall({
                ...dynRecord,
                pk: `tinyURL#${dynRecord.tinyURL}`,
              }),
              ConditionExpression: 'attribute_not_exists(pk)',
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            }
          },
        ],
      });
    } catch (err) {
      if (!(err instanceof TransactionCanceledException) || err.CancellationReasons === undefined) {
        throw err;
      }

      const [fullFail, tinyFail] = err.CancellationReasons;

      if (fullFail.Code === 'ValidationError') {
        throw new Error(`Validation failed: ${fullFail.Message}`)
      }

      if (fullFail.Code === 'ConditionalCheckFailed') {
        // full url already exists
        return {
          shortlink: this.baseUrl + decodeRecord(unmarshall(fullFail.Item ?? {})).tinyURL,
        };
      }
      if (fullFail.Code === 'None' && tinyFail.Code === 'ConditionalCheckFailed') {
        // inserted fullurl but failed to insert tinyurl - tinyurl was duplicated. we will try as many times as we need
        // to to get a non-conflicting UUID. We'll also log it as a warning because in the real world we would want to
        // be tracking how often we're getting collisions as they would slow down writes and use extra dynamo write
        // capacity. CRC32 collisions are very frequent at scale.
        console.warn(`WARN: duplicate shortURL for ${dynRecord.fullURL}: ${dynRecord.tinyURL}`)
        return this.encode(req, seed + 1);
      }

      throw new Error(`unknown state: fullfail=${fullFail.Code} tinyfail=${tinyFail.Code}`)
    }

    return {
      shortlink: this.baseUrl + dynRecord.tinyURL,
    };
  }

  async decode(url: string): Promise<string> {
    const item = await this.dynamo.getItem({
      TableName: this.tableName,
      Key: {
        pk: {
          S: `tinyURL#${url}`
        }
      },
    });

    if (!item.Item) {
      throw new Error('not found');
    }

    return decodeRecord(unmarshall(item.Item ?? {})).fullURL;
  }
}
