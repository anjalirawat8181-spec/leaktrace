output "api_public_ip" {
  value = aws_instance.api.public_ip
}

output "api_url" {
  value = "http://${aws_instance.api.public_dns}"
}

output "data_bucket" {
  value = aws_s3_bucket.this["data"].bucket
}

output "deploy_bucket" {
  value = aws_s3_bucket.this["deploy"].bucket
}

output "web_bucket" {
  value = aws_s3_bucket.this["web"].bucket
}

output "generation_queue_url" {
  value = aws_sqs_queue.generation.url
}

output "db_endpoint" {
  value = aws_db_instance.main.address
}
