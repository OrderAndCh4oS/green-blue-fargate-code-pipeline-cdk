import {Duration, RemovalPolicy, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Port, SecurityGroup, Vpc} from "aws-cdk-lib/aws-ec2";
import {
    AppProtocol,
    AwsLogDriver,
    Cluster,
    ContainerImage,
    DeploymentControllerType,
    FargateService,
    FargateTaskDefinition,
    Protocol
} from "aws-cdk-lib/aws-ecs";
import {Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {LogGroup} from "aws-cdk-lib/aws-logs";
import {ApplicationLoadBalancer, ApplicationProtocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {CommonStackProps} from "../bin/green-blue-fargate-code-pipeline-cdk";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {Repository} from "aws-cdk-lib/aws-ecr";
import {Certificate} from "aws-cdk-lib/aws-certificatemanager";

export class GreenBlueFargateStack extends Stack {
    constructor(scope: Construct, id: string, props: { repositoryName: string } & CommonStackProps) {
        super(scope, id, props);

        const ecrRepository = Repository.fromRepositoryName(this, 'GreenBlueEcrRepository', props.repositoryName)
        const image = ContainerImage.fromEcrRepository(ecrRepository, "latest");

        const certificateArnParameter = StringParameter.fromStringParameterName(this, 'CertificateArnParameter', props.parameterNames.certificateArn);
        const certificate = Certificate.fromCertificateArn(this, 'CertificateArn', certificateArnParameter.stringValue)

        const ecsRole = new Role(this, `EcsRole`, {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
        });

        new StringParameter(this, 'EcsRoleArn', {
            parameterName: props.parameterNames.ecsRoleArn,
            stringValue: ecsRole.roleArn
        });

        const vpc = new Vpc(this, `api-blue-green-vpc`, {
            natGateways: 1,
            maxAzs: 2,
        });

        const albSecurityGroup = new SecurityGroup(this, 'ALBSecurityGroup', {
            vpc,
            allowAllOutbound: true,
        });

        new StringParameter(this, 'AlbSecurityGroupArn', {
            parameterName: props.parameterNames.albSecurityGroupId,
            stringValue:  albSecurityGroup.securityGroupId
        });

        albSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(80), 'Allow HTTP traffic');
        albSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(443), 'Allow HTTPS traffic');
        albSecurityGroup.addIngressRule(albSecurityGroup, Port.tcp(8080), 'Allow port 8080 traffic');

        const alb = new ApplicationLoadBalancer(this, `api-blue-green-alb`, {
            loadBalancerName: 'ecs-fargate-blue-green',
            vpc,
            internetFacing: true,
            securityGroup: albSecurityGroup, // Attach the security group
        });

        new StringParameter(this, 'ApplicationLoadBalancerArn', {
            parameterName: props.parameterNames.albArn,
            stringValue:  alb.loadBalancerArn
        });

        new StringParameter(this, 'AlbDnsNameParameter', {
            parameterName: props.parameterNames.albDnsName,
            stringValue: alb.loadBalancerDnsName,
        });

        new StringParameter(this, 'AlbCanonicalHostedZoneIdParameter', {
            parameterName: props.parameterNames.albCanonicalHostedZoneId,
            stringValue: alb.loadBalancerCanonicalHostedZoneId,
        });

        const ecs = new Cluster(this, `api-blue-green-cluster`, {
            vpc,
        });

        new StringParameter(this, 'EcsArnParameter', {
            parameterName: props.parameterNames.ecsArn,
            stringValue: ecs.clusterArn,
        });

        const taskDefinition = new FargateTaskDefinition(this, `api-blue-green-fargate-task-definition`, {
            executionRole: ecsRole,
            taskRole: ecsRole,
            cpu: 256,
            memoryLimitMiB: 512,
        });

        taskDefinition.addContainer(`api-blue-green-container`, {
            image,
            portMappings: [
                {
                    containerPort: 80,
                    protocol: Protocol.TCP,
                    name: 'ecs-container-80-tcp',
                    appProtocol: AppProtocol.http
                },
            ],
            memoryLimitMiB: 512,
            logging: new AwsLogDriver({
                logGroup: new LogGroup(this, `api-blue-green-fargate-task-definition-log-group`, {
                    logGroupName: `/ecs/api-blue-green-fargate-task-definition-log-group`,
                    removalPolicy: RemovalPolicy.DESTROY
                }),
                streamPrefix: 'ApiDeployBlueGreenLogStream'
            })
        });

        new StringParameter(this, 'TaskDefinitionArn', {
            parameterName: props.parameterNames.taskDefinitionArn,
            stringValue:  taskDefinition.taskDefinitionArn
        });

        const fargateSg = new SecurityGroup(this, `api-blue-green-fargate-sg`, {
            securityGroupName: `api-blue-green-fargate`,
            vpc,
        });

        const fargate = new FargateService(this, `api-blue-green-fargate-service`, {
            serviceName: `api-blue-green-fargate-service`,
            taskDefinition,
            desiredCount: 1,
            cluster: ecs,
            securityGroups: [fargateSg],
            deploymentController: {
                type: DeploymentControllerType.CODE_DEPLOY
            },
            capacityProviderStrategies: [
                {capacityProvider: 'FARGATE_SPOT', weight: 1}
            ]
        });

        new StringParameter(this, 'FargateServiceArn', {
            parameterName: props.parameterNames.fargateServiceArn,
            stringValue:  fargate.serviceArn
        });

        const listener = alb.addListener(`api-blue-green-prod-listener`, {
            port: 443,
            certificates: [certificate],
            open: true,
        });

        const testListener = alb.addListener(`api-blue-green-test-listener`, {
            port: 8080,
            open: true,
        });

        const blueTargetGroup = listener.addTargets(`api-blue-green-blue-target-group`, {
            targetGroupName: `blue-target-group`,
            protocol: ApplicationProtocol.HTTP,
            healthCheck: {path: '/', interval: Duration.seconds(30),},
            targets: [fargate],
        });

        const greenTargetGroup = testListener.addTargets(`api-blue-green-target-80`, {
            targetGroupName: `green-target-group`,
            protocol: ApplicationProtocol.HTTP,
            healthCheck: {path: '/', interval: Duration.seconds(30),},
            targets: [fargate],
        });

        new StringParameter(this, 'ListenerArn', {
            parameterName: props.parameterNames.listenerArn,
            stringValue: listener.listenerArn
        })

        new StringParameter(this, 'TestListenerArn', {
            parameterName: props.parameterNames.testListenerArn,
            stringValue: testListener.listenerArn
        });

        new StringParameter(this, 'BlueTargetGroupArn', {
            parameterName: props.parameterNames.blueTargetGroupArn,
            stringValue: blueTargetGroup.targetGroupArn
        });

        new StringParameter(this, 'GreenTargetGroupArn', {
            parameterName: props.parameterNames.greenTargetGroupArn,
            stringValue: greenTargetGroup.targetGroupArn
        });

        const ecrPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', // Todo: figure out what permissions are actually required
            ],
            resources: ['*'], // Todo: try setting ecrRepositoryArn as resource
        });

        fargate.taskDefinition.addToExecutionRolePolicy(ecrPolicyStatement);
    }
}
