import { createRemoteJWKSet, jwtVerify, JWTVerifyResult, JWTPayload } from '/opt/nodejs/jose';
import { Context } from 'aws-lambda';

const USER_POOL_ID = process.env.USER_POOL_ID!;
const APP_CLIENT_ID = process.env.APP_CLIENT_ID!;

let isColdStart = true;
let keys: JWK[] = [];

interface JWK {
    kid: string;
    kty: string;
    alg: string;
    use: string;
    n: string;
    e: string;
}

interface APIGatewayEvent {
    authorizationToken: string;
    methodArn: string;
}

const decodeHeader = (token: string): { [key: string]: any } | null => {
    try {
        const parts = token.split('.');

        const header = parts[0];
        const base64 = header.replace(/-/g, '+').replace(/_/g, '/');

        const decoded = Buffer.from(base64, 'base64').toString('utf-8');

        return JSON.parse(decoded);
    } catch (error) {
        console.error('Invalid JWT header:', error);
        return null;
    }
};

const validateToken = async (token: string, region: string): Promise<JWTPayload | false> => {
    try {
        const keysUrl = `https://cognito-idp.${region}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`;

        // Load JWKS on cold start
        if (isColdStart) {
            const response = await fetch(keysUrl);
            const jwks = await response.json();
            keys = jwks.keys;
            isColdStart = false;
        }

        const unverifiedHeaders = decodeHeader(token);
        if (!unverifiedHeaders) {
            throw new Error('Failed to decode JWT header');
        }
        const kid = unverifiedHeaders.kid;

        const key = keys.find((key) => key.kid === kid);
        if (!key) {
            console.error('Public key not found in JWKS');
            return false;
        }

        // Verify the token signature using the key
        const JWKS = createRemoteJWKSet(new URL(keysUrl));
        const { payload }: JWTVerifyResult = await jwtVerify(token, JWKS, {
            audience: APP_CLIENT_ID, // Verify the audience
        });

        console.log('Signature successfully verified:', payload);

        const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
        if (payload.exp && currentTime > payload.exp) {
            console.error('Token is expired');
            return false;
        }

        if (payload.aud !== APP_CLIENT_ID) {
            console.error('Token was not issued for this audience');
            return false;
        }

        return payload;
    } catch (err: any) {
        console.error('Token validation failed:', err.message);
        return false;
    }
};

export const handler = async (event: APIGatewayEvent, context: Context) => {
    const tmp = event.methodArn.split(':');
    const apiGatewayArnTmp = tmp[5].split('/');
    const region = tmp[3];
    const awsAccountId = tmp[4];

    const validatedDecodedToken = await validateToken(event.authorizationToken, region);
    if (!validatedDecodedToken) {
        throw new Error('Unable to validate token');
    }

    const principalId = validatedDecodedToken['sub'] as string;

    const policy = new AuthPolicy(principalId, awsAccountId, {
        restApiId: apiGatewayArnTmp[0],
        region: region,
        stage: apiGatewayArnTmp[1],
    });

    // Allow all public resources/methods explicitly
    policy.allowMethod(AuthPolicy.HttpVerb.GET, `/users/${principalId}`);
    policy.allowMethod(AuthPolicy.HttpVerb.GET, `/tasks/myTasks`);
    policy.allowMethod(AuthPolicy.HttpVerb.PUT, '/tasks/complete');

    const response = { ...policy.build() };
    response.context = {
        email: validatedDecodedToken['email'],
    };

    return response;
};

interface ApiOptions {
    restApiId: string;
    region: string;
    stage: string;
}

interface Method {
    resourceArn: string;
    conditions: any;
}

interface Statement {
    Action: string;
    Effect: string;
    Resource: string[];
    Condition?: any;
}

interface PolicyDocument {
    Version: string;
    Statement: Statement[];
}

interface AuthResponse {
    principalId: string;
    policyDocument: PolicyDocument;
    context?: { [key: string]: any };
}

