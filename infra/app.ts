import { App, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Code, Function as Fn, FunctionUrlAuthType, InvokeMode, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { Construct } from 'constructs';

// Lambda Web Adapter layer — version from the adapter's README (checked 2026-10-20)
const LWA_LAYER = 'arn:aws:lambda:us-east-1:753240598075:layer:LambdaAdapterLayerX86:30';

class HouseholdGuardStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    // one table, key prefixes; TTL expires sessions, approvals and audit entries
    const table = new Table(this, 'Table', {
      tableName: 'household-guard',
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const secret = process.env.HG_TOKEN_SECRET;
    if (!secret) throw new Error('HG_TOKEN_SECRET is required — run npm run deploy');
    const queue = new Queue(this, 'Jobs', { visibilityTimeout: Duration.seconds(60) });

    const web = new Fn(this, 'Web', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'run.sh',
      code: Code.fromAsset('dist/lambda'),
      layers: [LayerVersion.fromLayerVersionArn(this, 'Lwa', LWA_LAYER)],
      memorySize: 512,
      timeout: Duration.seconds(29),
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: '/opt/bootstrap',
        AWS_LWA_INVOKE_MODE: 'response_stream',
        PORT: '8080',
        HG_HOST: '0.0.0.0',
        HG_WEB_ROOT: '/var/task/web',
        HG_TABLE: table.tableName,
        HG_QUEUE_URL: queue.queueUrl,
        HG_TOKEN_SECRET: secret,
        // demo-token endpoint so the hosted web client can sign in. It hands out tokens to anyone: deploy with `-c demo=0` after judging.
        HG_DEMO: this.node.tryGetContext('demo') === '0' ? '0' : '1',
      },
    });
    table.grantReadWriteData(web);
    queue.grantSendMessages(web);
    const worker = new Fn(this, 'Worker', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromAsset('dist/worker'),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: { HG_TABLE: table.tableName, HG_RISK: 'bedrock' },
    });
    // the risk check calls Claude Haiku on Amazon Bedrock (us-east-1)
    worker.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:Converse'], resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*', 'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-*'] }));
    table.grantReadWriteData(worker);
    worker.addEventSource(new SqsEventSource(queue, { batchSize: 5 }));
    const url = web.addFunctionUrl({ authType: FunctionUrlAuthType.NONE, invokeMode: InvokeMode.RESPONSE_STREAM });
    new CfnOutput(this, 'Url', { value: url.url });
  }
}

const app = new App();
new HouseholdGuardStack(app, 'HouseholdGuard', { env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT } });
