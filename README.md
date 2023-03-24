TinyURL
=======

This is a small service that does what it says on the tin: turns a full url into a shortened form and turns the
shortened form back into the original. GET requests are cached behind CloudFront for performance.

Building
--------
```shell
npm install
npm run build
```

Deploying
--------
1. Make sure you built (above)
2. Setup some AWS credentials.
3. Deploy.
```shell
npm --prefix cdk install
npm --prefix cdk run cdk -- deploy --all
```

Usage
-----
```shell
% curl {Outputs.TinyURLStack.ExportDomainName} --data '{"url": "https://www.example.com"}'
{"shortlink":"{Outputs.TinyURLStack.ExportDomainName}/1r4hqlr"}

% curl -s --location {Outputs.TinyURLStack.ExportDomainName}/1r4hqlr -H'Content-Type: application/json' | grep title
    <title>Example Domain</title>
```

If this is your first deploy, you'll have to delegate 2 DNS records to Route53. You won't be able to do this in advance
because the records contain the stack IDs. Optionally, the certificate validations can be removed from the CDK so that
you can get the DNS name prior to the certificate validation starting.

Operations
----------
1. This infrastructure should handle about 1000 unique requests per second. Higher than this would require an AWS
   Support request to increase Lambda concurrency to the desired amount. Note that GET requests are cached for an hour
   and CloudFront can supply 250,000 requests per second so getting already POSTed urls allow for a considerably higher
   throughput.
2. At low throughput, pay-per-use Dynamo is cheap (free, actually, if there are no requests). This service uses
   pay-per-use Dynamo. At scale, however, provisioned saves costs.
3. Protecting POST actions could be done in a number of ways. An IDP (identity provider) could be integrated with the
   ALB (good), or static API keys could be used (not great), or an API Gateway could be put in front (ok but probably
   overkill for this.) API Gateway supports a lot of functionality (including auth caching, etc) but tends to be more
   expensive to run and more opinionated about what endpoints look like.
