resource "aws_sqs_queue" "generation_dlq" {
  name                       = "${var.name}-generation-dlq"
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 30
  sqs_managed_sse_enabled    = true

  lifecycle {
    ignore_changes = [max_message_size]
  }
}

resource "aws_sqs_queue" "generation" {
  name                       = "${var.name}-generation"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.generation_dlq.arn
    maxReceiveCount     = 3
  })

  lifecycle {
    ignore_changes = [max_message_size]
  }
}

resource "aws_sqs_queue" "exam_events" {
  name                       = "${var.name}-exam-events"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 20
  sqs_managed_sse_enabled    = true

  lifecycle {
    ignore_changes = [max_message_size]
  }
}

locals {
  topics = toset(["leak-alerts", "ops-alerts", "release-notices"])
}

resource "aws_sns_topic" "this" {
  for_each = local.topics
  name     = "${var.name}-${each.key}"
}

resource "aws_sns_topic_subscription" "email" {
  for_each = {
    for pair in setproduct(local.topics, var.alert_emails) : "${pair[0]}:${pair[1]}" => pair
  }
  topic_arn = aws_sns_topic.this[each.value[0]].arn
  protocol  = "email"
  endpoint  = each.value[1]
}

resource "aws_scheduler_schedule_group" "this" {
  name = var.name
}
