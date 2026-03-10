# Open-Inspect ECS Deployment
#
# Provisions the core AWS infrastructure:
#   - ECS Fargate cluster
#   - RDS PostgreSQL
#   - ElastiCache Redis
#   - ALB
#   - ECR repositories
#   - Secrets Manager

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region = var.aws_region
}

# ─── Variables ────────────────────────────────────────────────────────────────

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID"
}

variable "public_subnet_ids" {
  type        = list(string)
  description = "Public subnet IDs for ALB"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for ECS tasks and databases"
}

variable "ecr_registry" {
  type        = string
  description = "ECR registry URL (e.g., 123456789.dkr.ecr.us-east-1.amazonaws.com)"
}

variable "db_password" {
  type      = string
  sensitive = true
}

locals {
  tags = {
    Project     = "open-inspect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ─── ECR Repositories ────────────────────────────────────────────────────────

resource "aws_ecr_repository" "services" {
  for_each = toset([
    "control-plane",
    "web",
    "slack-bot",
    "github-bot",
    "linear-bot",
    "sandbox-manager",
  ])

  name                 = "open-inspect-${each.key}"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.tags
}

# ─── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "open-inspect-${var.environment}"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = local.tags
}

# ─── Security Groups ─────────────────────────────────────────────────────────

resource "aws_security_group" "alb" {
  name        = "open-inspect-alb"
  description = "ALB security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_security_group" "ecs" {
  name        = "open-inspect-ecs"
  description = "ECS tasks security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    from_port = 0
    to_port   = 65535
    protocol  = "tcp"
    self      = true
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_security_group" "db" {
  name        = "open-inspect-db"
  description = "Database security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = local.tags
}

resource "aws_security_group" "redis" {
  name        = "open-inspect-redis"
  description = "Redis security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }

  tags = local.tags
}

# ─── RDS PostgreSQL ───────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "open-inspect"
  subnet_ids = var.private_subnet_ids
  tags       = local.tags
}

resource "aws_db_instance" "postgres" {
  identifier             = "open-inspect-${var.environment}"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_encrypted      = true
  db_name                = "openinspect"
  username               = "openinspect"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  skip_final_snapshot    = true
  tags                   = local.tags
}

# ─── ElastiCache Redis ────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "open-inspect"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "open-inspect-${var.environment}"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
  tags                 = local.tags
}

# ─── ALB ──────────────────────────────────────────────────────────────────────

resource "aws_lb" "main" {
  name               = "open-inspect-${var.environment}"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  tags               = local.tags
}

resource "aws_lb_target_group" "control_plane" {
  name        = "oi-control-plane"
  port        = 8787
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.tags
}

resource "aws_lb_target_group" "web" {
  name        = "oi-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.control_plane.arn
  }

  condition {
    path_pattern {
      values = ["/sessions*", "/health", "/repos*", "/secrets*", "/model-preferences*", "/integration-settings*", "/repo-images*", "/automations*"]
    }
  }
}

# ─── IAM ──────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "open-inspect-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# ─── ECS Services ─────────────────────────────────────────────────────────────

module "control_plane" {
  source = "../../modules/ecs-service"

  name               = "control-plane"
  cluster_id         = aws_ecs_cluster.main.id
  vpc_id             = var.vpc_id
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.ecs.id]
  image              = "${var.ecr_registry}/open-inspect-control-plane:latest"
  container_port     = 8787
  cpu                = 512
  memory             = 1024
  execution_role_arn = aws_iam_role.ecs_execution.arn
  target_group_arn   = aws_lb_target_group.control_plane.arn
  tags               = local.tags

  environment = {
    DATABASE_URL = "postgres://openinspect:${var.db_password}@${aws_db_instance.postgres.endpoint}/openinspect"
    REDIS_URL    = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
    PORT         = "8787"
  }
}

module "web" {
  source = "../../modules/ecs-service"

  name               = "web"
  cluster_id         = aws_ecs_cluster.main.id
  vpc_id             = var.vpc_id
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.ecs.id]
  image              = "${var.ecr_registry}/open-inspect-web:latest"
  container_port     = 3000
  cpu                = 256
  memory             = 512
  execution_role_arn = aws_iam_role.ecs_execution.arn
  target_group_arn   = aws_lb_target_group.web.arn
  tags               = local.tags

  environment = {
    CONTROL_PLANE_URL  = "http://open-inspect-control-plane.open-inspect-${var.environment}:8787"
    NEXT_PUBLIC_WS_URL = "ws://${aws_lb.main.dns_name}/sessions"
    NEXTAUTH_URL       = "http://${aws_lb.main.dns_name}"
  }
}

module "sandbox_manager" {
  source = "../../modules/ecs-service"

  name               = "sandbox-manager"
  cluster_id         = aws_ecs_cluster.main.id
  vpc_id             = var.vpc_id
  subnet_ids         = var.private_subnet_ids
  security_group_ids = [aws_security_group.ecs.id]
  image              = "${var.ecr_registry}/open-inspect-sandbox-manager:latest"
  container_port     = 8000
  cpu                = 512
  memory             = 1024
  execution_role_arn = aws_iam_role.ecs_execution.arn
  tags               = local.tags

  environment = {
    CONTROL_PLANE_URL = "http://open-inspect-control-plane.open-inspect-${var.environment}:8787"
  }
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "ALB DNS name"
}

output "rds_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "RDS endpoint"
}

output "redis_endpoint" {
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  description = "Redis endpoint"
}

output "cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS cluster name"
}
