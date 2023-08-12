import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {HostedZone} from "aws-cdk-lib/aws-route53";
import {Certificate, CertificateValidation} from 'aws-cdk-lib/aws-certificatemanager';
import {CommonStackProps} from "../bin/green-blue-fargate-code-pipeline-cdk";


export class SslCertificateStack extends Stack {
    constructor(scope: Construct, id: string, props: CommonStackProps) {
        super(scope, id, props);

        const certificateDomainName = StringParameter.fromStringParameterName(this, 'CertificateDomainName', props.parameterNames.certificateDomainName);
        const hostedZoneId = StringParameter.fromStringParameterName(this, 'HostedZoneId', props.parameterNames.hostedZoneId);
        const hostedZoneName = StringParameter.fromStringParameterName(this, 'HostedZoneName', props.parameterNames.hostedZoneName);

        const publicZone = HostedZone.fromHostedZoneAttributes(
            this,
            "HttpsFargateAlbPublicZone",
            {
                zoneName: hostedZoneName.stringValue,
                hostedZoneId: hostedZoneId.stringValue,
            }
        );

        const certificate = new Certificate(this, 'BlueCertificate', {
            domainName: certificateDomainName.stringValue,
            validation: CertificateValidation.fromDns(publicZone),
        });

        new StringParameter(this, 'CertificateArn', {
            parameterName: props.parameterNames.certificateArn,
            stringValue: certificate.certificateArn
        });
    }
}
