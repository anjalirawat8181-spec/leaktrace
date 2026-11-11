locals {
  buckets = {
    data   = "${var.name}-data-${var.bucket_suffix}"
    deploy = "${var.name}-deploy-${var.bucket_suffix}"
    web    = "${var.name}-web-${var.bucket_suffix}"
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets
  bucket   = each.value
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = aws_s3_bucket.this
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this
  bucket   = each.value.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.this["data"].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_cors_configuration" "data" {
  count  = length(var.evidence_cors_origins) > 0 ? 1 : 0
  bucket = aws_s3_bucket.this["data"].id

  cors_rule {
    allowed_origins = var.evidence_cors_origins
    allowed_methods = ["GET", "PUT"]
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3600
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.this["data"].id

  rule {
    id     = "expire-papers"
    status = "Enabled"

    filter {
      prefix = "papers/"
    }

    expiration {
      days = 60
    }

    noncurrent_version_expiration {
      noncurrent_days = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.data]
}
