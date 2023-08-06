# GreenBlueFargateCodePipelineCdkStack

The `GreenBlueFargateCodePipelineCdkStack` is an AWS CloudFormation stack implemented using the AWS Cloud Development Kit (CDK). It sets up a Blue-Green deployment pipeline for a Fargate-based application on Amazon ECS (Elastic Container Service). This allows seamless deployment and rollback between two separate environments (Blue and Green) to minimize downtime and ensure smooth updates.

## Stack Overview

The stack consists of the following components:

1. Amazon ECS Cluster and Task Definition: Sets up an ECS cluster and defines a Fargate task with a Docker container that runs the application.

2. Amazon Application Load Balancer (ALB): Creates an ALB that distributes traffic between the Blue and Green environments.

3. CodePipeline: Creates a CI/CD pipeline using AWS CodePipeline to automate the application deployment process.

4. CodeBuild Project: Configures a CodeBuild project to build the Docker image of the application and push it to Amazon ECR (Elastic Container Registry).

5. Amazon ECR Repository: Sets up a repository to store the Docker images built by the CodeBuild project.

6. CodeDeploy: Configures an AWS CodeDeploy deployment group for Blue-Green deployment using ECS services.

7. AWS Systems Manager Parameter Store: Stores parameter values, such as the hosted zone ID and domain name, used in the deployment process.
