import {SecretValue, Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Effect, PolicyStatement, Role} from "aws-cdk-lib/aws-iam";
import {Artifact, Pipeline} from "aws-cdk-lib/aws-codepipeline";
import {BuildSpec, LinuxBuildImage, PipelineProject} from "aws-cdk-lib/aws-codebuild";
import {CodeBuildAction, CodeDeployEcsDeployAction, GitHubSourceAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {EcsApplication, EcsDeploymentConfig, EcsDeploymentGroup} from "aws-cdk-lib/aws-codedeploy";
import {CommonStackProps} from "../bin/green-blue-fargate-code-pipeline-cdk";
import {StringParameter} from "aws-cdk-lib/aws-ssm";
import {ApplicationListener, ApplicationTargetGroup} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {Repository} from "aws-cdk-lib/aws-ecr";
import {Cluster, FargateService} from "aws-cdk-lib/aws-ecs";
import {SecurityGroup} from "aws-cdk-lib/aws-ec2";

export class GreenBlueFargateCodePipelineCdkStack extends Stack {
    constructor(scope: Construct, id: string, props: { repositoryName: string } & CommonStackProps) {
        super(scope, id, props);

        const fargateServiceParameter = StringParameter.fromStringParameterName(this, 'FargateServiceParameter', props.parameterNames.fargateServiceArn);
        const albSecurityGroupId = StringParameter.fromStringParameterName(this, 'AlbSecurityGroupId', props.parameterNames.albSecurityGroupId);
        const taskDefinitionParameter = StringParameter.fromStringParameterName(this, 'TaskDefinitionParameter', props.parameterNames.taskDefinitionArn);
        const ecsRoleArnParameter = StringParameter.fromStringParameterName(this, 'EcrPolicyStatementParameter', props.parameterNames.ecsRoleArn);
        const ecsArnParameter = StringParameter.fromStringParameterName(this, 'EcsParameter', props.parameterNames.ecsArn);
        const blueTargetGroupArnParameter = StringParameter.fromStringParameterName(this, 'BlueTargetGroupArnParameter', props.parameterNames.blueTargetGroupArn);
        const greenTargetGroupArnParameter = StringParameter.fromStringParameterName(this, 'GreenTargetGroupArnParameter', props.parameterNames.greenTargetGroupArn);
        const listenerArnParameter = StringParameter.fromStringParameterName(this, 'ListenerArnParameter', props.parameterNames.listenerArn);
        const testListenerArnParameter = StringParameter.fromStringParameterName(this, 'TestListenerArnParameter', props.parameterNames.testListenerArn);

        // Todo: make these variables or aws params with the names as variables
        const repositoryOwner = 'OrderAndCh4oS';
        const repositoryName = 'python-fastapi-docker';
        const branchName = 'main';

        const ecrRepository = Repository.fromRepositoryName(this, 'GreenBlueEcrRepository', props.repositoryName)

        const ecrPolicyStatement = new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'ecr:*', // Todo: figure out what permissions are actually required
            ],
            resources: ['*'], // Todo: try setting ecrRepositoryArn as resource
        });

        const secretAccessPolicyStatement = new PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [
                'arn:aws:secretsmanager:eu-west-1:914698808609:secret:GitHubAccessToken-FELixh',
            ],
        });

        const taskdef = {
            family: "api-blue-green-fargate-task-definition",
            executionRoleArn: ecsRoleArnParameter.stringValue,
            taskRoleArn: ecsRoleArnParameter.stringValue,
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
                            TaskDefinition: taskDefinitionParameter.stringValue,
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

        const blueTargetGroup = ApplicationTargetGroup.fromTargetGroupAttributes(this, 'BlueApplicationTargetGroup', {
            targetGroupArn: blueTargetGroupArnParameter.stringValue
        })

        const greenTargetGroup = ApplicationTargetGroup.fromTargetGroupAttributes(this, 'GreenApplicationTargetGroup', {
            targetGroupArn: greenTargetGroupArnParameter.stringValue
        })

        const securityGroup = SecurityGroup.fromSecurityGroupId(this, 'SecurityGroup', albSecurityGroupId.stringValue);

        const listener = ApplicationListener.fromApplicationListenerAttributes(this, 'ApplicationListener', {
            listenerArn: listenerArnParameter.stringValue,
            securityGroup,
            defaultPort: 80
        })

        const testListener = ApplicationListener.fromApplicationListenerAttributes(this, 'TestApplicationListener', {
            listenerArn: testListenerArnParameter.stringValue,
            securityGroup,
            defaultPort: 8080
        })

        const cluster = Cluster.fromClusterArn(this, 'Cluster', ecsArnParameter.stringValue)

        // Todo: see if this works without the cluster property that IBaseService has
        const fargate = FargateService.fromFargateServiceAttributes(this, 'FargateService', {
            serviceArn: fargateServiceParameter.stringValue,
            cluster
        })

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
