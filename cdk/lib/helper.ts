import * as cdk from "aws-cdk-lib";

// we can't use cdk.Aws.STACK_ID because it won't work properly in our cross-region stack references.
export const stackId = (stackId: string) => cdk.Fn.select(2, cdk.Fn.split('/', stackId));
