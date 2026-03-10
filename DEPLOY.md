# Deploying Open-Inspect to AWS ECS

This guide covers deploying Open-Inspect as Docker containers on AWS ECS Fargate with RDS PostgreSQL, ElastiCache Redis, and an Application Load Balancer.

## Prerequisites

- AWS CLI configured with credentials (`aws configure`)
- Terraform >= 1.5 installed
- Docker installed (for building and pushing images)
- An existing VPC with public and private subnets (or create one)

## Step 1: Create ECR Repositories

```bash
aws ecr create-repository --repository-name open-inspect-control-plane
aws ecr create-repository --repository-name open-inspect-web
aws ecr create-repository --repository-name open-inspect-sandbox-manager
```

## Step 2: Build and Push Docker Images

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build and push each service
for SERVICE in control-plane web sandbox-manager; do
  docker compose build $SERVICE
  docker tag background-agents-$SERVICE:latest \
    <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/open-inspect-$SERVICE:latest
  docker push \
    <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/open-inspect-$SERVICE:latest
done
```

## Step 3: Configure Terraform

```bash
cd terraform/environments/ecs
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your AWS values:

| Variable | Description |
|----------|-------------|
| `vpc_id` | Your VPC ID |
| `public_subnet_ids` | Subnets for the ALB (need internet access) |
| `private_subnet_ids` | Subnets for ECS tasks and databases |
| `ecr_registry` | Your ECR registry URL (e.g. `123456789.dkr.ecr.us-east-1.amazonaws.com`) |
| `db_password` | A strong password for RDS PostgreSQL |

## Step 4: Set Up Terraform Backend

Create an S3 bucket for Terraform state:

```bash
aws s3 mb s3://open-inspect-terraform-state --region us-east-1
```

Initialize Terraform:

```bash
terraform init \
  -backend-config="bucket=open-inspect-terraform-state" \
  -backend-config="key=ecs/terraform.tfstate" \
  -backend-config="region=us-east-1"
```

## Step 5: Plan and Apply

```bash
terraform plan    # Review what will be created
terraform apply   # Create the infrastructure
```

This provisions:

- ECS Fargate cluster with 3 services (control-plane, web, sandbox-manager)
- RDS PostgreSQL 16 (db.t3.micro)
- ElastiCache Redis 7 (cache.t3.micro)
- Application Load Balancer with path-based routing
- ECR repositories for all services
- Security groups, IAM roles, and CloudWatch log groups

## Step 6: Configure Secrets

After `terraform apply`, set environment variables on the ECS task definitions. You can do this via the AWS Console (ECS > Task Definitions > Edit) or by adding them to the Terraform `environment` blocks.

### Required secrets

| Variable | How to generate |
|----------|-----------------|
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `REPO_SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `INTERNAL_CALLBACK_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID` | GitHub OAuth App settings |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App settings |
| `GITHUB_APP_ID` | GitHub App settings |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App settings (PKCS#8 format) |
| `GITHUB_APP_INSTALLATION_ID` | GitHub App installation URL |
| `ANTHROPIC_API_KEY` | Anthropic console |

### Optional configuration

| Variable | Description |
|----------|-------------|
| `EXTRA_MODELS` | JSON array of custom models for UI dropdowns |
| `OPENCODE_USER_CONFIG` | JSON string for custom OpenCode providers/MCP servers |
| `ALLOWED_EMAIL_DOMAINS` | Comma-separated email domains for access control |
| `ALLOWED_USERS` | Comma-separated GitHub usernames for access control |
| `LOG_LEVEL` | `debug`, `info`, `warn`, or `error` (default: `info`) |

## Step 7: Access the Application

After deployment, get the ALB DNS name:

```bash
terraform output alb_dns_name
```

Open that URL in your browser. Update your GitHub OAuth App callback URL to match:

```
http://<ALB_DNS_NAME>/api/auth/callback/github
```

## Architecture

```
Internet
    |
    v
  [ ALB ]
   /    \
  v      v
[Web]  [Control Plane] ---> [RDS PostgreSQL]
  |         |                [ElastiCache Redis]
  |         v
  |    [Sandbox Manager] ---> [ECS Tasks (sandboxes)]
  |
  v
Browser (WebSocket -> Control Plane)
```

## Updating

To deploy new code:

```bash
# Build, tag, and push updated images
for SERVICE in control-plane web sandbox-manager; do
  docker compose build $SERVICE
  docker tag background-agents-$SERVICE:latest \
    <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/open-inspect-$SERVICE:latest
  docker push \
    <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/open-inspect-$SERVICE:latest
done

# Force ECS to pull new images
aws ecs update-service --cluster open-inspect-production --service open-inspect-control-plane --force-new-deployment
aws ecs update-service --cluster open-inspect-production --service open-inspect-web --force-new-deployment
aws ecs update-service --cluster open-inspect-production --service open-inspect-sandbox-manager --force-new-deployment
```

Or push to `main` and let the CI/CD workflow (`.github/workflows/docker-build.yml`) handle it automatically.

## Local Development

For local development using Docker Compose, see the quickstart:

```bash
cp .env.docker .env
# Fill in .env with your secrets
docker compose up -d
```

This starts PostgreSQL, Redis, control-plane, web, and sandbox-manager locally.

## GitHub App Private Key Format

The GitHub App private key must be in PKCS#8 format. If your downloaded `.pem` starts with `BEGIN RSA PRIVATE KEY`, convert it:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem
```

The converted key should start with `BEGIN PRIVATE KEY`.
