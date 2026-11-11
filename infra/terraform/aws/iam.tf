data "aws_iam_policy_document" "ec2_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "scheduler_trust" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.name}-api-role"
  description        = "Allows EC2 instances to call AWS services on your behalf."
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role" "worker" {
  name               = "${var.name}-worker-role"
  description        = "Allows EC2 instances to call AWS services on your behalf."
  assume_role_policy = data.aws_iam_policy_document.ec2_trust.json
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.name}-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_trust.json
}

resource "aws_iam_instance_profile" "api" {
  name = "${var.name}-api-role"
  role = aws_iam_role.api.name
}

resource "aws_iam_instance_profile" "worker" {
  name = "${var.name}-worker-role"
  role = aws_iam_role.worker.name
}

resource "aws_iam_role_policy_attachment" "api_managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.api.name
  policy_arn = each.value
}

resource "aws_iam_role_policy_attachment" "worker_managed" {
  for_each = toset([
    "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy",
    "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
  ])
  role       = aws_iam_role.worker.name
  policy_arn = each.value
}

data "aws_iam_policy_document" "api" {
  statement {
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:*:parameter/${var.name}/prod*"]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    actions = ["s3:GetObject"]
    resources = [
      "arn:aws:s3:::${var.name}-data-*/papers/*",
      "arn:aws:s3:::${var.name}-deploy-*/*",
    ]
  }

  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["arn:aws:s3:::${var.name}-data-*/evidence/*"]
  }

  statement {
    actions = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
    resources = [
      "arn:aws:sqs:${var.region}:*:${var.name}-generation",
      "arn:aws:sqs:${var.region}:*:${var.name}-generation-dlq",
    ]
  }

  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = ["arn:aws:sqs:${var.region}:*:${var.name}-exam-events"]
  }

  statement {
    actions   = ["sns:Publish"]
    resources = ["arn:aws:sns:${var.region}:*:${var.name}-*"]
  }

  statement {
    actions   = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"]
    resources = ["arn:aws:scheduler:${var.region}:*:schedule/${var.name}/*"]
  }

  statement {
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::*:role/${var.name}-scheduler-role"]
  }

  statement {
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["LeakTrace"]
    }
  }

  statement {
    actions   = ["autoscaling:DescribeAutoScalingGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${var.name}-api-policy"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

data "aws_iam_policy_document" "api_scheduler_access" {
  statement {
    sid       = "ScheduleGroup"
    actions   = ["scheduler:CreateScheduleGroup", "scheduler:GetScheduleGroup"]
    resources = ["arn:aws:scheduler:${var.region}:${data.aws_caller_identity.current.account_id}:schedule-group/${var.name}"]
  }

  statement {
    sid       = "Schedules"
    actions   = ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"]
    resources = ["arn:aws:scheduler:${var.region}:${data.aws_caller_identity.current.account_id}:schedule/${var.name}/*"]
  }

  statement {
    sid       = "PassSchedulerRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${var.name}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "api_scheduler_access" {
  name   = "scheduler-access"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_scheduler_access.json
}

data "aws_iam_policy_document" "api_web_bucket_read" {
  statement {
    actions   = ["s3:ListBucket", "s3:GetObject"]
    resources = ["arn:aws:s3:::${local.buckets.web}", "arn:aws:s3:::${local.buckets.web}/*"]
  }
}

resource "aws_iam_role_policy" "api_web_bucket_read" {
  name   = "web-bucket-read"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_web_bucket_read.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    actions   = ["ssm:GetParametersByPath", "ssm:GetParameters", "ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.region}:*:parameter/${var.name}/prod*"]
  }

  statement {
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.region}.amazonaws.com"]
    }
  }

  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"]
    resources = ["arn:aws:sqs:${var.region}:*:${var.name}-generation"]
  }

  statement {
    actions   = ["s3:PutObject", "s3:GetObject"]
    resources = ["arn:aws:s3:::${var.name}-data-*/papers/*"]
  }

  statement {
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.name}-deploy-*/*"]
  }

  statement {
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["LeakTrace"]
    }
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "${var.name}-worker-policy"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

data "aws_iam_policy_document" "scheduler" {
  statement {
    actions   = ["sqs:SendMessage"]
    resources = ["arn:aws:sqs:${var.region}:*:${var.name}-exam-events"]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "${var.name}-scheduler-policy"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler.json
}
