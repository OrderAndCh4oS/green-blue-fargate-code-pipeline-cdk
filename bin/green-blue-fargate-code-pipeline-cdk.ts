#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import {GreenBlueFargateCodePipelineCdkStack} from '../lib/green-blue-fargate-code-pipeline-cdk-stack';
import {EcrStack} from "../lib/ecr-stack";
import {ARecordStack} from "../lib/a-record-stack";
import {GreenBlueFargateStack} from "../lib/green-blue-fargate-stack";
import {StackProps} from "aws-cdk-lib";
import {SslCertificateStack} from "../lib/ssl-certificate-stack";

export type CommonStackProps = {
    parameterNames: ParameterNames
} & StackProps;

export type ParameterNames = {
    ecrRepositoryArn: string,
    aRecordName: string;
    albArn: string;
    albCanonicalHostedZoneId: string,
    albDnsName: string,
    hostedZoneId: string;
    hostedZoneName: string;
    ecrPolicyStatement: string;
    certificateArn: string;
    certificateDomainName: string;
    ecsRoleArn: string;
    ecsArn: string;
    taskDefinitionArn: string;
    fargateServiceArn: string;
    blueTargetGroupArn: string;
    greenTargetGroupArn: string;
    listenerArn: string;
    testListenerArn: string;
    albSecurityGroupId: string;
}

const parameterNames: ParameterNames = {
    ecrRepositoryArn: '/api/repository-arn',
    ecrPolicyStatement: '/api/policy-statement',
    certificateDomainName: '/api/certificate-domain-name',
    certificateArn: '/api/certificate-arn',
    aRecordName: "/api/a-record-name",
    albArn: '/api/alb-arn',
    albCanonicalHostedZoneId: '/api/alb-canonical-hosted-zone-id',
    albDnsName: '/api/alb-dns-name',
    albSecurityGroupId: '/api/alb-sg-id',
    hostedZoneId: '/api/hosted-zone-id',
    hostedZoneName: '/api/hosted-zone-name',
    ecsRoleArn: '/api/ecs-role-arn',
    ecsArn: '/api/ecs-arn',
    taskDefinitionArn: '/api/task-definition-arn',
    fargateServiceArn: '/api/fargate-service-arn',
    blueTargetGroupArn: '/api/blue-target-group-arn',
    greenTargetGroupArn: '/api/green-target-group-arn',
    listenerArn: '/api/listener',
    testListenerArn: '/api/test-listener',
}

const app = new cdk.App();

const repositoryName = 'api-green-blue-repository'

new EcrStack(app, 'GreenBlueEcrStack', {
    repositoryName,
    parameterNames
})

new SslCertificateStack(app, 'GreenBlueSslCertificate', {
    parameterNames
})

new GreenBlueFargateStack(app, 'GreenBlueFargateStack', {
    repositoryName,
    parameterNames
})

new ARecordStack(app, 'GreenBlueARecordStack', {parameterNames});

new GreenBlueFargateCodePipelineCdkStack(app, 'GreenBlueFargateCodePipelineCdkStack', {
    repositoryName,
    parameterNames
});

