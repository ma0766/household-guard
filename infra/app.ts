import { AccountRecovery, Mfa, OAuthScope, ResourceServerScope, UserPool, CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
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
  constructor(scope: Construct, id: string, props: StackProps & { suffix: string }) {
    super(scope, id, props);
    // one table, key prefixes; TTL expires sessions, approvals and audit entries
    const table = new Table(this, 'Table', {
      tableName: `household-guard${props.suffix}`, // each stage has its own table: the submission stage is never touched by roadmap work
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const secret = process.env.HG_TOKEN_SECRET;
    if (!secret) throw new Error('HG_TOKEN_SECRET is required — run npm run deploy');
    const queue = new Queue(this, 'Jobs', { visibilityTimeout: Duration.seconds(60) });

    // ---- sign-in (S12): Amazon Cognito as the OAuth 2.1 server (authorization code + PKCE, refresh tokens, client_credentials) ----
    const isProd = props.suffix === '';
    const ctx = (k: string) => (this.node.tryGetContext(k) ? String(this.node.tryGetContext(k)) : undefined);
    const webUrl = ctx('webUrl')?.replace(/\/$/, ''); // the Function URL, known after the first deploy (deploy.ts runs the second pass)
    const pool = new UserPool(this, 'Users', {
      selfSignUpEnabled: false, // people are added by an adult, never by themselves
      signInAliases: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      passwordPolicy: { minLength: 12, requireDigits: true, requireLowercase: true, requireUppercase: true, requireSymbols: false },
      mfa: Mfa.OPTIONAL, // a family member can add an authenticator app
      mfaSecondFactor: { otp: true, sms: false },
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY, // the submitted stage keeps its users on a rollback
    });
    const mcpScope = new ResourceServerScope({ scopeName: 'mcp', scopeDescription: 'Use the house through Alexa' });
    const resource = pool.addResourceServer('Api', { identifier: 'hg', scopes: [mcpScope] });
    const alexaVendor = ctx('alexaVendorId'); // Amazon gives this when the add-on is registered; the three Alexa redirect addresses are added then
    const callbacks = [...(webUrl ? [`${webUrl}/`] : ['https://example.invalid/']), ...(isProd ? [] : ['http://localhost:8016/']), ...(alexaVendor ? ['pitangui.amazon.com', 'layla.amazon.com', 'alexa.amazon.co.jp'].map((h) => `https://${h}/api/skill/link/${alexaVendor}`) : [])];
    const userPasswordAuth = ctx('userPasswordAuth') ? ctx('userPasswordAuth') === '1' : !isProd;
    const webClient = pool.addClient('Web', {
      generateSecret: false, // a public client: PKCE proves the caller, not a secret
      authFlows: { userPassword: userPasswordAuth }, // only the smoke test uses this: on for sandbox stages, off for the submitted one (override with -c userPasswordAuth=1|0)
      oAuth: { flows: { authorizationCodeGrant: true }, scopes: [OAuthScope.OPENID, OAuthScope.resourceServer(resource, mcpScope)], callbackUrls: callbacks, logoutUrls: callbacks },
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });
    const serviceClient = pool.addClient('Service', {
      generateSecret: true, // client_credentials for service-level calls
      oAuth: { flows: { clientCredentials: true }, scopes: [OAuthScope.resourceServer(resource, mcpScope)] },
      accessTokenValidity: Duration.hours(1),
    });
    const domain = pool.addDomain('Domain', { cognitoDomain: { domainPrefix: `hg-${props.suffix.replace('-', '') || 'prod'}-${Stack.of(this).account}` } });
    new CfnUserPoolGroup(this, 'DemoFamily', { userPoolId: pool.userPoolId, groupName: 'hh-demo', description: 'The demo household' });
    const hosted = `https://${domain.domainName}.auth.us-east-1.amazoncognito.com`;
    const signInEnv: Record<string, string> = {
      HG_OIDC_ISSUER: `https://cognito-idp.us-east-1.amazonaws.com/${pool.userPoolId}`,
      HG_OIDC_CLIENT_IDS: webClient.userPoolClientId,
      HG_OIDC_SERVICE_CLIENT_ID: serviceClient.userPoolClientId,
      HG_SERVICE_HOUSEHOLD: 'service',
      HG_OIDC_AUTHORIZE_URL: `${hosted}/oauth2/authorize`,
      HG_OIDC_TOKEN_URL: `${hosted}/oauth2/token`,
      HG_OIDC_WEB_CLIENT_ID: webClient.userPoolClientId,
      ...(userPasswordAuth ? { HG_OIDC_ALLOW_DIRECT: '1' } : {}), // direct-login keys (the smoke test) are taken only where that login is switched on
    };
    // adults hear about held requests by email (Amazon SES). The sender address must be verified in SES first; without one, no email is sent.
    const emailFrom = ctx('emailFrom');
    const emailEnv: Record<string, string> = {
      ...(webUrl ? { HG_PUBLIC_URL: webUrl } : {}),
      ...(emailFrom ? { HG_EMAIL_FROM: emailFrom } : {}),
      ...(ctx('approverEmail') ? { HG_APPROVER_EMAILS: JSON.stringify({ mom: ctx('approverEmail') }), HG_APPROVER_HOUSEHOLD: ctx('approverHousehold') ?? 'demo' } : {}),
    };
    // SES: only from the verified address (or its domain), and only that address
    const sesPolicy = emailFrom ? new PolicyStatement({ actions: ['ses:SendEmail'], resources: [`arn:aws:ses:us-east-1:${Stack.of(this).account}:identity/${emailFrom}`, ...(emailFrom.includes('@') ? [`arn:aws:ses:us-east-1:${Stack.of(this).account}:identity/${emailFrom.split('@')[1]}`] : [])], conditions: { StringEquals: { 'ses:FromAddress': emailFrom } } }) : undefined;

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
        HG_DEMO: (ctx('demo') ?? (isProd ? '1' : '0')) === '1' ? '1' : '0', // the open demo sign-in: on for the submitted stage, off elsewhere unless -c demo=1
        ...signInEnv,
        ...emailEnv,
      },
    });
    if (sesPolicy) web.addToRolePolicy(sesPolicy);
    table.grantReadWriteData(web);
    queue.grantSendMessages(web);
    const worker = new Fn(this, 'Worker', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromAsset('dist/worker'),
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: { HG_TABLE: table.tableName, HG_RISK: 'bedrock', HG_TOKEN_SECRET: secret, ...emailEnv }, // the worker can hold a request too (price changed): the link in that email needs the same signing key
    });
    if (sesPolicy) worker.addToRolePolicy(sesPolicy);
    // the risk check calls Claude Haiku on Amazon Bedrock (us-east-1)
    worker.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:Converse'], resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*', 'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-*'] }));
    table.grantReadWriteData(worker);
    worker.addEventSource(new SqsEventSource(queue, { batchSize: 5 }));
    // self-healing: every 5 minutes a safe read of each service; a model proposes a repair only if the answer stopped fitting
    const heal = new Fn(this, 'Heal', {
      runtime: Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: Code.fromAsset('dist/heal'),
      memorySize: 256,
      timeout: Duration.minutes(5), // households are checked five at a time; a model repair can take 20 seconds
      environment: { HG_TABLE: table.tableName },
    });
    heal.addToRolePolicy(new PolicyStatement({ actions: ['bedrock:InvokeModel', 'bedrock:Converse'], resources: ['arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*', 'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-4-5-*'] }));
    table.grantReadWriteData(heal);
    new Rule(this, 'HealEvery5Minutes', { schedule: Schedule.rate(Duration.minutes(5)), targets: [new LambdaFunction(heal, { retryAttempts: 0 })] });
    const url = web.addFunctionUrl({ authType: FunctionUrlAuthType.NONE, invokeMode: InvokeMode.RESPONSE_STREAM });
    new CfnOutput(this, 'Url', { value: url.url });
    new CfnOutput(this, 'UserPoolId', { value: pool.userPoolId });
    new CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId });
    new CfnOutput(this, 'ServiceClientId', { value: serviceClient.userPoolClientId });
    new CfnOutput(this, 'SignInDomain', { value: hosted });
  }
}

const app = new App();
// Stages: 'prod' is the submitted entry (stack HouseholdGuard). Anything else (default for roadmap work: 'roadmap') is a
// separate stack with its own table, queue, functions and URL: HouseholdGuard-<stage>.
const stage = String(app.node.tryGetContext('stage') ?? 'roadmap'); // a plain `cdk deploy` must never touch the submitted stage: prod needs -c stage=prod
if (!/^[a-z][a-z0-9]{0,14}$/.test(stage)) throw new Error('stage must be short lowercase letters and digits');
const suffix = stage === 'prod' ? '' : `-${stage}`;
new HouseholdGuardStack(app, `HouseholdGuard${suffix}`, { suffix, env: { region: 'us-east-1', account: process.env.CDK_DEFAULT_ACCOUNT } });
