locals {
  ssm_plain = {
    DATA_BUCKET               = aws_s3_bucket.this["data"].bucket
    DB_HOST                   = aws_db_instance.main.address
    DB_NAME                   = var.db_name
    DB_USER                   = var.db_app_username
    EXAM_EVENTS_QUEUE_ARN     = aws_sqs_queue.exam_events.arn
    EXAM_EVENTS_QUEUE_URL     = aws_sqs_queue.exam_events.url
    GENERATION_QUEUE_URL      = aws_sqs_queue.generation.url
    LEAK_ALERTS_TOPIC_ARN     = aws_sns_topic.this["leak-alerts"].arn
    OPS_ALERTS_TOPIC_ARN      = aws_sns_topic.this["ops-alerts"].arn
    RELEASE_NOTICES_TOPIC_ARN = aws_sns_topic.this["release-notices"].arn
    SCHEDULER_ROLE_ARN        = aws_iam_role.scheduler.arn
    WORKER_ASG_NAME           = aws_autoscaling_group.workers.name
  }

  ssm_secret = {
    DB_ADMIN_PASSWORD = var.db_admin_password
    DB_PASSWORD       = var.db_app_password
    FINGERPRINT_KEY   = var.fingerprint_key
    JWT_SECRET        = var.jwt_secret
  }
}

resource "aws_ssm_parameter" "plain" {
  for_each = local.ssm_plain
  name     = "/${var.name}/prod/${each.key}"
  type     = "String"
  value    = each.value

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "secret" {
  for_each = local.ssm_secret
  name     = "/${var.name}/prod/${each.key}"
  type     = "SecureString"
  value    = each.value

  lifecycle {
    ignore_changes = [value]
  }
}
