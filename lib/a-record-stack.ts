import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {ApplicationLoadBalancer} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {LoadBalancerTarget} from "aws-cdk-lib/aws-route53-targets";
import {CommonStackProps} from "../bin/green-blue-fargate-code-pipeline-cdk";

export class ARecordStack extends Stack {
    constructor(scope: Construct, id: string, props: CommonStackProps) {
        super(scope, id, props);

        const hostedZoneId = StringParameter.fromStringParameterName(this, 'HostedZoneId', props.parameterNames.hostedZoneId);
        const hostedZoneName = StringParameter.fromStringParameterName(this, 'HostedZoneName', props.parameterNames.hostedZoneName);
        const albArn = StringParameter.fromStringParameterName(this, 'LoadBalancerArn', props.parameterNames.albArn);
        const albCanonicalHostedZoneId = StringParameter.fromStringParameterName(this, 'AlbCanonicalHostedZoneId', props.parameterNames.albCanonicalHostedZoneId);
        const albDnsName = StringParameter.fromStringParameterName(this, 'AlbDnsName', props.parameterNames.albDnsName);
        const albSecurityGroupId = StringParameter.fromStringParameterName(this, 'AlbSecurityGroupId', props.parameterNames.albSecurityGroupId);
        const aRecordName = StringParameter.fromStringParameterName(this, 'ARecordName', props.parameterNames.aRecordName);

        const zone = HostedZone.fromHostedZoneAttributes(
            this,
            "HttpsFargateAlbPublicZone",
            {
                zoneName: hostedZoneName.stringValue,
                hostedZoneId: hostedZoneId.stringValue,
            }
        );

        const alb = ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'MyALB', {
            loadBalancerArn: albArn.stringValue,
            securityGroupId: albSecurityGroupId.stringValue,
            loadBalancerCanonicalHostedZoneId: albCanonicalHostedZoneId.stringValue,
            loadBalancerDnsName: albDnsName.stringValue,
        });

        new ARecord(this, "ApiHttpsFargateAlbARecord", {
            zone,
            recordName: aRecordName.stringValue,
            target: RecordTarget.fromAlias(new LoadBalancerTarget(alb)),
        });
    }
}