class AuthPolicy {
    public static HttpVerb = {
        GET: 'GET',
        POST: 'POST',
        PUT: 'PUT',
        PATCH: 'PATCH',
        HEAD: 'HEAD',
        DELETE: 'DELETE',
        OPTIONS: 'OPTIONS',
        ALL: '*',
    } as const;

    private awsAccountId: string;
    private principalId: string;
    private version = '2012-10-17';
    private pathRegex = new RegExp('^[/.a-zA-Z0-9-*]+$');
    private allowMethods: Method[] = [];
    private denyMethods: Method[] = [];
    private restApiId: string;
    private region: string;
    private stage: string;

    constructor(principal: string, awsAccountId: string, apiOptions: ApiOptions) {
        this.awsAccountId = awsAccountId;
        this.principalId = principal;
        this.restApiId = apiOptions.restApiId;
        this.region = apiOptions.region;
        this.stage = apiOptions.stage;
    }

    private addMethod(effect: string, verb: string, resource: string, conditions: any) {
        if (verb !== '*' && !Object.values(AuthPolicy.HttpVerb).includes(verb as any)) {
            throw new Error(`Invalid HTTP verb ${verb}. Allowed verbs in AuthPolicy.HttpVerb`);
        }

        if (!this.pathRegex.test(resource)) {
            throw new Error(`Invalid resource path: ${resource}. Path should match ${this.pathRegex}`);
        }

        let cleanedResource = resource;
        if (resource.startsWith('/')) {
            cleanedResource = resource.slice(1);
        }
        const resourceArn = `arn:aws:execute-api:${this.region}:${this.awsAccountId}:${this.restApiId}/${this.stage}/${verb}/${cleanedResource}`;

        const method: Method = {
            resourceArn,
            conditions,
        };

        if (effect.toLowerCase() === 'allow') {
            this.allowMethods.push(method);
        } else if (effect.toLowerCase() === 'deny') {
            this.denyMethods.push(method);
        }
    }

    public allowAllMethods() {
        this.addMethod('allow', '*', '*', null);
    }

    public denyAllMethods() {
        this.addMethod('deny', '*', '*', null);
    }

    public allowMethod(verb: string, resource: string) {
        this.addMethod('allow', verb, resource, null);
    }

    public denyMethod(verb: string, resource: string) {
        this.addMethod('deny', verb, resource, null);
    }

    public allowMethodWithConditions(verb: string, resource: string, conditions: any) {
        this.addMethod('allow', verb, resource, conditions);
    }

    public denyMethodWithConditions(verb: string, resource: string, conditions: any) {
        this.addMethod('deny', verb, resource, conditions);
    }

    private getEmptyStatement(effect: string): Statement {
        effect = effect.charAt(0).toUpperCase() + effect.slice(1).toLowerCase();
        const statement: Statement = {
            Action: 'execute-api:Invoke',
            Effect: effect,
            Resource: [],
        };

        return statement;
    }

    private getStatementsForEffect(effect: string, methods: Method[]): Statement[] {
        const statements: Statement[] = [];

        if (methods.length > 0) {
            const statement = this.getEmptyStatement(effect);

            for (const curMethod of methods) {
                if (!curMethod.conditions || Object.keys(curMethod.conditions).length === 0) {
                    statement.Resource.push(curMethod.resourceArn);
                } else {
                    const conditionalStatement = this.getEmptyStatement(effect);
                    conditionalStatement.Resource.push(curMethod.resourceArn);
                    conditionalStatement.Condition = curMethod.conditions;
                    statements.push(conditionalStatement);
                }
            }

            if (statement.Resource.length > 0) {
                statements.push(statement);
            }
        }

        return statements;
    }

    public build(): AuthResponse {
        if (this.allowMethods.length === 0 && this.denyMethods.length === 0) {
            throw new Error('No statements defined for the policy');
        }

        const policyDocument: PolicyDocument = {
            Version: this.version,
            Statement: [
                ...this.getStatementsForEffect('Allow', this.allowMethods),
                ...this.getStatementsForEffect('Deny', this.denyMethods),
            ],
        };

        return {
            principalId: this.principalId,
            policyDocument,
        };
    }
}
