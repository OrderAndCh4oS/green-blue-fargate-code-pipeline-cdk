import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {Repository} from "aws-cdk-lib/aws-ecr";
import {CommonStackProps} from "../bin/green-blue-fargate-code-pipeline-cdk";
import {StringParameter} from "aws-cdk-lib/aws-ssm";

export class EcrStack extends Stack {
    constructor(scope: Construct, id: string, props: { repositoryName: string } & CommonStackProps) {
        super(scope, id, props);

        const ecrRepository = new Repository(this, "ApiECRRepository", {
            repositoryName: props.repositoryName
        });

        new StringParameter(this, 'EcrRepositoryArnParameter', {
            parameterName: props.parameterNames.ecrRepositoryArn,
            stringValue: ecrRepository.repositoryArn
        });
    }
}
