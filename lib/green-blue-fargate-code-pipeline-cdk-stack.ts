import {Duration, RemovalPolicy, SecretValue, Stack, StackProps} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {SecurityGroup, Vpc} from "aws-cdk-lib/aws-ec2";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
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
import {LoadBalancerTarget} from "aws-cdk-lib/aws-route53-targets";
import {Artifact, Pipeline} from "aws-cdk-lib/aws-codepipeline";
import {BuildSpec, LinuxBuildImage, PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {CodeBuildAction, CodeDeployEcsDeployAction, GitHubSourceAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {IRepository, Repository} from "aws-cdk-lib/aws-ecr";
import {EcsApplication, EcsDeploymentConfig, EcsDeploymentGroup} from "aws-cdk-lib/aws-codedeploy";
import {Certificate, CertificateValidation} from 'aws-cdk-lib/aws-certificatemanager';

export type CdkStackProps = {
    certificateDomainNameParameterName: string;
    testCertificateDomainNameParameterName: string;
    hostedZoneIdParameterName: string;
    hostedZoneNameParameterName: string;
    aRecordNameParameterName: string;
    testARecordNameParameterName: string;
} & StackProps;

export class GreenBlueFargateCodePipelineCdkStack extends Stack {
    constructor(scope: Construct, id: string, props: CdkStackProps) {
        super(scope, id, props);

        const certificateDomainName = StringParameter.fromStringParameterName(this, 'CertificateDomainName', props.certificateDomainNameParameterName);
        // const testCertificateDomainName = StringParameter.fromStringParameterName(this, 'TestCertificateDomainName', props.certificateDomainNameParameterName);
        const hostedZoneId = StringParameter.fromStringParameterName(this, 'HostedZoneId', props.hostedZoneIdParameterName);
        const hostedZoneName = StringParameter.fromStringParameterName(this, 'HostedZoneName', props.hostedZoneNameParameterName);
        const aRecordName = StringParameter.fromStringParameterName(this, 'ARecordName', props.aRecordNameParameterName);
        // const testARecordName = StringParameter.fromStringParameterName(this, 'TestARecordName', props.aRecordNameParameterName);

        const ecrRepository: IRepository = new Repository(this, "ApiECRRepository", {
            repositoryName: "api-code-pipeline-bg-images"
        });

        const ecrPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', // Todo: figure out what permissions are actually required
            ],
            resources: ['*'],
        });

        const publicZone = HostedZone.fromHostedZoneAttributes(
            this,
            "HttpsFargateAlbPublicZone",
            {
                zoneName: hostedZoneName.stringValue,
                hostedZoneId: hostedZoneId.stringValue,
            }
        );

        const blueCertificate = new Certificate(this, 'BlueCertificate', {
            domainName: certificateDomainName.stringValue, // Use the same domain as mainCertificate
            validation: CertificateValidation.fromDns(publicZone),
        });

        const image = ContainerImage.fromEcrRepository(ecrRepository, "latest");

        const ecsRole = new Role(this, `EcsRole`, {
            assumedBy: new ServicePrincipal('ecs-tasks.amazonaws.com'),
            managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')],
        });

        const vpc = new Vpc(this, `api-blue-green-vpc`, {
            natGateways: 1,
            maxAzs: 2,
        });

        const alb = new ApplicationLoadBalancer(this, `api-blue-green-alb`, {
            loadBalancerName: 'ecs-fargate-blue-green',
            vpc,
            internetFacing: true,
        });

        const ecs = new Cluster(this, `api-blue-green-cluster`, {
            vpc,
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

        const listener = alb.addListener(`api-blue-green-prod-listener`, {
            port: 443,
            certificates: [blueCertificate],
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

        fargate.taskDefinition.addToExecutionRolePolicy(ecrPolicyStatement);

        new ARecord(this, "ApiHttpsFargateAlbARecord", {
            zone: publicZone,
            recordName: aRecordName.stringValue,
            target: RecordTarget.fromAlias(
                new LoadBalancerTarget(alb)
            ),
        });

        // +++++++++++++++++++++++++++++++++++++

        // Todo: make these variables or aws params with the names as variables
        const repositoryOwner = 'OrderAndCh4oS';
        const repositoryName = 'python-fastapi-docker';
        const branchName = 'main';

        // Create the IAM policy statement
        const secretAccessPolicyStatement = new PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
                'arn:aws:secretsmanager:eu-west-1:914698808609:secret:GitHubAccessToken-FELixh',
            ],
        });

        const taskdef = {
            family: "api-blue-green-fargate-task-definition",
            executionRoleArn: ecsRole.roleArn,
            taskRoleArn: ecsRole.roleArn,
            containerDefinitions: [
                {
                    name: "api-blue-green-container",
                    image: ecrRepository.repositoryUri,
                    cpu: 256,
                    memory: 512,
                    essential: true,
                    portMappings: [
                        {
                            containerPort: 80,
                            protocol: "tcp",
                            name: "ecs-container-80-tcp",
                            appProtocol: "http"
                        }
                    ],
                    logConfiguration: {
                        logDriver: "awslogs",
                        options: {
                            "awslogs-group": "/ecs/api-blue-green-fargate-task-definition-log-group",
                            "awslogs-stream-prefix": "ApiDeployBlueGreenLogStream",
                            "awslogs-region": "eu-west-1"
                        }
                    }
                }
            ]
        }

        const appspec = {
            version: "0.0",
            Resources: [
                {
                    TargetService: {
                        Type: "AWS::ECS::Service",
                        Properties: {
                            TaskDefinition: taskDefinition.taskDefinitionArn,
                            LoadBalancerInfo: {
                                ContainerName: "api-blue-green-container",
                                ContainerPort: 80
                            },
                            PlatformVersion: "LATEST"
                        }
                    }
                }
            ]
        }

        const buildProject = new PipelineProject(this, 'ApiDeploymentBuildProject', {
            buildSpec: BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'export AWS_ECR_LOGIN=$(aws ecr get-login-password --region eu-west-1)', // Todo: make region a variable
                            `echo $AWS_ECR_LOGIN | docker login --username AWS --password-stdin ${ecrRepository.repositoryUri}`,
                        ]
                    },
                    build: {
                        commands: [
                            `docker build -t ${ecrRepository.repositoryUri}:latest .`,
                        ],
                    },
                    post_build: {
                        commands: [
                            `docker push ${ecrRepository.repositoryUri}:latest`,
                            `echo Container image to be used ${ecrRepository.repositoryUri}:latest`,
                            `echo '${JSON.stringify(taskdef)}' > taskdef.json`,
                            `echo '${JSON.stringify(appspec)}' > appspec.json`,
                            "cat taskdef.json",
                            "cat appspec.json",
                        ],
                    },
                },
                artifacts: {
                    files: [
                        "appspec.json",
                        "taskdef.json"
                    ],
                },
            }),
            environment: {
                buildImage: LinuxBuildImage.STANDARD_7_0,
                privileged: true
            },
        });

        const pipeline = new Pipeline(this, 'ApiDeploymentPipeline', {
            pipelineName: 'ApiDeploymentPipeline',
            crossAccountKeys: false,
        });

        const sourceStage = pipeline.addStage({stageName: 'Source'});
        const githubSourceOutput = new Artifact('GitHubSourceOutput');

        sourceStage.addAction(
            new GitHubSourceAction({
                actionName: 'GitHubSource',
                owner: repositoryOwner,
                repo: repositoryName,
                branch: branchName,
                oauthToken: SecretValue.secretsManager('GitHubAccessToken'), // Todo: should use a dedicated github account for this token, ie not a personal account
                output: githubSourceOutput,
            })
        );

        const buildStage = pipeline.addStage({stageName: 'Build'});
        const buildStageOutput = new Artifact('BuildOutput')
        buildStage.addAction(
            new CodeBuildAction({
                actionName: 'CodeBuild',
                project: buildProject,
                input: githubSourceOutput,
                outputs: [buildStageOutput],
            })
        );

        const ecsDeploymentGp = new EcsDeploymentGroup(this, `ApiBlueGreenEcsDeploymentGroup`, {
            deploymentGroupName: 'ApiBlueGreen',
            deploymentConfig: EcsDeploymentConfig.LINEAR_10PERCENT_EVERY_1MINUTES,
            application: new EcsApplication(this, `ecs-application`),
            service: fargate,
            blueGreenDeploymentConfig: {
                blueTargetGroup,
                greenTargetGroup,
                listener,
                testListener,
            },
        });

        pipeline.addStage({
            stageName: 'Deploy',
            actions: [
                new CodeDeployEcsDeployAction({
                    actionName: 'Deploy',
                    deploymentGroup: ecsDeploymentGp,
                    taskDefinitionTemplateFile: buildStageOutput.atPath('taskdef.json'),
                    appSpecTemplateFile: buildStageOutput.atPath('appspec.json'),
                })
            ]
        })

        const buildProjectRole = buildProject.role as Role;
        buildProjectRole.addToPolicy(ecrPolicyStatement);

        const pipelineRole = pipeline.role as Role;
        pipelineRole.addToPolicy(secretAccessPolicyStatement);
    }
}
