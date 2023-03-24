#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TinyURLStack } from '../lib/tinyurl-stack';
import { CertStack } from '../lib/cert-stack';

const app = new cdk.App();
const certStack = new CertStack(app, 'CertStack', {
  crossRegionReferences: true,
  env: {
    // cloudfront cert must be in us-east-1
    region: 'us-east-1',
  }
});
new TinyURLStack(app, 'TinyURLStack', {
  cfHostedZone: certStack.hostedZone,
  cfCert: certStack.cert,
  cfDomain: certStack.domain,
  crossRegionReferences: true,
  env: {
    region: 'us-west-2',
  }
});
