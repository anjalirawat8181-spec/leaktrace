locals {
  adopt = {
    vpc            = "vpc-034cf1a66b4711c37"
    igw            = "igw-0f31deced5eb70f9e"
    public_subnet  = ["subnet-05fc36c97ec2b7f1a", "subnet-01f7b3003c22f8c5d"]
    private_subnet = ["subnet-0a8a09e8537d13441", "subnet-0cdd5f9be7803d12b"]
    public_rtb     = "rtb-0cee001008af44d9c"
    private_rtb    = ["rtb-092be4fa0accff38c", "rtb-00f3f795f367f5c76"]
    s3_endpoint    = "vpce-0c22b42db43aec458"
    api_sg         = "sg-052263279fa4cb094"
    worker_sg      = "sg-094953c16c9711044"
    db_sg          = "sg-05fb3dab1b31b608f"
    api_instance   = "i-090080767784a1d40"
    worker_lt      = "lt-04ada548c082f3a18"
    managed        = ["CloudWatchAgentServerPolicy", "AmazonSSMManagedInstanceCore"]
  }
}

import {
  to = aws_vpc.main
  id = local.adopt.vpc
}

import {
  to = aws_internet_gateway.main
  id = local.adopt.igw
}

import {
  to = aws_subnet.public[0]
  id = local.adopt.public_subnet[0]
}

import {
  to = aws_subnet.public[1]
  id = local.adopt.public_subnet[1]
}

import {
  to = aws_subnet.private[0]
  id = local.adopt.private_subnet[0]
}

import {
  to = aws_subnet.private[1]
  id = local.adopt.private_subnet[1]
}

import {
  to = aws_route_table.public
  id = local.adopt.public_rtb
}

import {
  to = aws_route_table.private[0]
  id = local.adopt.private_rtb[0]
}

import {
  to = aws_route_table.private[1]
  id = local.adopt.private_rtb[1]
}

import {
  to = aws_route_table_association.public[0]
  id = "${local.adopt.public_subnet[0]}/${local.adopt.public_rtb}"
}

import {
  to = aws_route_table_association.public[1]
  id = "${local.adopt.public_subnet[1]}/${local.adopt.public_rtb}"
}

import {
  to = aws_route_table_association.private[0]
  id = "${local.adopt.private_subnet[0]}/${local.adopt.private_rtb[0]}"
}

import {
  to = aws_route_table_association.private[1]
  id = "${local.adopt.private_subnet[1]}/${local.adopt.private_rtb[1]}"
}

import {
  to = aws_vpc_endpoint.s3
  id = local.adopt.s3_endpoint
}

import {
  to = aws_security_group.api
  id = local.adopt.api_sg
}

import {
  to = aws_security_group.worker
  id = local.adopt.worker_sg
}

import {
  to = aws_security_group.db
  id = local.adopt.db_sg
}

import {
  to = aws_iam_role.api
  id = "${var.name}-api-role"
}

import {
  to = aws_iam_role.worker
  id = "${var.name}-worker-role"
}

import {
  to = aws_iam_role.scheduler
  id = "${var.name}-scheduler-role"
}

import {
  to = aws_iam_instance_profile.api
  id = "${var.name}-api-role"
}

import {
  to = aws_iam_instance_profile.worker
  id = "${var.name}-worker-role"
}

import {
  to = aws_iam_role_policy.api
  id = "${var.name}-api-role:${var.name}-api-policy"
}

import {
  to = aws_iam_role_policy.api_scheduler_access
  id = "${var.name}-api-role:scheduler-access"
}

import {
  to = aws_iam_role_policy.api_web_bucket_read
  id = "${var.name}-api-role:web-bucket-read"
}

import {
  to = aws_iam_role_policy.worker
  id = "${var.name}-worker-role:${var.name}-worker-policy"
}

import {
  to = aws_iam_role_policy.scheduler
  id = "${var.name}-scheduler-role:${var.name}-scheduler-policy"
}

import {
  for_each = toset(local.adopt.managed)
  to       = aws_iam_role_policy_attachment.api_managed["arn:aws:iam::aws:policy/${each.key}"]
  id       = "${var.name}-api-role/arn:aws:iam::aws:policy/${each.key}"
}

import {
  for_each = toset(local.adopt.managed)
  to       = aws_iam_role_policy_attachment.worker_managed["arn:aws:iam::aws:policy/${each.key}"]
  id       = "${var.name}-worker-role/arn:aws:iam::aws:policy/${each.key}"
}

import {
  for_each = local.buckets
  to       = aws_s3_bucket.this[each.key]
  id       = each.value
}

import {
  for_each = local.buckets
  to       = aws_s3_bucket_public_access_block.this[each.key]
  id       = each.value
}

import {
  for_each = local.buckets
  to       = aws_s3_bucket_server_side_encryption_configuration.this[each.key]
  id       = each.value
}

import {
  to = aws_s3_bucket_versioning.data
  id = local.buckets.data
}

import {
  to = aws_s3_bucket_lifecycle_configuration.data
  id = local.buckets.data
}

import {
  to = aws_sqs_queue.generation_dlq
  id = "https://sqs.${var.region}.amazonaws.com/${var.account_id}/${var.name}-generation-dlq"
}

import {
  to = aws_sqs_queue.generation
  id = "https://sqs.${var.region}.amazonaws.com/${var.account_id}/${var.name}-generation"
}

import {
  to = aws_sqs_queue.exam_events
  id = "https://sqs.${var.region}.amazonaws.com/${var.account_id}/${var.name}-exam-events"
}

import {
  for_each = local.topics
  to       = aws_sns_topic.this[each.key]
  id       = "arn:aws:sns:${var.region}:${var.account_id}:${var.name}-${each.key}"
}

import {
  to = aws_scheduler_schedule_group.this
  id = var.name
}

import {
  for_each = toset(keys(local.ssm_plain))
  to       = aws_ssm_parameter.plain[each.key]
  id       = "/${var.name}/prod/${each.key}"
}

import {
  for_each = toset(keys(local.ssm_secret))
  to       = aws_ssm_parameter.secret[each.key]
  id       = "/${var.name}/prod/${each.key}"
}

import {
  to = aws_db_subnet_group.main
  id = "${var.name}-db-subnets"
}

import {
  to = aws_db_instance.main
  id = "${var.name}-db"
}

import {
  to = aws_instance.api
  id = local.adopt.api_instance
}

import {
  to = aws_launch_template.worker
  id = local.adopt.worker_lt
}

import {
  to = aws_autoscaling_group.workers
  id = "${var.name}-workers"
}

import {
  to = aws_autoscaling_policy.scale_out
  id = "${var.name}-workers/scale-out"
}

import {
  to = aws_autoscaling_policy.scale_in
  id = "${var.name}-workers/scale-in"
}

import {
  to = aws_cloudwatch_metric_alarm.queue_has_work
  id = "${var.name}-queue-has-work"
}

import {
  to = aws_cloudwatch_metric_alarm.queue_empty
  id = "${var.name}-queue-empty"
}

import {
  to = aws_cloudwatch_metric_alarm.dlq_not_empty
  id = "${var.name}-dlq-not-empty"
}
