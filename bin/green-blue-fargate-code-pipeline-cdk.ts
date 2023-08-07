#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GreenBlueFargateCodePipelineCdkStack } from '../lib/green-blue-fargate-code-pipeline-cdk-stack';

const app = new cdk.App();
new GreenBlueFargateCodePipelineCdkStack(app, 'GreenBlueFargateCodePipelineCdkStack', {
    certificateDomainNameParameterName: '/api/certificateDomainName',
    testCertificateDomainNameParameterName: '/api/testCertificateDomainName',
    hostedZoneIdParameterName: '/api/hostedZoneId',
    hostedZoneNameParameterName: '/api/hostedZoneName',
    aRecordNameParameterName: '/api/aRecordName',
    testARecordNameParameterName: '/api/testARecordName',
});
