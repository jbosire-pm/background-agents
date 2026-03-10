# Generic ECS Fargate service module for Open-Inspect

variable "name" {
  type        = string
  description = "Service name"
}

variable "cluster_id" {
  type        = string
  description = "ECS cluster ID"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnet IDs for tasks"
}

variable "security_group_ids" {
  type        = list(string)
  description = "Security group IDs"
}

variable "image" {
  type        = string
  description = "Docker image URI"
}

variable "container_port" {
  type        = number
  description = "Container port"
}

variable "cpu" {
  type        = number
  default     = 256
  description = "Fargate CPU units"
}

variable "memory" {
  type        = number
  default     = 512
  description = "Fargate memory (MiB)"
}

variable "desired_count" {
  type        = number
  default     = 1
  description = "Desired task count"
}

variable "environment" {
  type        = map(string)
  default     = {}
  description = "Environment variables"
}

variable "secrets" {
  type        = map(string)
  default     = {}
  description = "Secrets Manager ARNs mapped to env var names"
}

variable "target_group_arn" {
  type        = string
  default     = ""
  description = "ALB target group ARN (empty = no LB)"
}

variable "execution_role_arn" {
  type        = string
  description = "ECS task execution role ARN"
}

variable "task_role_arn" {
  type        = string
  default     = ""
  description = "ECS task role ARN"
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Resource tags"
}

# ─── Log Group ────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/open-inspect/${var.name}"
  retention_in_days = 30
  tags              = var.tags
}

# ─── Task Definition ─────────────────────────────────────────────────────────

resource "aws_ecs_task_definition" "this" {
  family                   = "open-inspect-${var.name}"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn != "" ? var.task_role_arn : null

  container_definitions = jsonencode([
    {
      name      = var.name
      image     = var.image
      essential = true

      portMappings = [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ]

      environment = [
        for k, v in var.environment : {
          name  = k
          value = v
        }
      ]

      secrets = [
        for k, v in var.secrets : {
          name      = k
          valueFrom = v
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = var.name
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = var.tags
}

# ─── Service ──────────────────────────────────────────────────────────────────

resource "aws_ecs_service" "this" {
  name            = "open-inspect-${var.name}"
  cluster         = var.cluster_id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = true
  }

  dynamic "load_balancer" {
    for_each = var.target_group_arn != "" ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = var.name
      container_port   = var.container_port
    }
  }

  tags = var.tags
}

# ─── Data Sources ─────────────────────────────────────────────────────────────

data "aws_region" "current" {}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}
