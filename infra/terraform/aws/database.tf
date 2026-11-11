resource "aws_db_subnet_group" "main" {
  name        = "${var.name}-db-subnets"
  description = "Private subnets for LeakTrace"
  subnet_ids  = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier                 = "${var.name}-db"
  engine                     = "postgres"
  engine_version             = var.db_engine_version
  instance_class             = var.db_instance_class
  allocated_storage          = var.db_storage_gb
  storage_type               = "gp2"
  storage_encrypted          = true
  db_name                    = var.db_name
  username                   = var.db_admin_username
  password                   = var.db_admin_password
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.db.id]
  availability_zone          = var.availability_zones[1]
  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = 1
  backup_window              = "21:16-21:46"
  copy_tags_to_snapshot      = true
  auto_minor_version_upgrade = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.name}-db-final"
  parameter_group_name       = "default.postgres16"

  lifecycle {
    ignore_changes = [password, kms_key_id, engine_version, maintenance_window]
  }
}
