resource "aws_instance" "api" {
  ami                    = var.ami_id
  instance_type          = var.api_instance_type
  subnet_id              = aws_subnet.public[0].id
  vpc_security_group_ids = [aws_security_group.api.id]
  iam_instance_profile   = aws_iam_instance_profile.api.name
  user_data              = replace(file("${path.module}/../../user-data-api.sh"), "\r\n", "\n")
  monitoring             = false

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.api_root_volume_gb
    delete_on_termination = true
    encrypted             = false
  }

  tags = { Name = "${var.name}-api" }

  lifecycle {
    ignore_changes = [ami, user_data, user_data_base64]
  }
}

resource "aws_launch_template" "worker" {
  name                   = "${var.name}-worker-lt"
  image_id               = var.ami_id
  instance_type          = var.worker_instance_type
  vpc_security_group_ids = [aws_security_group.worker.id]
  user_data              = base64encode(replace(file("${path.module}/../../user-data-worker.sh"), "\r\n", "\n"))

  iam_instance_profile {
    arn = aws_iam_instance_profile.worker.arn
  }

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  lifecycle {
    ignore_changes = [image_id]
  }
}

resource "aws_autoscaling_group" "workers" {
  name                      = "${var.name}-workers"
  min_size                  = 0
  max_size                  = var.worker_max_size
  desired_capacity          = 0
  vpc_zone_identifier       = aws_subnet.public[*].id
  health_check_type         = "EC2"
  health_check_grace_period = 300
  default_cooldown          = 300

  launch_template {
    id      = aws_launch_template.worker.id
    version = "$Default"
  }

  lifecycle {
    ignore_changes = [desired_capacity]
  }
}

resource "aws_autoscaling_policy" "scale_out" {
  name                    = "scale-out"
  autoscaling_group_name  = aws_autoscaling_group.workers.name
  policy_type             = "StepScaling"
  adjustment_type         = "ExactCapacity"
  metric_aggregation_type = "Average"

  step_adjustment {
    metric_interval_lower_bound = 0
    scaling_adjustment          = 1
  }
}

resource "aws_autoscaling_policy" "scale_in" {
  name                    = "scale-in"
  autoscaling_group_name  = aws_autoscaling_group.workers.name
  policy_type             = "StepScaling"
  adjustment_type         = "ExactCapacity"
  metric_aggregation_type = "Average"

  step_adjustment {
    metric_interval_upper_bound = 0
    scaling_adjustment          = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_has_work" {
  alarm_name          = "${var.name}-queue-has-work"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_autoscaling_policy.scale_out.arn]

  dimensions = {
    QueueName = aws_sqs_queue.generation.name
  }
}

resource "aws_cloudwatch_metric_alarm" "queue_empty" {
  alarm_name          = "${var.name}-queue-empty"
  evaluation_periods  = 5
  datapoints_to_alarm = 5
  threshold           = 0
  comparison_operator = "LessThanOrEqualToThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_autoscaling_policy.scale_in.arn]

  metric_query {
    id          = "e1"
    expression  = "m1+m2"
    label       = "Expression1"
    return_data = true
  }

  metric_query {
    id = "m1"

    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesVisible"
      period      = 60
      stat        = "Average"

      dimensions = {
        QueueName = aws_sqs_queue.generation.name
      }
    }
  }

  metric_query {
    id = "m2"

    metric {
      namespace   = "AWS/SQS"
      metric_name = "ApproximateNumberOfMessagesNotVisible"
      period      = 60
      stat        = "Average"

      dimensions = {
        QueueName = aws_sqs_queue.generation.name
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "dlq_not_empty" {
  alarm_name          = "${var.name}-dlq-not-empty"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "missing"
  alarm_actions       = [aws_sns_topic.this["ops-alerts"].arn]

  dimensions = {
    QueueName = aws_sqs_queue.generation_dlq.name
  }
}
