import {SecretValue, Stack, StackProps} from 'aws-cdk-lib';
import {Certificate, CertificateValidation} from 'aws-cdk-lib/aws-certificatemanager';
import {Construct} from 'constructs';
import {SubnetType, Vpc} from "aws-cdk-lib/aws-ec2";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {ARecord, HostedZone, RecordTarget} from "aws-cdk-lib/aws-route53";
import {Cluster, ContainerImage, DeploymentControllerType, LogDrivers} from "aws-cdk-lib/aws-ecs";
import {Effect, PolicyStatement, Role} from "aws-cdk-lib/aws-iam";
import {ApplicationLoadBalancedFargateService} from "aws-cdk-lib/aws-ecs-patterns";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {ApplicationProtocol} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {LoadBalancerTarget} from "aws-cdk-lib/aws-route53-targets";
import {Artifact, Pipeline} from "aws-cdk-lib/aws-codepipeline";
import {BuildSpec, LinuxBuildImage, PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {CodeBuildAction, EcsDeployAction, GitHubSourceAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {IRepository, Repository} from "aws-cdk-lib/aws-ecr";

export type CdkStackProps = {
    certificateDomainNameParameterName: string;
    hostedZoneIdParameterName: string;
    hostedZoneNameParameterName: string;
    aRecordNameParameterName: string;
} & StackProps;

export class GreenBlueFargateCodePipelineCdkStack extends Stack {
    constructor(scope: Construct, id: string, props: CdkStackProps) {
        super(scope, id, props);

        const certificateDomainName = StringParameter.fromStringParameterName(this, 'CertificateDomainName', props.certificateDomainNameParameterName);
        const hostedZoneId = StringParameter.fromStringParameterName(this, 'HostedZoneId', props.hostedZoneIdParameterName);
        const hostedZoneName = StringParameter.fromStringParameterName(this, 'HostedZoneName', props.hostedZoneNameParameterName);
        const aRecordName = StringParameter.fromStringParameterName(this, 'ARecordName', props.aRecordNameParameterName);

        const ecrRepository: IRepository = new Repository(this, "ApiECRRepository", {
            repositoryName: "api-code-pipeline-images", // Replace with your desired repository name
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

        const certificate = new Certificate(this, "ApiHttpsFargateAlbCertificate", {
            domainName: certificateDomainName.stringValue,
            validation: CertificateValidation.fromDns(publicZone),
        });


        const vpc = new Vpc(this, "ApiVpc", {
            natGateways: 1,
            subnetConfiguration: [
                {cidrMask: 24, subnetType: SubnetType.PUBLIC, name: "Public"},
                {cidrMask: 24, subnetType: SubnetType.PRIVATE_WITH_EGRESS, name: "Private"}
            ],
            maxAzs: 3
        });

        const cluster = new Cluster(this, 'ApiCluster', {
            vpc,
            containerInsights: true
        });

        const image = ContainerImage.fromEcrRepository(ecrRepository, "latest");

        const fargate = new ApplicationLoadBalancedFargateService(this, 'ApiAlbFargate', {
            cluster,
            taskImageOptions: {
                image,
                containerPort: 80,
                logDriver: LogDrivers.awsLogs({
                    streamPrefix: id,
                    logRetention: RetentionDays.ONE_MONTH,
                }),
            },
            assignPublicIp: true,
            memoryLimitMiB: 512,
            cpu: 256,
            desiredCount: 1,
            deploymentController: {type: DeploymentControllerType.ECS},
            protocol: ApplicationProtocol.HTTPS,
            certificate,
            redirectHTTP: true,
        });

        fargate.taskDefinition.addToExecutionRolePolicy(ecrPolicyStatement);

        new ARecord(this, "ApiHttpsFargateAlbARecord", {
            zone: publicZone,
            recordName: aRecordName.stringValue,
            target: RecordTarget.fromAlias(
                new LoadBalancerTarget(fargate.loadBalancer)
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
                            `docker push ${ecrRepository.repositoryUri}:latest`,
                        ],
                    },
                    post_build: {
                        commands: [
                            // Prepare the image definitions artifact file
                            `echo '[{"name":"web","imageUri":"${ecrRepository.repositoryUri}:latest"}]' > imagedefinitions.json`,
                        ],
                    },
                },
                artifacts: {
                    files: ['imagedefinitions.json'],
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

        const deployStage = pipeline.addStage({stageName: 'Deploy'});
        deployStage.addAction(
            new EcsDeployAction({
                actionName: 'DeployAction',
                service: fargate.service,
                input: buildStageOutput
                // imageFile: buildStageOutput.atPath('imagedefinitions.json'),
            })
        );

        const buildProjectRole = buildProject.role as Role;
        buildProjectRole.addToPolicy(ecrPolicyStatement);

        const pipelineRole = pipeline.role as Role;
        pipelineRole.addToPolicy(secretAccessPolicyStatement);
    }
}
