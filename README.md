# Green-Blue Fargate Deployment with AWS CDK

This project demonstrates an infrastructure setup for deploying a Green-Blue deployment of a Dockerized application using AWS Fargate, AWS CDK, and AWS CodePipeline.

## Overview

The `GreenBlueFargateCodePipelineCdkStack` is an AWS CloudFormation stack implemented using the AWS Cloud Development Kit (CDK). It sets up a Blue-Green deployment pipeline for a Fargate-based application on Amazon ECS (Elastic Container Service). This allows seamless deployment and rollback between two separate environments (Blue and Green) to minimize downtime and ensure smooth updates.

The stack consists of the following components:

1. Amazon ECS Cluster and Task Definition: Sets up an ECS cluster and defines a Fargate task with a Docker container that runs the application.

2. Amazon Application Load Balancer (ALB): Creates an ALB that distributes traffic between the Blue and Green environments.

3. CodePipeline: Creates a CI/CD pipeline using AWS CodePipeline to automate the application deployment process.

4. CodeBuild Project: Configures a CodeBuild project to build the Docker image of the application and push it to Amazon ECR (Elastic Container Registry).

5. Amazon ECR Repository: Sets up a repository to store the Docker images built by the CodeBuild project.

6. CodeDeploy: Configures an AWS CodeDeploy deployment group for Blue-Green deployment using ECS services.

7. AWS Systems Manager Parameter Store: Stores parameter values, such as the hosted zone ID and domain name, used in the deployment process.

## Prerequisites

- Node.js
- AWS CLI
- Docker (for building and pushing Docker images)

## Getting Started

1. Clone the repository:

```sh
git clone https://github.com/your-username/green-blue-fargate-cdk.git
cd green-blue-fargate-cdk
```

2. Install dependencies:

```sh
npm install
```

3. Deploy the AWS CDK stacks:

```sh
# Deploy the ECR stack
cdk deploy GreenBlueEcrStack

# Build the Docker image and push to ECR
# Navigate to your application's source code directory
cd path/to/your/application
docker build -t <repository-uri>:latest .
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <repository-uri>
docker push <repository-uri>:latest

# Deploy the rest of the stacks
cdk deploy GreenBlueSslCertificate
cdk deploy GreenBlueFargateStack
cdk deploy GreenBlueARecordStack
cdk deploy GreenBlueFargateCodePipelineCdkStack
```

4. Access your application:

   Once the deployment is complete, you can access your application using the URLs and resources created by the stacks. Make sure to refer to the specific resources created by the stacks, such as the load balancer URLs, target groups, and other endpoints.

## Architecture Overview

This project uses AWS CDK to define the infrastructure as code. It includes the following stacks:

- **GreenBlueEcrStack**: Creates an Amazon Elastic Container Registry (ECR) repository for storing Docker images.

- **GreenBlueSslCertificate**: Sets up an SSL certificate using AWS Certificate Manager.

- **GreenBlueFargateStack**: Deploys an ECS Fargate service with a Blue-Green deployment configuration.

- **GreenBlueARecordStack**: Creates DNS A records for the Fargate service using Amazon Route 53.

- **GreenBlueFargateCodePipelineCdkStack**: Sets up a CodePipeline to automate the deployment process.

## Todo

- Parameterise repo values
- Pull build script in from other repo
- Add ssl certificate to test port/url

## Contributing

Contributions are welcome! If you find any issues or have improvements to suggest, please open an issue or a pull request.
