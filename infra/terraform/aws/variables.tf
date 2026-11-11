variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  description = "Prefix for every resource name"
  type        = string
  default     = "leaktrace"
}

variable "bucket_suffix" {
  description = "Suffix that makes the S3 bucket names globally unique"
  type        = string
  default     = "ccl2026"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "availability_zones" {
  type    = list(string)
  default = ["ap-south-1a", "ap-south-1b"]
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "api_http_cidrs" {
  description = "CIDR blocks allowed to reach the API server on port 80"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "api_allow_cloudfront" {
  description = "Also allow CloudFront origin-facing addresses on port 80"
  type        = bool
  default     = true
}

variable "ami_id" {
  description = "Amazon Linux 2023 AMI used by the API server and the workers"
  type        = string
  default     = "ami-04394a3a96907e9ec"
}

variable "api_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "api_root_volume_gb" {
  type    = number
  default = 16
}

variable "worker_instance_type" {
  type    = string
  default = "t3.micro"
}

variable "worker_max_size" {
  type    = number
  default = 1
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_storage_gb" {
  type    = number
  default = 20
}

variable "db_engine_version" {
  type    = string
  default = "16.15"
}

variable "db_name" {
  type    = string
  default = "leaktrace"
}

variable "db_admin_username" {
  type    = string
  default = "leaktrace_admin"
}

variable "db_app_username" {
  type    = string
  default = "leaktrace_app"
}

variable "db_admin_password" {
  type      = string
  sensitive = true
}

variable "db_app_password" {
  type      = string
  sensitive = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "fingerprint_key" {
  description = "Never change this after the first deploy: stored copies are recomputed from it"
  type        = string
  sensitive   = true
}

variable "account_id" {
  description = "Only used by imports.tf to build ARNs when adopting an existing deployment"
  type        = string
  default     = ""
}

variable "evidence_cors_origins" {
  description = "Web origins allowed to upload evidence photos straight to the data bucket"
  type        = list(string)
  default     = []
}

variable "alert_emails" {
  description = "Addresses subscribed to every alert topic (each must confirm by email)"
  type        = list(string)
  default     = []
}
