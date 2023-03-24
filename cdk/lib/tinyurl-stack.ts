import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as elbTargets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontorigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as helper from './helper';

interface TinyURLStackProps extends cdk.StackProps {
  cfHostedZone: route53.HostedZone;
  cfCert: acm.Certificate;
  cfDomain: string;
}

export class TinyURLStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TinyURLStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    vpc.addGatewayEndpoint('DynamoDB', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    })

    const table = new dynamodb.Table(this, 'UrlsTable', {
      tableName: 'tinyurls',
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    const alb = new elb.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      // default sg is fine for our purposes. we may want to limit to the cloudfront prefix list though if we wanted to
      // prevent accessing the backend directly.
    });

    const hostedZone = new route53.HostedZone(this, 'Dns', {
      zoneName: `tinyurl-${helper.stackId(this.stackId)}.chelseau.com`,
    });

    const cert = new acm.Certificate(this, 'Certificate', {
      domainName: `tinyurl-${helper.stackId(this.stackId)}.chelseau.com`,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    const dist = new cloudfront.Distribution(this, 'CFDist', {
      defaultBehavior: {
        origin: new cloudfrontorigins.HttpOrigin(hostedZone.zoneName),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: new cloudfront.CachePolicy(this, 'CFCache', {
          defaultTtl: cdk.Duration.hours(1),
        }),
      },
      domainNames: [props.cfDomain],
      certificate: props.cfCert,
      enabled: true,
      // might want to throw a WAF on this for DDOS protection.
    });

    new route53.ARecord(this, 'CfDns', {
      zone: props.cfHostedZone,
      target: route53.RecordTarget.fromAlias(new route53targets.CloudFrontTarget(dist))
    });

    new route53.ARecord(this, 'AlbDns', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new route53targets.LoadBalancerTarget(alb))
    });

    this.exportValue(`https://${props.cfDomain}/`, {
      name: 'DomainName'
    })

    const lambdaProps = {
      runtime: lambda.Runtime.NODEJS_18_X,
      environment: {
        TINYURL_TABLE: table.tableName,
        BASE_URL: `https://${props.cfDomain}/`
      },
      code: lambda.Code.fromAsset(`${__dirname}/../../dist/`),
    }

    const encoder = new lambda.Function(this, 'Encoder', {
      handler: 'index.encode',
      initialPolicy: [
        new iam.PolicyStatement({
          resources: [
            table.tableArn,
          ],
          actions: [
            'dynamodb:PutItem',
          ]
        }),
      ],
      ...lambdaProps,
    })

    const decoder = new lambda.Function(this, 'Decoder', {
      handler: 'index.decode',
      ...lambdaProps,
      initialPolicy: [
        new iam.PolicyStatement({
          resources: [
            table.tableArn,
          ],
          actions: [
            'dynamodb:GetItem',
          ]
        }),
      ],
    })

    const listener = alb.addListener('HTTPS', {
      port: 443,
      certificates: [
        cert,
      ],
      defaultAction: elb.ListenerAction.fixedResponse(400, {
        contentType: 'application/json',
        messageBody: JSON.stringify({err: 'only GET/POST accepted'}),
      })
    });

    listener.addTargets('Encoder', {
      targets: [
        new elbTargets.LambdaTarget(encoder),
      ],
      priority: 1,
      conditions: [
        elb.ListenerCondition.httpRequestMethods(['POST']),
      ]
    });

    listener.addTargets('Decoder', {
      targets: [
        new elbTargets.LambdaTarget(decoder),
      ],
      priority: 2,
      conditions: [
        elb.ListenerCondition.httpRequestMethods(['GET']),
      ]
    });
  }
}
