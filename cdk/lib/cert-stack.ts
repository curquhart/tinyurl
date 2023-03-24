import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as helper from './helper';

export class CertStack extends cdk.Stack {
  public readonly hostedZone: route53.HostedZone;
  public readonly cert: acm.Certificate;
  public readonly domain: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = `tinyurl-${helper.stackId(this.stackId)}.chelseau.com`;

    this.hostedZone = new route53.HostedZone(this, 'Dns', {
      zoneName: domainName,
    });
    this.domain = domainName;

    this.cert = new acm.Certificate(this, 'Certificate', {
      domainName: domainName,
      validation: acm.CertificateValidation.fromDns(this.hostedZone),
    });
  }
}
